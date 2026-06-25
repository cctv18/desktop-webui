export type CodeEditorPanel = 'commit-management' | 'code-editor'
export type CodeEditorLineEnding = 'lf' | 'crlf'

export interface ICodeEditorSearchOptions {
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly useRegex: boolean
}

export interface ICodeEditorSearchMatch {
  readonly from: number
  readonly to: number
  readonly text: string
}

export type CodeEditorTreeNode =
  | {
      readonly kind: 'directory'
      readonly name: string
      readonly path: string
      readonly children: ReadonlyArray<CodeEditorTreeNode>
    }
  | {
      readonly kind: 'file'
      readonly name: string
      readonly path: string
    }

type MutableDirectoryNode = {
  kind: 'directory'
  name: string
  path: string
  children: CodeEditorTreeNode[]
}

const draftStoragePrefix = 'gitdesk-webui:code-editor:draft:'

export function normalizeRepositoryRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

export function createCodeEditorDraftKey(
  repositoryPath: string,
  branchName: string,
  relativePath: string
) {
  const payload = JSON.stringify({
    repositoryPath,
    branchName,
    relativePath: normalizeRepositoryRelativePath(relativePath),
  })

  return `${draftStoragePrefix}${encodeURIComponent(payload)}`
}

export function buildFileTreeFromPaths(
  paths: ReadonlyArray<string>
): ReadonlyArray<CodeEditorTreeNode> {
  const root: MutableDirectoryNode = {
    kind: 'directory',
    name: '',
    path: '',
    children: [],
  }

  for (const rawPath of paths) {
    const normalizedPath = normalizeRepositoryRelativePath(rawPath)
    if (normalizedPath.length === 0) {
      continue
    }

    const segments = normalizedPath.split('/').filter(x => x.length > 0)
    let current = root

    for (let index = 0; index < segments.length; index++) {
      const name = segments[index]
      const childPath = segments.slice(0, index + 1).join('/')
      const isFile = index === segments.length - 1

      if (isFile) {
        if (!current.children.some(child => child.path === childPath)) {
          current.children.push({ kind: 'file', name, path: childPath })
        }
        continue
      }

      let directory = current.children.find(
        child => child.kind === 'directory' && child.path === childPath
      ) as MutableDirectoryNode | undefined

      if (directory === undefined) {
        directory = { kind: 'directory', name, path: childPath, children: [] }
        current.children.push(directory)
      }

      current = directory
    }
  }

  sortTree(root.children)
  return root.children
}

export function detectLineEnding(text: string): CodeEditorLineEnding {
  return text.includes('\r\n') ? 'crlf' : 'lf'
}

export function normalizeEditorText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function applyLineEnding(
  text: string,
  lineEnding: CodeEditorLineEnding
) {
  const normalized = normalizeEditorText(text)
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}

export function findSearchMatches(
  text: string,
  query: string,
  options: ICodeEditorSearchOptions
): ReadonlyArray<ICodeEditorSearchMatch> {
  if (query.length === 0) {
    return []
  }

  const expression = createSearchExpression(query, options)
  if (expression === null) {
    return []
  }

  const matches = new Array<ICodeEditorSearchMatch>()
  let match: RegExpExecArray | null = null

  while ((match = expression.exec(text)) !== null) {
    if (match[0].length === 0) {
      expression.lastIndex++
      continue
    }

    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      text: match[0],
    })
  }

  return matches
}

export function replaceSearchMatch(
  text: string,
  match: ICodeEditorSearchMatch,
  replacement: string
) {
  return `${text.slice(0, match.from)}${replacement}${text.slice(match.to)}`
}

export function replaceAllSearchMatches(
  text: string,
  matches: ReadonlyArray<ICodeEditorSearchMatch>,
  replacement: string
) {
  return matches
    .slice()
    .reverse()
    .reduce(
      (value, match) => replaceSearchMatch(value, match, replacement),
      text
    )
}

export function createUnifiedDiff(
  original: string,
  current: string,
  relativePath: string
) {
  if (original === current) {
    return `No changes in ${relativePath}`
  }

  const oldLines = normalizeEditorText(original).split('\n')
  const newLines = normalizeEditorText(current).split('\n')
  const rows = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ]
  const max = Math.max(oldLines.length, newLines.length)

  for (let index = 0; index < max; index++) {
    const oldLine = oldLines[index]
    const newLine = newLines[index]

    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        rows.push(` ${oldLine}`)
      }
      continue
    }

    if (oldLine !== undefined) {
      rows.push(`-${oldLine}`)
    }

    if (newLine !== undefined) {
      rows.push(`+${newLine}`)
    }
  }

  return rows.join('\n')
}

function sortTree(nodes: CodeEditorTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1
    }

    return a.name.localeCompare(b.name)
  })

  for (const node of nodes) {
    if (node.kind === 'directory') {
      sortTree(node.children as CodeEditorTreeNode[])
    }
  }
}

function createSearchExpression(
  query: string,
  options: ICodeEditorSearchOptions
) {
  try {
    const flags = options.caseSensitive ? 'g' : 'gi'
    const source = options.useRegex ? query : escapeRegExp(query)
    const wholeWordSource = options.wholeWord ? `\\b(?:${source})\\b` : source
    return new RegExp(wholeWordSource, flags)
  } catch {
    return null
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
