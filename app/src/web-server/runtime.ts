import './node-globals'

import * as Path from 'path'
import { readdir } from 'fs/promises'
import { Disposable } from 'event-kit'
import {
  AccountsStore,
  AppStore,
  CloningRepositoriesStore,
  CopilotStore,
  GitHubUserStore,
  IssuesStore,
  RepositoriesStore,
  SignInStore,
  TokenStore,
  PullRequestStore,
  PullRequestCoordinator,
} from '../lib/stores'
import { ApiRepositoriesStore } from '../lib/stores/api-repositories-store'
import {
  GitHubUserDatabase,
  IssuesDatabase,
  RepositoriesDatabase,
  PullRequestDatabase,
} from '../lib/databases'
import { StatsDatabase, StatsStore } from '../lib/stats'
import { RepositoryStateCache } from '../lib/stores/repository-state-cache'
import { CommitStatusStore } from '../lib/stores/commit-status-store'
import { AheadBehindStore } from '../lib/stores/ahead-behind-store'
import { AliveStore } from '../lib/stores/alive-store'
import { NotificationsStore } from '../lib/stores/notifications-store'
import { NotificationsDebugStore } from '../lib/stores/notifications-debug-store'
import { Dispatcher } from '../ui/dispatcher'
import { IUiActivityMonitor } from '../ui/lib/ui-activity-monitor'
import { IAppState } from '../lib/app-state'
import { reviveFromWeb } from '../lib/webui-serialization'
import { Account } from '../models/account'
import { CloningRepository } from '../models/cloning-repository'
import { Repository } from '../models/repository'
import { PathGuard } from './path-guard'
import { API, IAPIRepositoryCloneInfo } from '../lib/api'
import {
  getBooleanConfigValue,
  getConfigValue,
  getGlobalBooleanConfigValue,
  getGlobalConfigValue,
  setConfigValue,
  setGlobalConfigValue,
} from '../lib/git/config'
import { configureGitEnvironment } from './git-environment'
import {
  IRepositoryIdentifier,
  parseRepositoryIdentifier,
  parseRemote,
} from '../lib/remote-parsing'
import { findAccountForRemoteURL } from '../lib/find-account'
import { trampolineServer } from '../lib/trampoline/trampoline-server'
import { TrampolineCommandIdentifier } from '../lib/trampoline/trampoline-command'
import { createAskpassTrampolineHandler } from '../lib/trampoline/trampoline-askpass-handler'
import { createCredentialHelperTrampolineHandler } from '../lib/trampoline/trampoline-credential-helper'

class ServerActivityMonitor implements IUiActivityMonitor {
  public onActivity() {
    return new Disposable(() => {})
  }
}

export class WebRuntime {
  public readonly dispatcher: Dispatcher
  public readonly appStore: AppStore
  public readonly repositoryStateManager: RepositoryStateCache
  public readonly issuesStore: IssuesStore
  public readonly gitHubUserStore: GitHubUserStore
  public readonly aheadBehindStore: AheadBehindStore
  public readonly notificationsDebugStore: NotificationsDebugStore

  public constructor(private readonly pathGuard: PathGuard) {
    configureGitEnvironment({
      bundledGitDirectory: Path.resolve(__dirname, 'git'),
      configuredDataDirectory: process.env.GITDESK_WEBUI_DATA_DIR,
      configuredGitConfigGlobal: process.env.GITDESK_WEBUI_GIT_CONFIG_GLOBAL,
      configuredGitDirectory: process.env.GITDESK_WEBUI_GIT_DIRECTORY,
      configuredGitExecPath: process.env.GITDESK_WEBUI_GIT_EXEC_PATH,
      configuredGitPath: process.env.GITDESK_WEBUI_GIT_PATH,
      logger: log,
    })

    const gitHubUserStore = new GitHubUserStore(
      new GitHubUserDatabase('GitDeskWebUI.GitHubUserDatabase')
    )
    const cloningRepositoriesStore = new CloningRepositoriesStore()
    const issuesStore = new IssuesStore(
      new IssuesDatabase('GitDeskWebUI.IssuesDatabase')
    )
    const statsStore = new StatsStore(
      new StatsDatabase('GitDeskWebUI.StatsDatabase'),
      new ServerActivityMonitor()
    )
    const accountsStore = new AccountsStore(localStorage, TokenStore)
    trampolineServer.registerCommandHandler(
      TrampolineCommandIdentifier.AskPass,
      createAskpassTrampolineHandler(accountsStore)
    )
    trampolineServer.registerCommandHandler(
      TrampolineCommandIdentifier.CredentialHelper,
      createCredentialHelperTrampolineHandler(accountsStore)
    )
    const signInStore = new SignInStore(accountsStore)
    const repositoriesStore = new RepositoriesStore(
      new RepositoriesDatabase('GitDeskWebUI.RepositoriesDatabase')
    )
    const pullRequestStore = new PullRequestStore(
      new PullRequestDatabase('GitDeskWebUI.PullRequestDatabase'),
      repositoriesStore
    )
    const pullRequestCoordinator = new PullRequestCoordinator(
      pullRequestStore,
      repositoriesStore
    )
    const repositoryStateManager = new RepositoryStateCache(statsStore)
    const apiRepositoriesStore = new ApiRepositoriesStore(accountsStore)
    const commitStatusStore = new CommitStatusStore(accountsStore)
    const aliveStore = new AliveStore(accountsStore)
    const notificationsStore = new NotificationsStore(
      accountsStore,
      aliveStore,
      pullRequestCoordinator,
      statsStore
    )
    const copilotStore = new CopilotStore(accountsStore)

    this.gitHubUserStore = gitHubUserStore
    this.issuesStore = issuesStore
    this.repositoryStateManager = repositoryStateManager
    this.aheadBehindStore = new AheadBehindStore()
    this.notificationsDebugStore = new NotificationsDebugStore(
      accountsStore,
      notificationsStore,
      pullRequestCoordinator
    )

    this.appStore = new AppStore(
      gitHubUserStore,
      cloningRepositoriesStore,
      issuesStore,
      statsStore,
      signInStore,
      accountsStore,
      repositoriesStore,
      pullRequestCoordinator,
      repositoryStateManager,
      apiRepositoriesStore,
      notificationsStore,
      copilotStore
    )

    this.dispatcher = new Dispatcher(
      this.appStore,
      repositoryStateManager,
      statsStore,
      commitStatusStore
    )
  }

  public getState() {
    return this.appStore.getState()
  }

  public onDidUpdate(fn: (state: IAppState) => void) {
    return this.appStore.onDidUpdate(fn)
  }

  public async invoke(method: string, params: ReadonlyArray<unknown>) {
    const [targetName, targetMethod] = method.includes('.')
      ? method.split('.', 2)
      : ['dispatcher', method]
    const target = this.resolveTarget(targetName)

    const action = target[targetMethod]

    if (typeof action !== 'function') {
      throw new Error(`Unknown WebUI RPC method '${method}'`)
    }

    const revivedParams = reviveFromWeb<ReadonlyArray<unknown>>(params)
    const guardedParams = await Promise.all(
      revivedParams.map(param => this.reviveAndGuardArgument(param))
    )

    return action.apply(target, guardedParams)
  }

  private resolveTarget(targetName: string): any {
    switch (targetName) {
      case 'dispatcher':
        return this.dispatcher
      case 'appStore':
        return this.appStore
      case 'issuesStore':
        return this.issuesStore
      case 'gitHubUserStore':
        return this.gitHubUserStore
      case 'aheadBehindStore':
        return this.aheadBehindStore
      case 'notificationsDebugStore':
        return this.notificationsDebugStore
      case 'git':
        return {
          getBooleanConfigValue,
          getConfigValue,
          getGlobalBooleanConfigValue,
          getGlobalConfigValue,
          setConfigValue,
          setGlobalConfigValue,
        }
      case 'filesystem':
        return {
          validateCloneDestinationPath: (path: string) =>
            this.validateCloneDestinationPath(path),
        }
      case 'clone':
        return {
          resolveCloneInfo: (url: string) => this.resolveCloneInfo(url),
        }
      default:
        throw new Error(`Unknown WebUI RPC target '${targetName}'`)
    }
  }

  private async resolveCloneInfo(
    url: string
  ): Promise<IAPIRepositoryCloneInfo | null> {
    if (url.endsWith('.wiki.git')) {
      return { url }
    }

    const parsed = parseRepositoryIdentifier(url)
    const account = await findAccountForRemoteURL(
      url,
      this.appStore.getState().accounts
    )

    if (parsed !== null && account !== null) {
      return this.fetchRepositoryCloneInfo(url, parsed, account)
    }

    return { url }
  }

  private async fetchRepositoryCloneInfo(
    url: string,
    identifier: IRepositoryIdentifier,
    account: Account
  ): Promise<IAPIRepositoryCloneInfo | null> {
    const api = API.fromAccount(account)
    const { owner, name } = identifier
    const protocol = parseRemote(url)?.protocol

    return api.fetchRepositoryCloneInfo(owner, name, protocol).catch(error => {
      log.error(`Failed to look up repository clone info for '${url}'`, error)
      return { url }
    })
  }

  private async validateCloneDestinationPath(path: string) {
    if (typeof path !== 'string' || path.length === 0) {
      return {
        message:
          'Unable to read path on disk. Please check the path and try again.',
      }
    }

    try {
      await this.pathGuard.assertAllowed(path)
    } catch (error) {
      return {
        message: `${getErrorMessage(error)}. Allowed roots: ${this.pathGuard.allowedRoots.join(
          ', '
        )}`,
      }
    }

    try {
      const directoryFiles = await readdir(path)

      if (directoryFiles.length === 0) {
        return { message: null }
      }

      return {
        message:
          'This folder contains files. Git can only clone to empty folders.',
      }
    } catch (error) {
      const code = getErrorCode(error)

      if (code === 'ENOTDIR') {
        return {
          message:
            'There is already a file with this name. Git can only clone to a folder.',
        }
      }

      if (code === 'ENOENT') {
        return { message: null }
      }

      log.error(
        `CloneRepository: server path validation failed for ${path}`,
        error as Error
      )
      return {
        message:
          'Unable to read path on disk. Please check the path and try again.',
      }
    }
  }

  private async reviveAndGuardArgument(param: unknown): Promise<unknown> {
    if (Array.isArray(param)) {
      return Promise.all(param.map(x => this.reviveAndGuardArgument(x)))
    }

    if (param instanceof Date) {
      return param
    }

    if (param instanceof Map) {
      const entries = await Promise.all(
        Array.from(param.entries()).map(async ([key, value]) => [
          await this.reviveAndGuardArgument(key),
          await this.reviveAndGuardArgument(value),
        ])
      )
      return new Map(entries as Array<[unknown, unknown]>)
    }

    if (param instanceof Set) {
      const values = await Promise.all(
        Array.from(param.values()).map(value =>
          this.reviveAndGuardArgument(value)
        )
      )
      return new Set(values)
    }

    if (param !== null && typeof param === 'object') {
      const value = param as any

      if (value instanceof Repository) {
        await this.pathGuard.assertAllowed(value.path)
        return this.findRepository(value.id, value.path) ?? value
      }

      if (value instanceof CloningRepository) {
        await this.pathGuard.assertAllowed(value.path)
        return value
      }

      if (value instanceof Account) {
        return this.findAccount(value) ?? value
      }

      if (typeof value.path === 'string' && typeof value.id === 'number') {
        await this.pathGuard.assertAllowed(value.path)
        return this.findRepository(value.id, value.path) ?? value
      }

      const guardedValue = Object.create(Object.getPrototypeOf(value))

      for (const key of Object.keys(value)) {
        const fieldValue = value[key]

        if (
          typeof fieldValue === 'string' &&
          this.shouldGuardPath(key, fieldValue)
        ) {
          await this.pathGuard.assertAllowed(fieldValue)
          guardedValue[key] = fieldValue
        } else {
          guardedValue[key] = await this.reviveAndGuardArgument(fieldValue)
        }
      }

      return guardedValue
    }

    return param
  }

  private shouldGuardPath(key: string, value: string): boolean {
    if (!Path.isAbsolute(value)) {
      return false
    }

    return (
      key === 'path' ||
      key === 'repositoryPath' ||
      key === 'worktreePath' ||
      key === 'targetPath' ||
      key === 'fullPath' ||
      key === 'destinationPath'
    )
  }

  private findRepository(id: number, path: string): Repository | null {
    return (
      this.appStore
        .getState()
        .repositories.find(
          (x): x is Repository =>
            x instanceof Repository && (x.id === id || x.path === path)
        ) ?? null
    )
  }

  private findAccount(account: Account): Account | null {
    return (
      this.appStore
        .getState()
        .accounts.find(
          candidate =>
            candidate.id === account.id &&
            candidate.endpoint === account.endpoint
        ) ?? null
    )
  }
}

function getErrorCode(error: unknown) {
  return typeof (error as NodeJS.ErrnoException | null)?.code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : `${error}`
}
