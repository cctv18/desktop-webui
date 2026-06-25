import * as Path from 'path'
import { Repository } from '../../models/repository'
import { getPartialBlobContents } from '../../lib/git/show'
import { invokeWebUIRPC } from '../../lib/webui-rpc'
import {
  applyLineEnding,
  CodeEditorLineEnding,
  normalizeRepositoryRelativePath,
} from './code-editor-model'

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
