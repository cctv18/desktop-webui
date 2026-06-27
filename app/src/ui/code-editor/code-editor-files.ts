import * as Path from 'path'
import { Repository } from '../../models/repository'
import { getPartialBlobContents } from '../../lib/git/show'
import { invokeWebUIRPC } from '../../lib/webui-rpc'
import {
  applyLineEnding,
  CodeEditorLineEnding,
  normalizeRepositoryRelativePath,
} from './code-editor-model'
import {
  activateCodeEditorBranchCache,
  applyCodeEditorHistoryAction,
  clearCodeEditorRepositoryCache,
  CodeEditorHistoryAction,
  CodeEditorDiffMode,
  createCodeEditorDiff,
  ICodeEditorDiffResult,
  ICodeEditorTempFileStatus,
  IWriteCodeEditorTempFileOptions,
  readCodeEditorConflictFile,
  readCodeEditorHistoryStatus,
  readCodeEditorTempFileStatus,
  removeCodeEditorConflictFile,
  removeCodeEditorTempFile,
  writeCodeEditorTempFile,
} from './code-editor-storage'

const maxPreviewBlobBytes = 5 * 1024 * 1024

export interface ICodeEditorFileListOptions {
  readonly ignoredPaths: ReadonlyArray<string>
  readonly showIgnoredPaths: boolean
}

export async function listRepositoryFiles(
  repository: Repository,
  options: ICodeEditorFileListOptions
) {
  return invokeWebUIRPC<ReadonlyArray<string>>(
    'codeEditor.listRepositoryFiles',
    [repository.path, options]
  )
}

export async function readRepositoryTextFile(
  repository: Repository,
  relativePath: string
) {
  const fullPath = getRepositoryFilePath(repository, relativePath)
  const contents = await invokeWebUIRPC<string>('filesystem.readFile', [
    fullPath,
    'utf8',
  ])

  if (contents.includes('\0')) {
    throw new Error('Binary files cannot be opened in CodeMirror Editor.')
  }

  return contents
}

export async function writeRepositoryTextFile(
  repository: Repository,
  relativePath: string,
  contents: string,
  lineEnding: CodeEditorLineEnding
) {
  return invokeWebUIRPC<void>('filesystem.writeFile', [
    getRepositoryFilePath(repository, relativePath),
    applyLineEnding(contents, lineEnding),
  ])
}

export async function activateRepositoryEditorBranchCache(
  repository: Repository,
  branchKey: string
) {
  return activateCodeEditorBranchCache(repository.path, branchKey)
}

export async function clearRepositoryEditorCache(repository: Repository) {
  return clearCodeEditorRepositoryCache(repository.path)
}

export async function readRepositoryTempFileStatus(
  repository: Repository,
  branchKey: string,
  relativePath: string,
  currentContents: string
): Promise<ICodeEditorTempFileStatus> {
  return readCodeEditorTempFileStatus(
    repository.path,
    branchKey,
    relativePath,
    currentContents
  )
}

export async function writeRepositoryTempTextFile(
  repository: Repository,
  options: IWriteCodeEditorTempFileOptions
) {
  return writeCodeEditorTempFile(repository.path, {
    ...options,
    contents: applyLineEnding(options.contents, options.lineEnding),
    previousContents: applyLineEnding(
      options.previousContents,
      options.lineEnding
    ),
  })
}

export async function readRepositoryEditorHistoryStatus(
  repository: Repository,
  branchKey: string,
  relativePath: string
) {
  return readCodeEditorHistoryStatus(repository.path, branchKey, relativePath)
}

export async function applyRepositoryEditorHistoryAction(
  repository: Repository,
  branchKey: string,
  relativePath: string,
  action: CodeEditorHistoryAction
) {
  return applyCodeEditorHistoryAction(
    repository.path,
    branchKey,
    relativePath,
    action
  )
}

export async function removeRepositoryTempTextFile(
  repository: Repository,
  branchKey: string,
  relativePath: string
) {
  return removeCodeEditorTempFile(repository.path, branchKey, relativePath)
}

export async function readRepositoryConflictTextFile(
  repository: Repository,
  branchKey: string,
  relativePath: string,
  conflictID: string
) {
  return readCodeEditorConflictFile(
    repository.path,
    branchKey,
    relativePath,
    conflictID
  )
}

export async function removeRepositoryConflictTextFile(
  repository: Repository,
  branchKey: string,
  relativePath: string,
  conflictID: string
) {
  return removeCodeEditorConflictFile(
    repository.path,
    branchKey,
    relativePath,
    conflictID
  )
}

export async function createRepositoryCodeEditorDiff(
  repository: Repository,
  branchKey: string,
  relativePath: string,
  mode: CodeEditorDiffMode
): Promise<ICodeEditorDiffResult> {
  return createCodeEditorDiff(repository, branchKey, relativePath, mode)
}

export async function readHeadTextFile(
  repository: Repository,
  relativePath: string
) {
  const normalizedPath = normalizeRepositoryRelativePath(relativePath)

  try {
    const contents = await getPartialBlobContents(
      repository,
      'HEAD',
      normalizedPath,
      maxPreviewBlobBytes
    )

    return contents === null ? '' : contents.toString('utf8')
  } catch {
    return ''
  }
}

export function getRepositoryFilePath(
  repository: Repository,
  relativePath: string
) {
  return Path.join(
    repository.path,
    normalizeRepositoryRelativePath(relativePath)
  )
}
