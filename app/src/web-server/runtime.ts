import './node-globals'

import * as Path from 'path'
import { Disposable } from 'event-kit'
import {
  AccountsStore,
  ApiRepositoriesStore,
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
import { Repository } from '../models/repository'
import { PathGuard } from './path-guard'

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
    process.env.LOCAL_GIT_DIRECTORY = Path.resolve(__dirname, 'git')
    delete process.env.GIT_EXEC_PATH

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

    const guardedParams = await Promise.all(
      params.map(param => this.reviveAndGuardArgument(param))
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
      default:
        throw new Error(`Unknown WebUI RPC target '${targetName}'`)
    }
  }

  private async reviveAndGuardArgument(param: unknown): Promise<unknown> {
    if (Array.isArray(param)) {
      return Promise.all(param.map(x => this.reviveAndGuardArgument(x)))
    }

    if (param !== null && typeof param === 'object') {
      const value = param as any

      if (typeof value.path === 'string' && typeof value.id === 'number') {
        await this.pathGuard.assertAllowed(value.path)
        return this.findRepository(value.id, value.path) ?? value
      }

      return param
    }

    return param
  }

  private findRepository(id: number, path: string): Repository | null {
    return (
      this.appStore
        .getState()
        .repositories.find(x => x.id === id || x.path === path) ?? null
    )
  }
}
