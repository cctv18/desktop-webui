import { invokeWebUIRPC } from '../../lib/webui-rpc'
import {
  CodeEditorSplitDiffRow,
  CodeEditorUnifiedDiffRow,
} from './code-editor-model'

export type CodeEditorPanelSelection = 'commit-management' | 'code-editor'
export type CodeEditorLineEnding = 'lf' | 'crlf'
export type CodeEditorDiffMode = 'unified' | 'split'

export interface ICodeEditorConflictFile {
  readonly id: string
  readonly contents: string
  readonly lineEnding: CodeEditorLineEnding
}

export interface ICodeEditorTempFileStatus {
  readonly hasTempFile: boolean
  readonly contents: string | null
  readonly lineEnding: CodeEditorLineEnding | null
  readonly conflict: ICodeEditorConflictFile | null
}

export interface IWriteCodeEditorTempFileOptions {
  readonly branchKey: string
  readonly relativePath: string
  readonly contents: string
  readonly previousContents: string
  readonly previousLineEnding: CodeEditorLineEnding
  readonly baseContents: string
  readonly lineEnding: CodeEditorLineEnding
}

export interface ICodeEditorDiffResult {
  readonly mode: CodeEditorDiffMode
  readonly relativePath: string
  readonly unchanged: boolean
  readonly truncated: boolean
  readonly totalRows: number
  readonly rows:
    | ReadonlyArray<CodeEditorUnifiedDiffRow>
    | ReadonlyArray<CodeEditorSplitDiffRow>
}

export type CodeEditorHistoryAction = 'undo' | 'redo'

export interface ICodeEditorHistoryStatus {
  readonly undoCount: number
  readonly redoCount: number
}

export interface ICodeEditorHistoryActionResult
  extends ICodeEditorHistoryStatus {
  readonly contents: string
  readonly lineEnding: CodeEditorLineEnding
  readonly changed: boolean
}

export async function readCodeEditorStorageItem(key: string) {
  return invokeWebUIRPC<string | null>('codeEditor.readStorageItem', [key])
}

export async function writeCodeEditorStorageItem(key: string, value: string) {
  return invokeWebUIRPC<void>('codeEditor.writeStorageItem', [key, value])
}

export async function removeCodeEditorStorageItem(key: string) {
  return invokeWebUIRPC<void>('codeEditor.removeStorageItem', [key])
}

export async function purgeLegacyCodeEditorStorage() {
  return invokeWebUIRPC<void>('codeEditor.purgeLegacyStorage', [])
}

export async function readCodeEditorPanelSelection(
  repositoryPath: string,
  branchKey: string
) {
  return invokeWebUIRPC<CodeEditorPanelSelection>(
    'codeEditor.readPanelSelection',
    [repositoryPath, branchKey]
  )
}

export async function writeCodeEditorPanelSelection(
  repositoryPath: string,
  branchKey: string,
  panel: CodeEditorPanelSelection
) {
  return invokeWebUIRPC<void>('codeEditor.writePanelSelection', [
    repositoryPath,
    branchKey,
    panel,
  ])
}

export async function clearCodeEditorRepositoryCache(repositoryPath: string) {
  return invokeWebUIRPC<void>('codeEditor.clearRepositoryCache', [
    repositoryPath,
  ])
}

export async function activateCodeEditorBranchCache(
  repositoryPath: string,
  branchKey: string
) {
  return invokeWebUIRPC<void>('codeEditor.activateBranchCache', [
    repositoryPath,
    branchKey,
  ])
}

export async function readCodeEditorTempFileStatus(
  repositoryPath: string,
  branchKey: string,
  relativePath: string,
  currentContents: string
) {
  return invokeWebUIRPC<ICodeEditorTempFileStatus>(
    'codeEditor.readTempFileStatus',
    [repositoryPath, branchKey, relativePath, currentContents]
  )
}

export async function writeCodeEditorTempFile(
  repositoryPath: string,
  options: IWriteCodeEditorTempFileOptions
) {
  return invokeWebUIRPC<void>('codeEditor.writeTempFile', [
    repositoryPath,
    options,
  ])
}

export async function readCodeEditorHistoryStatus(
  repositoryPath: string,
  branchKey: string,
  relativePath: string
) {
  return invokeWebUIRPC<ICodeEditorHistoryStatus>(
    'codeEditor.readHistoryStatus',
    [repositoryPath, branchKey, relativePath]
  )
}

export async function applyCodeEditorHistoryAction(
  repositoryPath: string,
  branchKey: string,
  relativePath: string,
  action: CodeEditorHistoryAction
) {
  return invokeWebUIRPC<ICodeEditorHistoryActionResult>(
    'codeEditor.applyHistoryAction',
    [repositoryPath, branchKey, relativePath, action]
  )
}

export async function removeCodeEditorTempFile(
  repositoryPath: string,
  branchKey: string,
  relativePath: string
) {
  return invokeWebUIRPC<void>('codeEditor.removeTempFile', [
    repositoryPath,
    branchKey,
    relativePath,
  ])
}

export async function readCodeEditorConflictFile(
  repositoryPath: string,
  branchKey: string,
  relativePath: string,
  conflictID: string
) {
  return invokeWebUIRPC<ICodeEditorConflictFile | null>(
    'codeEditor.readConflictFile',
    [repositoryPath, branchKey, relativePath, conflictID]
  )
}

export async function removeCodeEditorConflictFile(
  repositoryPath: string,
  branchKey: string,
  relativePath: string,
  conflictID: string
) {
  return invokeWebUIRPC<void>('codeEditor.removeConflictFile', [
    repositoryPath,
    branchKey,
    relativePath,
    conflictID,
  ])
}

export async function createCodeEditorDiff(
  repository: unknown,
  branchKey: string,
  relativePath: string,
  mode: CodeEditorDiffMode,
  expandedRegionIDs: ReadonlyArray<string>
) {
  return invokeWebUIRPC<ICodeEditorDiffResult>('codeEditor.createDiff', [
    repository,
    branchKey,
    relativePath,
    mode,
    expandedRegionIDs,
  ])
}
