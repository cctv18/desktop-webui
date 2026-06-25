import './node-globals'

import * as Path from 'path'
import { spawn } from 'child_process'
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'fs/promises'
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
import {
  filterRepositoryFilePaths,
  isRepositoryPathIgnored,
  normalizeRepositoryRelativePath,
} from '../ui/code-editor/code-editor-model'
import { IAppState } from '../lib/app-state'
import { reviveFromWeb } from '../lib/webui-serialization'
import { Account } from '../models/account'
import { CloningRepository } from '../models/cloning-repository'
import { Repository } from '../models/repository'
import { PathGuard } from './path-guard'
import { API, IAPIRepositoryCloneInfo } from '../lib/api'
import {
  addSafeDirectory,
  getBooleanConfigValue,
  getConfigValue,
  getGlobalBooleanConfigValue,
  getGlobalConfigValue,
  setConfigValue,
  setGlobalConfigValue,
} from '../lib/git/config'
import { getRepositoryType } from '../lib/git/rev-parse'
import { doMergeCommitsExistAfterCommit } from '../lib/git/rev-list'
import { filesNotTrackedByLFS } from '../lib/git/lfs'
import { getAuthors } from '../lib/git/log'
import { getPartialBlobContents } from '../lib/git/show'
import {
  createCommit,
  getAuthorIdentity,
  getStatus,
  initGitRepository,
} from '../lib/git'
import { readPartialFile } from '../lib/file-system'
import { pathExists as pathExistsOnDisk } from '../lib/path-exists'
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
import { setWebUIGitCredentialAccountProvider } from '../lib/webui-git-credentials'
import { writeDefaultReadme } from '../ui/add-repository/write-default-readme'
import { writeGitDescription } from '../lib/git/description'
import { writeGitIgnore } from '../ui/add-repository/gitignores'
import { writeGitAttributes } from '../ui/add-repository/git-attributes'
import { writeLicense } from '../ui/add-repository/licenses'
import type { ILicense } from '../ui/add-repository/licenses'

interface ICreateLocalRepositoryOptions {
  readonly fullPath: string
  readonly name: string
  readonly description: string
  readonly createWithReadme: boolean
  readonly gitIgnore: string
  readonly license: ILicense | null
}

interface IClipboardCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

interface ICodeEditorFileListOptions {
  readonly ignoredPaths: ReadonlyArray<string>
  readonly showIgnoredPaths: boolean
}

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
    setWebUIGitCredentialAccountProvider(() => accountsStore.getAll())
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
          addSafeDirectory: (path: string) =>
            this.addAllowedSafeDirectory(path),
          doMergeCommitsExistAfterCommit,
          filesNotTrackedByLFS,
          getAuthors,
          getBooleanConfigValue,
          getConfigValue,
          getGlobalBooleanConfigValue,
          getGlobalConfigValue,
          getPartialBlobContents,
          getRepositoryType: (path: string) =>
            this.getAllowedRepositoryType(path),
          setConfigValue,
          setGlobalConfigValue,
        }
      case 'filesystem':
        return {
          access: (path: string) => this.accessAllowedPath(path),
          chmod: (path: string, mode: string | number) =>
            this.chmodAllowedPath(path, mode),
          lstat: (path: string) => this.statAllowedPath(path, false),
          mkdir: (
            path: string,
            options?: { readonly recursive?: boolean; readonly mode?: number }
          ) => this.mkdirAllowedPath(path, options),
          pathExists: (path: string) => this.pathExists(path),
          readdir: (path: string) => this.readdirAllowedPath(path),
          readFile: (path: string, encoding?: BufferEncoding) =>
            this.readAllowedFile(path, encoding),
          readPartialFile: (path: string, start: number, end: number) =>
            this.readAllowedPartialFile(path, start, end),
          stat: (path: string) => this.statAllowedPath(path, true),
          validateCloneDestinationPath: (path: string) =>
            this.validateCloneDestinationPath(path),
          writeFile: (path: string, data: string) =>
            this.writeAllowedFile(path, data),
        }
      case 'clone':
        return {
          resolveCloneInfo: (url: string) => this.resolveCloneInfo(url),
        }
      case 'repositoryCreation':
        return {
          createRepository: (options: ICreateLocalRepositoryOptions) =>
            this.createLocalRepository(options),
        }
      case 'clipboard':
        return {
          writeText: (text: string) => this.writeClipboardText(text),
        }
      case 'codeEditor':
        return {
          listRepositoryFiles: (
            path: string,
            options?: ICodeEditorFileListOptions
          ) => this.listAllowedRepositoryFiles(path, options),
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

  private async createLocalRepository(options: ICreateLocalRepositoryOptions) {
    const fullPath = options.fullPath

    if (typeof fullPath !== 'string' || fullPath.length === 0) {
      throw new Error('Repository path is required.')
    }

    await this.pathGuard.assertAllowed(fullPath)
    await mkdir(fullPath, { recursive: true })
    await initGitRepository(fullPath)

    const repositories = await this.dispatcher.addRepositories([fullPath])
    if (repositories.length < 1) {
      throw new Error(`Unable to add repository at ${fullPath}.`)
    }

    const repository = repositories[0]

    if (options.createWithReadme) {
      await writeDefaultReadme(fullPath, options.name, options.description)
    }

    if (options.gitIgnore !== 'None') {
      await writeGitIgnore(fullPath, options.gitIgnore)
    }

    if (options.description) {
      await writeGitDescription(fullPath, options.description)
    }

    if (options.license !== null) {
      const author = await getAuthorIdentity(repository)

      await writeLicense(fullPath, options.license, {
        fullname: author ? author.name : '',
        email: author ? author.email : '',
        year: new Date().getFullYear().toString(),
        description: '',
        project: options.name,
      })
    }

    const gitAttributes = Path.join(fullPath, '.gitattributes')
    if (!(await pathExistsOnDisk(gitAttributes))) {
      await writeGitAttributes(fullPath)
    }

    const status = await getStatus(repository, true, true)
    const files = status.workingDirectory.files

    if (files.length > 0) {
      await createCommit(repository, 'Initial commit', files)
    }

    return repository
  }

  private async getAllowedRepositoryType(path: string) {
    await this.pathGuard.assertAllowed(path)
    return getRepositoryType(path)
  }

  private async addAllowedSafeDirectory(path: string) {
    await this.pathGuard.assertAllowed(path)
    return addSafeDirectory(path)
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
        message: `${getErrorMessage(
          error
        )}. Allowed roots: ${this.pathGuard.allowedRoots.join(', ')}`,
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

  private async readAllowedPartialFile(
    path: string,
    start: number,
    end: number
  ) {
    await this.pathGuard.assertAllowed(path)
    return readPartialFile(path, start, end)
  }

  private resolveStaticPath(path: string) {
    const decodedPath = this.decodeStaticPath(path)

    if (decodedPath === null || !decodedPath.startsWith('/static/')) {
      return null
    }

    const staticRoot = process.env.GITDESK_WEBUI_STATIC_ROOT
    if (!staticRoot) {
      return null
    }

    const absoluteStaticRoot = Path.resolve(staticRoot)
    const absolutePath = Path.resolve(
      absoluteStaticRoot,
      decodedPath.replace(/^\/+/, '')
    )
    const relativePath = Path.relative(absoluteStaticRoot, absolutePath)

    if (
      relativePath &&
      !relativePath.startsWith('..') &&
      !Path.isAbsolute(relativePath)
    ) {
      return absolutePath
    }

    return null
  }

  private decodeStaticPath(path: string) {
    try {
      return decodeURIComponent(path)
    } catch {
      return null
    }
  }

  private async readAllowedFile(path: string, encoding?: BufferEncoding) {
    const staticPath = this.resolveStaticPath(path)
    if (staticPath !== null) {
      return readFile(staticPath, encoding ?? 'utf8')
    }

    await this.pathGuard.assertAllowed(path)
    return readFile(path, encoding ?? 'utf8')
  }

  private async writeAllowedFile(path: string, data: string) {
    await this.pathGuard.assertAllowed(path)
    return writeFile(path, data)
  }

  private async mkdirAllowedPath(
    path: string,
    options?: { readonly recursive?: boolean; readonly mode?: number }
  ) {
    await this.pathGuard.assertAllowed(path)
    return mkdir(path, {
      recursive: options?.recursive,
      mode: options?.mode,
    })
  }

  private async accessAllowedPath(path: string) {
    await this.pathGuard.assertAllowed(path)
    await access(path)
  }

  private async chmodAllowedPath(path: string, mode: string | number) {
    await this.pathGuard.assertAllowed(path)
    await chmod(path, mode)
  }

  private async readdirAllowedPath(path: string) {
    const staticPath = this.resolveStaticPath(path)
    if (staticPath !== null) {
      return readdir(staticPath)
    }

    await this.pathGuard.assertAllowed(path)
    return readdir(path)
  }

  private async statAllowedPath(path: string, followSymlink: boolean) {
    await this.pathGuard.assertAllowed(path)
    const stats = followSymlink ? await stat(path) : await lstat(path)

    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymbolicLink: stats.isSymbolicLink(),
    }
  }

  private async pathExists(path: string) {
    await this.pathGuard.assertAllowed(path)
    return pathExistsOnDisk(path)
  }

  private async listAllowedRepositoryFiles(
    path: string,
    options?: ICodeEditorFileListOptions
  ) {
    await this.pathGuard.assertAllowed(path)

    const root = Path.resolve(path)
    const files = new Array<string>()
    const ignoredPaths = options?.ignoredPaths ?? []
    const showIgnoredPaths = options?.showIgnoredPaths === true
    const maxFiles = 10000

    const walk = async (directory: string) => {
      if (files.length >= maxFiles) {
        return
      }

      let entries: ReadonlyArray<string>
      try {
        entries = await readdir(directory)
      } catch (error) {
        log.warn(`Unable to read repository directory '${directory}'`, error)
        return
      }

      for (const entry of entries) {
        if (files.length >= maxFiles) {
          return
        }

        const fullPath = Path.join(directory, entry)
        const relativePath = normalizeRepositoryRelativePath(
          Path.relative(root, fullPath)
        )

        if (
          !showIgnoredPaths &&
          isRepositoryPathIgnored(relativePath, ignoredPaths)
        ) {
          continue
        }

        let stats
        try {
          stats = await lstat(fullPath)
        } catch {
          continue
        }

        if (stats.isSymbolicLink()) {
          continue
        }

        if (stats.isDirectory()) {
          await walk(fullPath)
          continue
        }

        if (stats.isFile()) {
          files.push(relativePath)
        }
      }
    }

    await walk(root)
    return filterRepositoryFilePaths(files, ignoredPaths, showIgnoredPaths)
  }

  private async writeClipboardText(text: string) {
    if (typeof text !== 'string') {
      return false
    }

    let wrote = false

    for (const command of this.getClipboardCommands()) {
      try {
        await this.writeClipboardWithCommand(command, text)
        wrote = true
      } catch {
        // Clipboard helpers are optional on Linux servers. The browser
        // clipboard write has already happened, so this bridge is best effort.
      }
    }

    return wrote
  }

  private getClipboardCommands(): ReadonlyArray<IClipboardCommand> {
    if (process.platform === 'win32') {
      return [{ command: 'cmd', args: ['/c', 'clip'] }]
    }

    if (process.platform === 'darwin') {
      return [{ command: 'pbcopy', args: [] }]
    }

    return [
      { command: 'wl-copy', args: [] },
      { command: 'xclip', args: ['-selection', 'clipboard'] },
      { command: 'xclip', args: ['-selection', 'primary'] },
      { command: 'xsel', args: ['--clipboard', '--input'] },
      { command: 'xsel', args: ['--primary', '--input'] },
    ]
  }

  private writeClipboardWithCommand(
    command: IClipboardCommand,
    text: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command.command, command.args, {
        stdio: ['pipe', 'ignore', 'pipe'],
      })
      let settled = false
      let stderr = ''

      const finish = (error?: Error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)

        if (error !== undefined) {
          reject(error)
        } else {
          resolve()
        }
      }

      const timeout = setTimeout(() => {
        child.kill()
        finish(new Error(`Clipboard command '${command.command}' timed out.`))
      }, 2000)

      child.stderr?.on('data', data => {
        stderr += Buffer.from(data).toString('utf8')
      })

      child.on('error', finish)
      child.on('close', code => {
        if (code === 0) {
          finish()
        } else {
          finish(
            new Error(
              `Clipboard command '${command.command}' exited with ${code}: ${stderr}`
            )
          )
        }
      })

      child.stdin.on('error', finish)
      child.stdin.end(text)
    })
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
