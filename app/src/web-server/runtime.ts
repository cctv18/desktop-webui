import './node-globals'

import * as Path from 'path'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename as renamePath,
  rm,
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
  applyCodeEditorHistoryAction,
  createCodeEditorTextEditAction,
  createCodeEditorRenameDestination,
  createFoldedLineDiffRows,
  createFoldedSideBySideDiffRows,
  createLineDiffRows,
  filterRepositoryFilePaths,
  ICodeEditorTextEditAction,
  ICodeEditorDiffExpansion,
  CodeEditorSplitDiffRow,
  CodeEditorUnifiedDiffRow,
  isRepositoryPathIgnored,
  isCodeEditorPathWithin,
  normalizeEditorText,
  normalizeRepositoryRelativePath,
  replaceCodeEditorPathPrefix,
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

type CodeEditorLineEnding = 'lf' | 'crlf'
type RepositoryPanelKind = 'commit-management' | 'code-editor'

const maxCodeEditorPreviewBlobBytes = 5 * 1024 * 1024

interface ICodeEditorTempFileStatus {
  readonly hasTempFile: boolean
  readonly contents: string | null
  readonly lineEnding: CodeEditorLineEnding | null
  readonly conflict: ICodeEditorConflictFile | null
}

interface ICodeEditorConflictFile {
  readonly id: string
  readonly contents: string
  readonly lineEnding: CodeEditorLineEnding
}

interface ICodeEditorWriteTempFileOptions {
  readonly branchKey: string
  readonly relativePath: string
  readonly contents: string
  readonly previousContents: string
  readonly previousLineEnding: CodeEditorLineEnding
  readonly baseContents: string
  readonly lineEnding: CodeEditorLineEnding
}

type CodeEditorDiffMode = 'unified' | 'split'

interface ICodeEditorDiffResult {
  readonly mode: CodeEditorDiffMode
  readonly relativePath: string
  readonly unchanged: boolean
  readonly truncated: boolean
  readonly totalRows: number
  readonly rows:
    | ReadonlyArray<CodeEditorUnifiedDiffRow>
    | ReadonlyArray<CodeEditorSplitDiffRow>
}

type CodeEditorHistoryActionKind = 'undo' | 'redo'

interface ICodeEditorHistoryStatus {
  readonly undoCount: number
  readonly redoCount: number
}

interface ICodeEditorHistoryActionResult extends ICodeEditorHistoryStatus {
  readonly contents: string
  readonly lineEnding: CodeEditorLineEnding
  readonly changed: boolean
}

interface ICodeEditorFileEditLog {
  readonly relativePath: string
  readonly baseHash: string
  readonly lineEnding: CodeEditorLineEnding
  readonly undoStack: ReadonlyArray<ICodeEditorTextEditAction>
  readonly redoStack: ReadonlyArray<ICodeEditorTextEditAction>
  readonly updatedAt: number
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
  private readonly selectedRepositoryPanels = new Map<
    string,
    RepositoryPanelKind
  >()

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
      case 'preferences':
        return {
          readDefaultCloneDirectory: () => this.readDefaultCloneDirectory(),
          writeDefaultCloneDirectory: (path: string) =>
            this.writeDefaultCloneDirectory(path),
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
          readStorageItem: (key: string) => this.readCodeEditorStorageItem(key),
          removeStorageItem: (key: string) =>
            this.removeCodeEditorStorageItem(key),
          writeStorageItem: (key: string, value: string) =>
            this.writeCodeEditorStorageItem(key, value),
          purgeLegacyStorage: () => this.purgeLegacyCodeEditorStorage(),
          readPanelSelection: (repositoryPath: string, branchKey: string) =>
            this.readCodeEditorPanelSelection(repositoryPath, branchKey),
          writePanelSelection: (
            repositoryPath: string,
            branchKey: string,
            panel: RepositoryPanelKind
          ) =>
            this.writeCodeEditorPanelSelection(
              repositoryPath,
              branchKey,
              panel
            ),
          clearRepositoryCache: (repositoryPath: string) =>
            this.clearCodeEditorRepositoryCache(repositoryPath),
          activateBranchCache: (repositoryPath: string, branchKey: string) =>
            this.activateCodeEditorBranchCache(repositoryPath, branchKey),
          readTempFileStatus: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string,
            currentContents: string
          ) =>
            this.readCodeEditorTempFileStatus(
              repositoryPath,
              branchKey,
              relativePath,
              currentContents
            ),
          writeTempFile: (
            repositoryPath: string,
            options: ICodeEditorWriteTempFileOptions
          ) => this.writeCodeEditorTempFile(repositoryPath, options),
          readHistoryStatus: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string
          ) =>
            this.readCodeEditorHistoryStatus(
              repositoryPath,
              branchKey,
              relativePath
            ),
          applyHistoryAction: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string,
            action: CodeEditorHistoryActionKind
          ) =>
            this.applyCodeEditorHistoryAction(
              repositoryPath,
              branchKey,
              relativePath,
              action
            ),
          removeTempFile: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string
          ) =>
            this.removeCodeEditorTempFile(
              repositoryPath,
              branchKey,
              relativePath
            ),
          renamePath: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string,
            newName: string
          ) =>
            this.renameCodeEditorPath(
              repositoryPath,
              branchKey,
              relativePath,
              newName
            ),
          deletePath: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string
          ) =>
            this.deleteCodeEditorPath(repositoryPath, branchKey, relativePath),
          readConflictFile: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string,
            conflictID: string
          ) =>
            this.readCodeEditorConflictFile(
              repositoryPath,
              branchKey,
              relativePath,
              conflictID
            ),
          removeConflictFile: (
            repositoryPath: string,
            branchKey: string,
            relativePath: string,
            conflictID: string
          ) =>
            this.removeCodeEditorConflictFile(
              repositoryPath,
              branchKey,
              relativePath,
              conflictID
            ),
          createDiff: (
            repository: Repository,
            branchKey: string,
            relativePath: string,
            mode: CodeEditorDiffMode,
            expansions: ReadonlyArray<ICodeEditorDiffExpansion>
          ) =>
            this.createCodeEditorDiff(
              repository,
              branchKey,
              relativePath,
              mode,
              expansions
            ),
          listRepositoryFiles: (
            path: string,
            options?: ICodeEditorFileListOptions
          ) => this.listAllowedRepositoryFiles(path, options),
        }
      default:
        throw new Error(`Unknown WebUI RPC target '${targetName}'`)
    }
  }

  private readCodeEditorStorageItem(key: string) {
    this.assertCodeEditorStorageKey(key)
    return localStorage.getItem(key)
  }

  private async readDefaultCloneDirectory() {
    const path = localStorage.getItem(
      'gitdesk-webui:preferences:last-clone-location'
    )
    if (path === null || !Path.isAbsolute(path)) {
      return null
    }

    try {
      await this.pathGuard.assertAllowed(path)
      return path
    } catch {
      return null
    }
  }

  private async writeDefaultCloneDirectory(path: string) {
    await this.pathGuard.assertAllowed(path)
    localStorage.setItem('gitdesk-webui:preferences:last-clone-location', path)
  }

  private writeCodeEditorStorageItem(key: string, value: string) {
    this.assertCodeEditorStorageKey(key)
    localStorage.setItem(key, value)
  }

  private removeCodeEditorStorageItem(key: string) {
    this.assertCodeEditorStorageKey(key)
    localStorage.removeItem(key)
  }

  private assertCodeEditorStorageKey(key: string) {
    if (!key.startsWith('gitdesk-webui:code-editor:')) {
      throw new Error('Invalid CodeMirror editor storage key')
    }
  }

  private purgeLegacyCodeEditorStorage() {
    const legacyPrefixes = [
      'gitdesk-webui:code-editor:draft:',
      'gitdesk-webui:code-editor:state:',
    ]

    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index)
      if (
        key !== null &&
        legacyPrefixes.some(prefix => key.startsWith(prefix))
      ) {
        localStorage.removeItem(key)
      }
    }
  }

  private async readCodeEditorPanelSelection(
    repositoryPath: string,
    branchKey: string
  ): Promise<RepositoryPanelKind> {
    await this.pathGuard.assertAllowed(repositoryPath)
    this.assertCodeEditorBranchKey(branchKey)

    return (
      this.selectedRepositoryPanels.get(
        createCodeEditorPanelMemoryKey(repositoryPath, branchKey)
      ) ?? 'commit-management'
    )
  }

  private async writeCodeEditorPanelSelection(
    repositoryPath: string,
    branchKey: string,
    panel: RepositoryPanelKind
  ) {
    await this.pathGuard.assertAllowed(repositoryPath)
    this.assertCodeEditorBranchKey(branchKey)

    if (panel !== 'commit-management' && panel !== 'code-editor') {
      throw new Error('Invalid CodeMirror editor panel')
    }

    this.selectedRepositoryPanels.set(
      createCodeEditorPanelMemoryKey(repositoryPath, branchKey),
      panel
    )
  }

  private async clearCodeEditorRepositoryCache(repositoryPath: string) {
    await this.pathGuard.assertAllowed(repositoryPath)
    await rm(this.getCodeEditorRepositoryTempRoot(repositoryPath), {
      recursive: true,
      force: true,
    })

    for (const key of this.selectedRepositoryPanels.keys()) {
      if (key.startsWith(`${Path.resolve(repositoryPath)}\0`)) {
        this.selectedRepositoryPanels.delete(key)
      }
    }
  }

  private async activateCodeEditorBranchCache(
    repositoryPath: string,
    branchKey: string
  ) {
    await this.pathGuard.assertAllowed(repositoryPath)
    this.assertCodeEditorBranchKey(branchKey)

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    await mkdir(root, { recursive: true })
    await this.ensureCodeEditorBranchCacheActive(root, branchKey)
  }

  private async readCodeEditorTempFileStatus(
    repositoryPath: string,
    branchKey: string,
    relativePath: string,
    currentContents: string
  ): Promise<ICodeEditorTempFileStatus> {
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const normalizedPath = assertCodeEditorRelativePath(relativePath)
    const tempPath = resolveCodeEditorTempFilePath(root, normalizedPath)

    if (!(await pathExistsOnDisk(tempPath))) {
      return {
        hasTempFile: false,
        contents: null,
        lineEnding: null,
        conflict: null,
      }
    }

    const contents = await readFile(tempPath, 'utf8')
    assertCodeEditorTextFile(contents)

    const log = await this.readCodeEditorEditLog(root, normalizedPath)
    const lineEnding = log?.lineEnding ?? detectRawLineEnding(contents)
    const currentHash = hashCodeEditorContents(currentContents)
    const tempMatchesCurrent =
      normalizeEditorText(contents) === normalizeEditorText(currentContents)

    if (
      log !== null &&
      log.baseHash !== currentHash &&
      tempMatchesCurrent === false
    ) {
      const conflict = await this.archiveCodeEditorConflictFile(
        root,
        normalizedPath,
        contents,
        lineEnding
      )
      await this.removeCodeEditorTempFileFromRoot(root, normalizedPath)

      return {
        hasTempFile: false,
        contents: null,
        lineEnding: null,
        conflict,
      }
    }

    return {
      hasTempFile: true,
      contents,
      lineEnding,
      conflict: null,
    }
  }

  private async writeCodeEditorTempFile(
    repositoryPath: string,
    options: ICodeEditorWriteTempFileOptions
  ) {
    await this.activateCodeEditorBranchCache(repositoryPath, options.branchKey)

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const normalizedPath = assertCodeEditorRelativePath(options.relativePath)
    const tempPath = resolveCodeEditorTempFilePath(root, normalizedPath)
    const contents = applyRawLineEnding(options.contents, options.lineEnding)
    const previousContents = normalizeEditorText(options.previousContents)
    const nextContents = normalizeEditorText(options.contents)

    await mkdir(Path.dirname(tempPath), { recursive: true })
    await writeFile(tempPath, contents, 'utf8')

    const existingLog = await this.readCodeEditorEditLog(root, normalizedPath)
    const action =
      previousContents === nextContents &&
      options.previousLineEnding === options.lineEnding
        ? null
        : createCodeEditorTextEditAction(
            previousContents,
            nextContents,
            options.previousLineEnding,
            options.lineEnding
          )
    const undoStack =
      action === null
        ? existingLog?.undoStack ?? []
        : [...(existingLog?.undoStack ?? []), action].slice(-500)
    const logValue: ICodeEditorFileEditLog = {
      relativePath: normalizedPath,
      baseHash:
        existingLog?.baseHash ?? hashCodeEditorContents(options.baseContents),
      lineEnding: options.lineEnding,
      undoStack,
      redoStack: action === null ? existingLog?.redoStack ?? [] : [],
      updatedAt: Date.now(),
    }

    await this.writeCodeEditorEditLog(root, normalizedPath, logValue)
  }

  private async readCodeEditorHistoryStatus(
    repositoryPath: string,
    branchKey: string,
    relativePath: string
  ): Promise<ICodeEditorHistoryStatus> {
    const startedAt = Date.now()
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const normalizedPath = assertCodeEditorRelativePath(relativePath)
    const log = await this.readCodeEditorEditLog(root, normalizedPath)
    const status = createCodeEditorHistoryStatus(log)

    logCodeEditorHistoryStatus(
      'status',
      normalizedPath,
      status,
      Date.now() - startedAt
    )

    return status
  }

  private async applyCodeEditorHistoryAction(
    repositoryPath: string,
    branchKey: string,
    relativePath: string,
    actionKind: CodeEditorHistoryActionKind
  ): Promise<ICodeEditorHistoryActionResult> {
    const startedAt = Date.now()
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const normalizedPath = assertCodeEditorRelativePath(relativePath)
    const rawCurrentContents = await this.readCodeEditorCurrentContents(
      repositoryPath,
      root,
      normalizedPath
    )
    const currentContents = normalizeEditorText(rawCurrentContents)
    const editLog = await this.readCodeEditorEditLog(root, normalizedPath)

    if (editLog === null) {
      const lineEnding = detectRawLineEnding(rawCurrentContents)
      const status = createCodeEditorHistoryStatus(null)
      logCodeEditorHistoryStatus(
        actionKind,
        normalizedPath,
        status,
        Date.now() - startedAt,
        false
      )

      return {
        ...status,
        contents: currentContents,
        lineEnding,
        changed: false,
      }
    }

    const sourceStack =
      actionKind === 'undo' ? editLog.undoStack : editLog.redoStack
    const action = sourceStack[sourceStack.length - 1]

    if (action === undefined) {
      const status = createCodeEditorHistoryStatus(editLog)
      logCodeEditorHistoryStatus(
        actionKind,
        normalizedPath,
        status,
        Date.now() - startedAt,
        false
      )

      return {
        ...status,
        contents: currentContents,
        lineEnding: editLog.lineEnding,
        changed: false,
      }
    }

    const applied = applyCodeEditorHistoryAction(
      currentContents,
      action,
      actionKind,
      editLog.lineEnding
    )
    const contents = applied.contents
    const undoStack =
      actionKind === 'undo'
        ? editLog.undoStack.slice(0, -1)
        : [...editLog.undoStack, action].slice(-500)
    const redoStack =
      actionKind === 'undo'
        ? [...editLog.redoStack, action].slice(-500)
        : editLog.redoStack.slice(0, -1)
    const nextLog: ICodeEditorFileEditLog = {
      ...editLog,
      lineEnding: applied.lineEnding,
      undoStack,
      redoStack,
      updatedAt: Date.now(),
    }
    const tempPath = resolveCodeEditorTempFilePath(root, normalizedPath)

    await mkdir(Path.dirname(tempPath), { recursive: true })
    await writeFile(
      tempPath,
      applyRawLineEnding(contents, applied.lineEnding),
      'utf8'
    )
    await this.writeCodeEditorEditLog(root, normalizedPath, nextLog)

    const status = createCodeEditorHistoryStatus(nextLog)
    logCodeEditorHistoryStatus(
      actionKind,
      normalizedPath,
      status,
      Date.now() - startedAt,
      true
    )

    return {
      ...status,
      contents,
      lineEnding: applied.lineEnding,
      changed: true,
    }
  }

  private async removeCodeEditorTempFile(
    repositoryPath: string,
    branchKey: string,
    relativePath: string
  ) {
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)
    await this.removeCodeEditorTempFileFromRoot(
      this.getCodeEditorRepositoryTempRoot(repositoryPath),
      assertCodeEditorRelativePath(relativePath)
    )
  }

  private async renameCodeEditorPath(
    repositoryPath: string,
    branchKey: string,
    relativePath: string,
    newName: string
  ) {
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)
    const sourcePath = assertCodeEditorRelativePath(relativePath)
    const destinationPath = assertCodeEditorRelativePath(
      createCodeEditorRenameDestination(sourcePath, newName)
    )
    const sourceAbsolutePath = resolveInsideDirectory(
      repositoryPath,
      sourcePath
    )
    const destinationAbsolutePath = resolveInsideDirectory(
      repositoryPath,
      destinationPath
    )

    await this.pathGuard.assertAllowed(sourceAbsolutePath)
    await this.pathGuard.assertAllowed(destinationAbsolutePath)
    if (!(await pathExistsOnDisk(sourceAbsolutePath))) {
      throw new Error('The selected file or folder no longer exists.')
    }
    if (await pathExistsOnDisk(destinationAbsolutePath)) {
      throw new Error('A file or folder with that name already exists.')
    }

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const affectedPaths = await this.collectCodeEditorAffectedPaths(
      repositoryPath,
      root,
      sourcePath
    )

    await renamePath(sourceAbsolutePath, destinationAbsolutePath)
    for (const oldPath of affectedPaths) {
      const nextPath = replaceCodeEditorPathPrefix(
        oldPath,
        sourcePath,
        destinationPath
      )
      await this.moveCodeEditorCachePath(root, oldPath, nextPath)
    }

    return destinationPath
  }

  private async deleteCodeEditorPath(
    repositoryPath: string,
    branchKey: string,
    relativePath: string
  ) {
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)
    const sourcePath = assertCodeEditorRelativePath(relativePath)
    const sourceAbsolutePath = resolveInsideDirectory(
      repositoryPath,
      sourcePath
    )
    await this.pathGuard.assertAllowed(sourceAbsolutePath)
    if (!(await pathExistsOnDisk(sourceAbsolutePath))) {
      throw new Error('The selected file or folder no longer exists.')
    }

    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const affectedPaths = await this.collectCodeEditorAffectedPaths(
      repositoryPath,
      root,
      sourcePath
    )

    await rm(sourceAbsolutePath, { recursive: true, force: true })
    for (const path of affectedPaths) {
      await this.removeCodeEditorCachePath(root, path)
    }
    await rm(resolveCodeEditorTempFilePath(root, sourcePath), {
      recursive: true,
      force: true,
    })
  }

  private async collectCodeEditorAffectedPaths(
    repositoryPath: string,
    root: string,
    sourcePath: string
  ) {
    const paths = new Set<string>()
    const sourceAbsolutePath = resolveInsideDirectory(
      repositoryPath,
      sourcePath
    )
    const sourceStats = await lstat(sourceAbsolutePath)

    if (sourceStats.isFile()) {
      paths.add(sourcePath)
    } else if (sourceStats.isDirectory()) {
      for (const path of await listFilesRecursively(
        sourceAbsolutePath,
        repositoryPath
      )) {
        paths.add(path)
      }
    }

    const editLogRoot = Path.join(root, '.cm_editlog')
    if (await pathExistsOnDisk(editLogRoot)) {
      for (const entry of await readdir(editLogRoot)) {
        const raw = await readOptionalTextFile(Path.join(editLogRoot, entry))
        if (raw === null) {
          continue
        }
        try {
          const logValue = JSON.parse(raw) as ICodeEditorFileEditLog
          if (
            typeof logValue.relativePath === 'string' &&
            isCodeEditorPathWithin(logValue.relativePath, sourcePath)
          ) {
            paths.add(logValue.relativePath)
          }
        } catch {
          // Corrupt logs are ignored and will not block file operations.
        }
      }
    }

    return Array.from(paths)
  }

  private async moveCodeEditorCachePath(
    root: string,
    sourcePath: string,
    destinationPath: string
  ) {
    const sourceTempPath = resolveCodeEditorTempFilePath(root, sourcePath)
    const destinationTempPath = resolveCodeEditorTempFilePath(
      root,
      destinationPath
    )
    if (await pathExistsOnDisk(sourceTempPath)) {
      await mkdir(Path.dirname(destinationTempPath), { recursive: true })
      await renamePath(sourceTempPath, destinationTempPath)
    }

    const log = await this.readCodeEditorEditLog(root, sourcePath)
    if (log !== null) {
      await this.writeCodeEditorEditLog(root, destinationPath, {
        ...log,
        relativePath: destinationPath,
        updatedAt: Date.now(),
      })
      await rm(resolveCodeEditorEditLogPath(root, sourcePath), { force: true })
    }

    const sourceConflictPath = Path.join(
      root,
      '.cm_conflicts',
      hashCodeEditorPath(sourcePath)
    )
    const destinationConflictPath = Path.join(
      root,
      '.cm_conflicts',
      hashCodeEditorPath(destinationPath)
    )
    if (await pathExistsOnDisk(sourceConflictPath)) {
      await mkdir(Path.dirname(destinationConflictPath), { recursive: true })
      await renamePath(sourceConflictPath, destinationConflictPath)
    }
  }

  private async removeCodeEditorCachePath(root: string, relativePath: string) {
    await rm(resolveCodeEditorTempFilePath(root, relativePath), {
      recursive: true,
      force: true,
    })
    await rm(resolveCodeEditorEditLogPath(root, relativePath), { force: true })
    await rm(
      Path.join(root, '.cm_conflicts', hashCodeEditorPath(relativePath)),
      { recursive: true, force: true }
    )
  }

  private async readCodeEditorConflictFile(
    repositoryPath: string,
    branchKey: string,
    relativePath: string,
    conflictID: string
  ): Promise<ICodeEditorConflictFile | null> {
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)
    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    const normalizedPath = assertCodeEditorRelativePath(relativePath)
    const conflictPath = resolveCodeEditorConflictFilePath(
      root,
      normalizedPath,
      conflictID
    )

    if (!(await pathExistsOnDisk(conflictPath))) {
      return null
    }

    const contents = await readFile(conflictPath, 'utf8')
    assertCodeEditorTextFile(contents)

    return {
      id: conflictID,
      contents,
      lineEnding: detectRawLineEnding(contents),
    }
  }

  private async removeCodeEditorConflictFile(
    repositoryPath: string,
    branchKey: string,
    relativePath: string,
    conflictID: string
  ) {
    await this.activateCodeEditorBranchCache(repositoryPath, branchKey)
    const root = this.getCodeEditorRepositoryTempRoot(repositoryPath)
    await rm(
      resolveCodeEditorConflictFilePath(
        root,
        assertCodeEditorRelativePath(relativePath),
        conflictID
      ),
      { force: true }
    )
  }

  private async createCodeEditorDiff(
    repository: Repository,
    branchKey: string,
    relativePath: string,
    mode: CodeEditorDiffMode,
    expansions: ReadonlyArray<ICodeEditorDiffExpansion>
  ): Promise<ICodeEditorDiffResult> {
    const startedAt = Date.now()
    await this.pathGuard.assertAllowed(repository.path)
    await this.activateCodeEditorBranchCache(repository.path, branchKey)

    const normalizedPath = assertCodeEditorRelativePath(relativePath)
    const root = this.getCodeEditorRepositoryTempRoot(repository.path)
    const currentContents = await this.readCodeEditorCurrentContents(
      repository.path,
      root,
      normalizedPath
    )
    const headContents = await this.readCodeEditorHeadContents(
      repository,
      normalizedPath
    )
    const original = normalizeEditorText(headContents)
    const current = normalizeEditorText(currentContents)
    const unchanged = original === current

    const unifiedRows = createFoldedLineDiffRows(
      createLineDiffRows(original, current),
      expansions
    )
    const rows =
      mode === 'split'
        ? createFoldedSideBySideDiffRows(unifiedRows)
        : unifiedRows
    const duration = Date.now() - startedAt

    log.info(
      `[CodeEditor] diff generated path='${normalizedPath}' mode='${mode}' rows=${
        rows.length
      } collapsed=${
        rows.filter(row => row.kind === 'collapsed').length
      } durationMs=${duration}`
    )

    return {
      mode,
      relativePath: normalizedPath,
      unchanged,
      truncated: false,
      totalRows: rows.length,
      rows,
    }
  }

  private async readCodeEditorCurrentContents(
    repositoryPath: string,
    root: string,
    relativePath: string
  ) {
    const tempPath = resolveCodeEditorTempFilePath(root, relativePath)

    if (await pathExistsOnDisk(tempPath)) {
      const contents = await readFile(tempPath, 'utf8')
      assertCodeEditorTextFile(contents)
      return contents
    }

    const workingTreePath = resolveInsideDirectory(repositoryPath, relativePath)
    if (!(await pathExistsOnDisk(workingTreePath))) {
      return ''
    }

    const contents = await readFile(workingTreePath, 'utf8')
    assertCodeEditorTextFile(contents)
    return contents
  }

  private async readCodeEditorHeadContents(
    repository: Repository,
    relativePath: string
  ) {
    try {
      const contents = await getPartialBlobContents(
        repository,
        'HEAD',
        relativePath,
        maxCodeEditorPreviewBlobBytes
      )

      return contents === null ? '' : contents.toString('utf8')
    } catch {
      return ''
    }
  }

  private async ensureCodeEditorBranchCacheActive(
    root: string,
    branchKey: string
  ) {
    const branchMarkerPath = Path.join(root, '.cm_branch')
    const activeBranchKey = await readOptionalTextFile(branchMarkerPath)

    if (activeBranchKey !== null && activeBranchKey !== branchKey) {
      await this.archiveActiveCodeEditorBranchCache(root, activeBranchKey)
      await clearCodeEditorActiveCache(root)
    }

    if (activeBranchKey !== branchKey) {
      await restoreCodeEditorBranchCache(root, branchKey)
    }

    await writeFile(branchMarkerPath, branchKey, 'utf8')
  }

  private async archiveActiveCodeEditorBranchCache(
    root: string,
    branchKey: string
  ) {
    const branchArchivePath = getCodeEditorBranchArchivePath(root, branchKey)

    await rm(branchArchivePath, { recursive: true, force: true })
    await mkdir(branchArchivePath, { recursive: true })
    await copyCodeEditorActiveCache(root, branchArchivePath)
  }

  private async archiveCodeEditorConflictFile(
    root: string,
    relativePath: string,
    contents: string,
    lineEnding: CodeEditorLineEnding
  ): Promise<ICodeEditorConflictFile> {
    const id = `${Date.now()}-${hashCodeEditorContents(contents).slice(0, 12)}`
    const conflictPath = resolveCodeEditorConflictFilePath(
      root,
      relativePath,
      id
    )
    await mkdir(Path.dirname(conflictPath), { recursive: true })
    await writeFile(
      conflictPath,
      applyRawLineEnding(contents, lineEnding),
      'utf8'
    )

    return { id, contents, lineEnding }
  }

  private async readCodeEditorEditLog(
    root: string,
    relativePath: string
  ): Promise<ICodeEditorFileEditLog | null> {
    const logPath = resolveCodeEditorEditLogPath(root, relativePath)
    const raw = await readOptionalTextFile(logPath)

    if (raw === null) {
      return null
    }

    try {
      const value = JSON.parse(raw) as ICodeEditorFileEditLog

      if (
        value !== null &&
        value.relativePath === relativePath &&
        typeof value.baseHash === 'string' &&
        (value.lineEnding === 'lf' || value.lineEnding === 'crlf') &&
        Array.isArray(value.undoStack) &&
        Array.isArray(value.redoStack)
      ) {
        return value
      }
    } catch {
      // Stale or corrupt edit logs are ignored and overwritten on the next edit.
    }

    return null
  }

  private async writeCodeEditorEditLog(
    root: string,
    relativePath: string,
    value: ICodeEditorFileEditLog
  ) {
    const logPath = resolveCodeEditorEditLogPath(root, relativePath)
    await mkdir(Path.dirname(logPath), { recursive: true })
    await writeFile(logPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  private async removeCodeEditorTempFileFromRoot(
    root: string,
    relativePath: string
  ) {
    await rm(resolveCodeEditorTempFilePath(root, relativePath), { force: true })
    await rm(resolveCodeEditorEditLogPath(root, relativePath), { force: true })
  }

  private getCodeEditorRepositoryTempRoot(repositoryPath: string) {
    return Path.join(
      getCodeEditorTempBaseDirectory(),
      createCodeEditorRepositoryTempDirectoryName(repositoryPath)
    )
  }

  private assertCodeEditorBranchKey(branchKey: string) {
    if (typeof branchKey !== 'string' || branchKey.length === 0) {
      throw new Error('Invalid CodeMirror editor branch key')
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

function getCodeEditorTempBaseDirectory() {
  return Path.join(getWebUIDeploymentDirectory(), 'tmp')
}

function getWebUIDeploymentDirectory() {
  const dataDirectory = getWebUIDataDirectory()
  return Path.basename(dataDirectory) === '.gitdesk-webui'
    ? Path.dirname(dataDirectory)
    : dataDirectory
}

function getWebUIDataDirectory() {
  const fromEnv = process.env.GITDESK_WEBUI_DATA_DIR
  const fromArgs = getArgValue('--data-dir')
  const raw =
    fromEnv && fromEnv.trim().length > 0
      ? fromEnv
      : fromArgs && fromArgs.trim().length > 0
      ? fromArgs
      : Path.join(process.cwd(), '.gitdesk-webui')

  return Path.resolve(raw)
}

function getArgValue(name: string) {
  const index = process.argv.indexOf(name)

  if (index < 0) {
    return undefined
  }

  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function createCodeEditorRepositoryTempDirectoryName(repositoryPath: string) {
  const name = Path.basename(Path.resolve(repositoryPath))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .trim()
  const hash = createHash('sha256')
    .update(Path.resolve(repositoryPath))
    .digest('hex')
    .slice(0, 8)

  return `${name.length > 0 ? name : 'repository'}-${hash}`
}

function createCodeEditorPanelMemoryKey(
  repositoryPath: string,
  branchKey: string
) {
  return `${Path.resolve(repositoryPath)}\0${branchKey}`
}

function assertCodeEditorRelativePath(relativePath: string) {
  const normalizedPath = normalizeRepositoryRelativePath(relativePath)

  if (
    normalizedPath.length === 0 ||
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.startsWith('../') ||
    Path.isAbsolute(normalizedPath)
  ) {
    throw new Error('Invalid CodeMirror editor file path')
  }

  return normalizedPath
}

function resolveCodeEditorTempFilePath(root: string, relativePath: string) {
  return resolveInsideDirectory(
    root,
    assertCodeEditorRelativePath(relativePath)
  )
}

function resolveCodeEditorEditLogPath(root: string, relativePath: string) {
  return Path.join(
    root,
    '.cm_editlog',
    `${hashCodeEditorPath(relativePath)}.json`
  )
}

function resolveCodeEditorConflictFilePath(
  root: string,
  relativePath: string,
  conflictID: string
) {
  if (!/^[a-zA-Z0-9._-]+$/.test(conflictID)) {
    throw new Error('Invalid CodeMirror editor conflict id')
  }

  return Path.join(
    root,
    '.cm_conflicts',
    hashCodeEditorPath(relativePath),
    conflictID
  )
}

function resolveInsideDirectory(root: string, relativePath: string) {
  const absoluteRoot = Path.resolve(root)
  const absolutePath = Path.resolve(absoluteRoot, relativePath)
  const relativeToRoot = Path.relative(absoluteRoot, absolutePath)

  if (
    relativeToRoot.startsWith('..') ||
    Path.isAbsolute(relativeToRoot) ||
    relativeToRoot.length === 0
  ) {
    throw new Error('Invalid CodeMirror editor cache path')
  }

  return absolutePath
}

function getCodeEditorBranchArchivePath(root: string, branchKey: string) {
  return Path.join(root, '.git', hashCodeEditorPath(branchKey))
}

async function restoreCodeEditorBranchCache(root: string, branchKey: string) {
  const branchArchivePath = getCodeEditorBranchArchivePath(root, branchKey)

  if (!(await pathExistsOnDisk(branchArchivePath))) {
    return
  }

  await copyDirectoryContents(branchArchivePath, root)
}

async function clearCodeEditorActiveCache(root: string) {
  if (!(await pathExistsOnDisk(root))) {
    return
  }

  for (const entry of await readdir(root)) {
    if (entry === '.git') {
      continue
    }

    await rm(Path.join(root, entry), { recursive: true, force: true })
  }
}

async function copyCodeEditorActiveCache(root: string, destination: string) {
  if (!(await pathExistsOnDisk(root))) {
    return
  }

  for (const entry of await readdir(root)) {
    if (entry === '.git') {
      continue
    }

    await copyPath(Path.join(root, entry), Path.join(destination, entry))
  }
}

async function copyDirectoryContents(source: string, destination: string) {
  await mkdir(destination, { recursive: true })

  for (const entry of await readdir(source)) {
    await copyPath(Path.join(source, entry), Path.join(destination, entry))
  }
}

async function copyPath(source: string, destination: string) {
  const stats = await lstat(source)

  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: true })
    await copyDirectoryContents(source, destination)
    return
  }

  if (stats.isFile()) {
    await mkdir(Path.dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
}

async function listFilesRecursively(
  directory: string,
  repositoryPath: string
): Promise<ReadonlyArray<string>> {
  const files = new Array<string>()

  for (const entry of await readdir(directory)) {
    const fullPath = Path.join(directory, entry)
    const stats = await lstat(fullPath)
    if (stats.isSymbolicLink()) {
      continue
    }
    if (stats.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath, repositoryPath)))
    } else if (stats.isFile()) {
      files.push(
        normalizeRepositoryRelativePath(Path.relative(repositoryPath, fullPath))
      )
    }
  }

  return files
}

async function readOptionalTextFile(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return null
    }

    throw error
  }
}

function assertCodeEditorTextFile(contents: string) {
  if (contents.includes('\0')) {
    throw new Error('Binary files cannot be opened in CodeMirror Editor.')
  }
}

function hashCodeEditorContents(contents: string) {
  return createHash('sha256')
    .update(normalizeEditorText(contents))
    .digest('hex')
}

function hashCodeEditorPath(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function detectRawLineEnding(contents: string): CodeEditorLineEnding {
  return contents.includes('\r\n') ? 'crlf' : 'lf'
}

function applyRawLineEnding(
  contents: string,
  lineEnding: CodeEditorLineEnding
) {
  const normalized = normalizeEditorText(contents)
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}

function createCodeEditorHistoryStatus(
  log: ICodeEditorFileEditLog | null
): ICodeEditorHistoryStatus {
  return {
    undoCount: log?.undoStack.length ?? 0,
    redoCount: log?.redoStack.length ?? 0,
  }
}

function logCodeEditorHistoryStatus(
  action: string,
  relativePath: string,
  status: ICodeEditorHistoryStatus,
  durationMs: number,
  changed?: boolean
) {
  log.info(
    `[CodeEditor] history ${action} path='${relativePath}' undo=${
      status.undoCount
    } redo=${status.redoCount}${
      changed === undefined ? '' : ` changed=${changed}`
    } durationMs=${durationMs}`
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : `${error}`
}
