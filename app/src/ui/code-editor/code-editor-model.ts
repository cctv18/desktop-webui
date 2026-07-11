export type CodeEditorPanel = 'commit-management' | 'code-editor'
export type CodeEditorHistoryAction = 'undo' | 'redo'
export type CodeEditorLineEnding = 'lf' | 'crlf'
export type CodeEditorLanguage =
  | 'cpp'
  | 'css'
  | 'go'
  | 'html'
  | 'java'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'patch'
  | 'python'
  | 'rust'
  | 'yaml'
  | 'unknown'

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

export interface ICodeEditorLineDiffRow {
  readonly kind: 'context' | 'added' | 'removed'
  readonly oldLineNumber: number | null
  readonly newLineNumber: number | null
  readonly oldText: string
  readonly newText: string
}

export interface ICodeEditorSideBySideDiffRow {
  readonly kind: 'context' | 'added' | 'removed' | 'modified'
  readonly oldLineNumber: number | null
  readonly newLineNumber: number | null
  readonly oldText: string
  readonly newText: string
}

export interface ICodeEditorCollapsedDiffRow {
  readonly kind: 'collapsed'
  readonly id: string
  readonly oldStartLine: number
  readonly newStartLine: number
  readonly lineCount: number
  readonly canExpandUp: boolean
  readonly canExpandDown: boolean
  readonly expansionType: CodeEditorDiffExpansionType
}

export type CodeEditorDiffExpansionType = 'up' | 'down' | 'both' | 'all'
export type CodeEditorDiffExpansionAction = 'up' | 'down' | 'all'

export interface ICodeEditorDiffExpansion {
  readonly id: string
  readonly up: number
  readonly down: number
}

export function createCodeEditorDiffExpansion(
  previous: ICodeEditorDiffExpansion | undefined,
  row: ICodeEditorCollapsedDiffRow,
  action: CodeEditorDiffExpansionAction,
  step = 20
): ICodeEditorDiffExpansion {
  let up = previous?.up ?? 0
  let down = previous?.down ?? 0

  if (action === 'up') {
    up += step
  } else if (action === 'down') {
    down += step
  } else if (row.canExpandDown) {
    down += row.lineCount
  } else {
    up += row.lineCount
  }

  return { id: row.id, up, down }
}

export type CodeEditorUnifiedDiffRow =
  | ICodeEditorLineDiffRow
  | ICodeEditorCollapsedDiffRow
export type CodeEditorSplitDiffRow =
  | ICodeEditorSideBySideDiffRow
  | ICodeEditorCollapsedDiffRow

export interface ICodeEditorTextEditAction {
  readonly from: number
  readonly to: number
  readonly deleted: string
  readonly inserted: string
  readonly previousLineEnding?: CodeEditorLineEnding
  readonly nextLineEnding?: CodeEditorLineEnding
  readonly updatedAt: number
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

export const defaultCodeEditorIgnoredPaths = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'out',
  'dist',
  'build',
  '.next',
  '.vite',
  'coverage',
]

export function normalizeRepositoryRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

export function isCodeEditorPathWithin(path: string, parentPath: string) {
  const normalizedPath = normalizeRepositoryRelativePath(path)
  const normalizedParent = normalizeRepositoryRelativePath(parentPath)
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`)
  )
}

export function replaceCodeEditorPathPrefix(
  path: string,
  sourcePath: string,
  destinationPath: string
) {
  const normalizedPath = normalizeRepositoryRelativePath(path)
  const normalizedSource = normalizeRepositoryRelativePath(sourcePath)
  const normalizedDestination = normalizeRepositoryRelativePath(destinationPath)

  if (!isCodeEditorPathWithin(normalizedPath, normalizedSource)) {
    return normalizedPath
  }

  return `${normalizedDestination}${normalizedPath.slice(
    normalizedSource.length
  )}`
}

export function createCodeEditorRenameDestination(
  sourcePath: string,
  newName: string
) {
  const name = newName.trim()
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error('Enter a valid file or folder name.')
  }

  const normalizedSource = normalizeRepositoryRelativePath(sourcePath)
  const separator = normalizedSource.lastIndexOf('/')
  return separator < 0
    ? name
    : `${normalizedSource.slice(0, separator + 1)}${name}`
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

export function parseIgnoredPathList(value: string): ReadonlyArray<string> {
  const paths = new Array<string>()
  const seen = new Set<string>()

  for (const part of value.split(/[,\n]/)) {
    const normalized = normalizeRepositoryRelativePath(part.trim()).replace(
      /\/+$/,
      ''
    )

    if (normalized.length === 0) {
      continue
    }

    const key = normalized.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      paths.push(normalized)
    }
  }

  return paths
}

export function serializeIgnoredPathList(paths: ReadonlyArray<string>) {
  return parseIgnoredPathList(paths.join('\n')).join('\n')
}

export function isRepositoryPathIgnored(
  relativePath: string,
  ignoredPaths: ReadonlyArray<string>
) {
  const normalizedPath =
    normalizeRepositoryRelativePath(relativePath).toLowerCase()
  const segments = normalizedPath.split('/').filter(x => x.length > 0)

  for (const ignoredPath of ignoredPaths) {
    const normalizedIgnoredPath = normalizeRepositoryRelativePath(ignoredPath)
      .replace(/\/+$/, '')
      .toLowerCase()

    if (normalizedIgnoredPath.length === 0) {
      continue
    }

    if (!normalizedIgnoredPath.includes('/')) {
      if (segments.includes(normalizedIgnoredPath)) {
        return true
      }
      continue
    }

    if (
      normalizedPath === normalizedIgnoredPath ||
      normalizedPath.startsWith(`${normalizedIgnoredPath}/`)
    ) {
      return true
    }
  }

  return false
}

export function filterRepositoryFilePaths(
  paths: ReadonlyArray<string>,
  ignoredPaths: ReadonlyArray<string>,
  showIgnoredPaths: boolean
) {
  return paths
    .map(normalizeRepositoryRelativePath)
    .filter(path => path.length > 0)
    .filter(
      path => showIgnoredPaths || !isRepositoryPathIgnored(path, ignoredPaths)
    )
    .sort((a, b) => a.localeCompare(b))
}

export function detectLineEnding(
  text: string,
  fallback: CodeEditorLineEnding = 'lf'
): CodeEditorLineEnding {
  if (text.length === 0) {
    return fallback
  }

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

export function createCodeEditorTextEditAction(
  previousContents: string,
  nextContents: string,
  previousLineEnding: CodeEditorLineEnding = 'lf',
  nextLineEnding: CodeEditorLineEnding = previousLineEnding
): ICodeEditorTextEditAction {
  const previous = normalizeEditorText(previousContents)
  const next = normalizeEditorText(nextContents)
  let prefix = 0
  const maxPrefix = Math.min(previous.length, next.length)

  while (
    prefix < maxPrefix &&
    previous.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix++
  }

  let previousEnd = previous.length
  let nextEnd = next.length

  while (
    previousEnd > prefix &&
    nextEnd > prefix &&
    previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    previousEnd--
    nextEnd--
  }

  return {
    from: prefix,
    to: previousEnd,
    deleted: previous.slice(prefix, previousEnd),
    inserted: next.slice(prefix, nextEnd),
    previousLineEnding,
    nextLineEnding,
    updatedAt: Date.now(),
  }
}

export function applyCodeEditorHistoryAction(
  contents: string,
  action: ICodeEditorTextEditAction,
  direction: 'undo' | 'redo',
  fallbackLineEnding: CodeEditorLineEnding = 'lf'
) {
  return {
    contents: applyCodeEditorTextEditAction(contents, action, direction),
    lineEnding:
      (direction === 'undo'
        ? action.previousLineEnding
        : action.nextLineEnding) ?? fallbackLineEnding,
  }
}

export function canApplyCodeEditorHistoryAction(
  action: CodeEditorHistoryAction,
  undoCount: number,
  redoCount: number
) {
  return action === 'undo' ? undoCount > 0 : redoCount > 0
}

export function isCodeEditorDocumentDirty(
  editorContents: string,
  diskContents: string,
  lineEnding: CodeEditorLineEnding,
  diskLineEnding: CodeEditorLineEnding
) {
  return editorContents !== diskContents || lineEnding !== diskLineEnding
}

export function applyCodeEditorTextEditAction(
  contents: string,
  action: ICodeEditorTextEditAction,
  direction: 'undo' | 'redo'
) {
  const normalizedContents = normalizeEditorText(contents)
  const expected = direction === 'undo' ? action.inserted : action.deleted
  const replacement = direction === 'undo' ? action.deleted : action.inserted
  const start = action.from
  const end = start + expected.length

  if (
    start < 0 ||
    start > normalizedContents.length ||
    normalizedContents.slice(start, end) !== expected
  ) {
    throw new Error(
      'The persisted CodeMirror editor history no longer matches the cached file contents.'
    )
  }

  return `${normalizedContents.slice(
    0,
    start
  )}${replacement}${normalizedContents.slice(end)}`
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

  const oldLines = splitEditorLines(original)
  const newLines = splitEditorLines(current)
  const rows = [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ]

  for (const row of createLineDiffRows(original, current)) {
    if (row.kind === 'context') {
      rows.push(` ${row.oldText}`)
    } else if (row.kind === 'removed') {
      rows.push(`-${row.oldText}`)
    } else {
      rows.push(`+${row.newText}`)
    }
  }

  return rows.join('\n')
}

export function createLineDiffRows(
  original: string,
  current: string
): ReadonlyArray<ICodeEditorLineDiffRow> {
  const oldLines = splitEditorLines(original)
  const newLines = splitEditorLines(current)
  const operations = createLineDiffOperations(oldLines, newLines)
  const rows = new Array<ICodeEditorLineDiffRow>()
  let oldLineNumber = 1
  let newLineNumber = 1

  for (const operation of operations) {
    switch (operation.kind) {
      case 'context':
        rows.push({
          kind: 'context',
          oldLineNumber,
          newLineNumber,
          oldText: operation.text,
          newText: operation.text,
        })
        oldLineNumber++
        newLineNumber++
        break
      case 'removed':
        rows.push({
          kind: 'removed',
          oldLineNumber,
          newLineNumber: null,
          oldText: operation.text,
          newText: '',
        })
        oldLineNumber++
        break
      case 'added':
        rows.push({
          kind: 'added',
          oldLineNumber: null,
          newLineNumber,
          oldText: '',
          newText: operation.text,
        })
        newLineNumber++
        break
    }
  }

  return rows
}

export function createSideBySideDiffRows(
  original: string,
  current: string
): ReadonlyArray<ICodeEditorSideBySideDiffRow> {
  const rows = createLineDiffRows(original, current)
  return createSideBySideRowsFromLineRows(rows)
}

export function createFoldedLineDiffRows(
  rows: ReadonlyArray<ICodeEditorLineDiffRow>,
  expansions: ReadonlyArray<ICodeEditorDiffExpansion>,
  contextLines = 3
): ReadonlyArray<CodeEditorUnifiedDiffRow> {
  const expansionByID = new Map(expansions.map(value => [value.id, value]))
  const result = new Array<CodeEditorUnifiedDiffRow>()

  for (let index = 0; index < rows.length; ) {
    if (rows[index].kind !== 'context') {
      result.push(rows[index++])
      continue
    }

    const start = index
    while (index < rows.length && rows[index].kind === 'context') {
      index++
    }
    const end = index
    const leading = start === 0
    const trailing = end === rows.length
    const keepBefore = leading ? 0 : Math.min(contextLines, end - start)
    const keepAfter = trailing
      ? 0
      : Math.min(contextLines, end - start - keepBefore)
    const collapsedStart = start + keepBefore
    const collapsedEnd = end - keepAfter

    result.push(...rows.slice(start, collapsedStart))

    if (collapsedEnd > collapsedStart) {
      const first = rows[collapsedStart]
      const id = `${first.oldLineNumber}:${first.newLineNumber}:${
        collapsedEnd - collapsedStart
      }`
      const expansion = expansionByID.get(id)
      const canExpandDown = !leading
      const canExpandUp = !trailing
      const down = canExpandDown
        ? Math.max(
            0,
            Math.min(expansion?.down ?? 0, collapsedEnd - collapsedStart)
          )
        : 0
      const up = canExpandUp
        ? Math.max(
            0,
            Math.min(expansion?.up ?? 0, collapsedEnd - collapsedStart - down)
          )
        : 0
      const remainingStart = collapsedStart + down
      const remainingEnd = collapsedEnd - up

      result.push(...rows.slice(collapsedStart, remainingStart))

      if (remainingStart >= remainingEnd) {
        result.push(...rows.slice(remainingStart, collapsedEnd))
      } else {
        const remainingFirst = rows[remainingStart]
        result.push({
          kind: 'collapsed',
          id,
          oldStartLine: remainingFirst.oldLineNumber ?? 1,
          newStartLine: remainingFirst.newLineNumber ?? 1,
          lineCount: remainingEnd - remainingStart,
          canExpandUp,
          canExpandDown,
          expansionType:
            remainingEnd - remainingStart <= 20
              ? 'all'
              : canExpandUp && canExpandDown
              ? 'both'
              : canExpandUp
              ? 'up'
              : 'down',
        })
        result.push(...rows.slice(remainingEnd, collapsedEnd))
      }
    }

    result.push(...rows.slice(collapsedEnd, end))
  }

  return result
}

export function createFoldedSideBySideDiffRows(
  rows: ReadonlyArray<CodeEditorUnifiedDiffRow>
): ReadonlyArray<CodeEditorSplitDiffRow> {
  const result = new Array<CodeEditorSplitDiffRow>()
  let lineRows = new Array<ICodeEditorLineDiffRow>()

  const flush = () => {
    if (lineRows.length > 0) {
      result.push(...createSideBySideRowsFromLineRows(lineRows))
      lineRows = []
    }
  }

  for (const row of rows) {
    if (row.kind === 'collapsed') {
      flush()
      result.push(row)
    } else {
      lineRows.push(row)
    }
  }
  flush()
  return result
}

export function formatCodeEditorCollapsedDiffHeader(
  row: ICodeEditorCollapsedDiffRow,
  relativePath: string
) {
  return `@@ -${row.oldStartLine},${row.lineCount} +${row.newStartLine},${
    row.lineCount
  } @@ ${normalizeRepositoryRelativePath(relativePath)}:`
}

export function getCodeEditorSearchSelection(selection: string) {
  if (selection.length === 0 || selection.length > 100) {
    return null
  }

  return selection.replace(/\r\n?|\n/g, '\\n')
}

function createSideBySideRowsFromLineRows(
  rows: ReadonlyArray<ICodeEditorLineDiffRow>
): ReadonlyArray<ICodeEditorSideBySideDiffRow> {
  const sideBySideRows = new Array<ICodeEditorSideBySideDiffRow>()

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.kind === 'context') {
      sideBySideRows.push({
        kind: 'context',
        oldLineNumber: row.oldLineNumber,
        newLineNumber: row.newLineNumber,
        oldText: row.oldText,
        newText: row.newText,
      })
      continue
    }

    const removed = new Array<ICodeEditorLineDiffRow>()
    const added = new Array<ICodeEditorLineDiffRow>()
    while (index < rows.length && rows[index].kind !== 'context') {
      const changed = rows[index]
      if (changed.kind === 'removed') {
        removed.push(changed)
      } else {
        added.push(changed)
      }
      index++
    }
    index--

    const count = Math.max(removed.length, added.length)
    for (let pairIndex = 0; pairIndex < count; pairIndex++) {
      const oldRow = removed[pairIndex]
      const newRow = added[pairIndex]
      sideBySideRows.push({
        kind:
          oldRow !== undefined && newRow !== undefined
            ? 'modified'
            : oldRow !== undefined
            ? 'removed'
            : 'added',
        oldLineNumber: oldRow?.oldLineNumber ?? null,
        newLineNumber: newRow?.newLineNumber ?? null,
        oldText: oldRow?.oldText ?? '',
        newText: newRow?.newText ?? '',
      })
    }
  }

  return sideBySideRows
}

export function detectLanguageFromPathAndContent(
  relativePath: string | null,
  contents: string
): CodeEditorLanguage {
  const pathLanguage = detectLanguageFromPath(relativePath)
  if (pathLanguage !== 'unknown') {
    return pathLanguage
  }

  const sample = normalizeEditorText(contents).trimStart().slice(0, 4000)
  const firstLine = sample.split('\n')[0] ?? ''
  const codeSample = removeLikelyCommentOnlyLines(sample)

  if (/^#!.*\bpython(?:\d+(?:\.\d+)*)?\b/i.test(firstLine)) {
    return 'python'
  }
  if (/^#!.*\b(?:node|deno|bun)\b/i.test(firstLine)) {
    return 'javascript'
  }
  if (/^#!.*\b(?:sh|bash|zsh|fish)\b/i.test(firstLine)) {
    return 'unknown'
  }
  if (looksLikePatch(sample)) {
    return 'patch'
  }
  if (/^\s*<!doctype\s+html/i.test(sample) || /<html[\s>]/i.test(sample)) {
    return 'html'
  }
  if (/^\s*[{[]/.test(sample) && /"[^"]+"\s*:/.test(sample)) {
    return 'json'
  }
  if (
    /\b(import|export)\s.+from\s+['"]/.test(codeSample) ||
    /\bconst\s+\w+\s*=/.test(codeSample) ||
    /=>/.test(codeSample)
  ) {
    return 'javascript'
  }
  if (
    /^\s*(from\s+\S+\s+import\s+\S+|import\s+\S+|def\s+\w+\(|class\s+\w+[:(])/m.test(
      codeSample
    )
  ) {
    return 'python'
  }
  if (
    /^\s*package\s+\w+/m.test(codeSample) &&
    /\bfunc\s+\w+\(/.test(codeSample)
  ) {
    return 'go'
  }
  if (
    /\bfn\s+\w+\s*\(/.test(codeSample) &&
    /\b(let|use|pub|impl)\b/.test(codeSample)
  ) {
    return 'rust'
  }
  if (/^\s*#include\s+[<"]/.test(sample) || /\bstd::\w+/.test(codeSample)) {
    return 'cpp'
  }
  if (
    /\bpublic\s+(?:final\s+)?class\s+\w+/.test(codeSample) ||
    /^\s*package\s+[\w.]+;/m.test(codeSample)
  ) {
    return 'java'
  }
  if (
    /^\s*[-\w]+\s*:\s+.+$/m.test(codeSample) &&
    !/[{};]/.test(codeSample.slice(0, 500))
  ) {
    return 'yaml'
  }
  if (/^\s*#\s+\S+/m.test(sample) || /^\s*```/.test(sample)) {
    return 'markdown'
  }
  if (
    /(?:[.#][-_a-zA-Z][-_a-zA-Z0-9]*|[a-zA-Z][-_a-zA-Z0-9]*)\s*\{[^}]*:[^}]*\}/s.test(
      codeSample
    )
  ) {
    return 'css'
  }

  return 'unknown'
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

function detectLanguageFromPath(
  relativePath: string | null
): CodeEditorLanguage {
  if (relativePath === null) {
    return 'unknown'
  }

  const lower = relativePath.toLowerCase()
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) {
    return 'javascript'
  }
  if (lower.endsWith('.json')) {
    return 'json'
  }
  if (/\.(html|htm)$/.test(lower)) {
    return 'html'
  }
  if (/\.(css|scss|sass|less)$/.test(lower)) {
    return 'css'
  }
  if (/\.(md|markdown)$/.test(lower)) {
    return 'markdown'
  }
  if (/\.(diff|patch)$/.test(lower)) {
    return 'patch'
  }
  if (lower.endsWith('.py')) {
    return 'python'
  }
  if (/\.(c|cc|cpp|cxx|h|hpp)$/.test(lower)) {
    return 'cpp'
  }
  if (lower.endsWith('.java')) {
    return 'java'
  }
  if (lower.endsWith('.go')) {
    return 'go'
  }
  if (lower.endsWith('.rs')) {
    return 'rust'
  }
  if (/\.(yml|yaml)$/.test(lower)) {
    return 'yaml'
  }

  return 'unknown'
}

function looksLikePatch(sample: string) {
  return (
    /^(diff --git|Index: )/m.test(sample) ||
    /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(sample) ||
    (/^---\s+\S+/m.test(sample) && /^\+\+\+\s+\S+/m.test(sample))
  )
}

function removeLikelyCommentOnlyLines(sample: string) {
  return sample
    .split('\n')
    .filter(line => {
      const trimmed = line.trimStart()
      return !(
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        (trimmed.startsWith('#') && !trimmed.startsWith('#include'))
      )
    })
    .join('\n')
}

type LineDiffOperation =
  | { readonly kind: 'context'; readonly text: string }
  | { readonly kind: 'removed'; readonly text: string }
  | { readonly kind: 'added'; readonly text: string }

function createLineDiffOperations(
  oldLines: ReadonlyArray<string>,
  newLines: ReadonlyArray<string>
): ReadonlyArray<LineDiffOperation> {
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++
  }

  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (
    oldEnd > prefix &&
    newEnd > prefix &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--
    newEnd--
  }

  const operations = new Array<LineDiffOperation>()
  for (let index = 0; index < prefix; index++) {
    operations.push({ kind: 'context', text: oldLines[index] })
  }

  operations.push(
    ...createMiddleLineDiffOperations(
      oldLines.slice(prefix, oldEnd),
      newLines.slice(prefix, newEnd)
    )
  )

  for (let index = oldEnd; index < oldLines.length; index++) {
    operations.push({ kind: 'context', text: oldLines[index] })
  }

  return operations
}

function createMiddleLineDiffOperations(
  oldLines: ReadonlyArray<string>,
  newLines: ReadonlyArray<string>
): ReadonlyArray<LineDiffOperation> {
  if (oldLines.length === 0) {
    return newLines.map(text => ({ kind: 'added', text }))
  }
  if (newLines.length === 0) {
    return oldLines.map(text => ({ kind: 'removed', text }))
  }

  const cellCount = oldLines.length * newLines.length
  if (cellCount > 200000) {
    return [
      ...oldLines.map(text => ({ kind: 'removed' as const, text })),
      ...newLines.map(text => ({ kind: 'added' as const, text })),
    ]
  }

  const scores = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0)
  )

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      scores[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? scores[oldIndex + 1][newIndex + 1] + 1
          : Math.max(
              scores[oldIndex + 1][newIndex],
              scores[oldIndex][newIndex + 1]
            )
    }
  }

  const operations = new Array<LineDiffOperation>()
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      operations.push({ kind: 'context', text: oldLines[oldIndex] })
      oldIndex++
      newIndex++
    } else if (
      scores[oldIndex + 1][newIndex] >= scores[oldIndex][newIndex + 1]
    ) {
      operations.push({ kind: 'removed', text: oldLines[oldIndex] })
      oldIndex++
    } else {
      operations.push({ kind: 'added', text: newLines[newIndex] })
      newIndex++
    }
  }

  while (oldIndex < oldLines.length) {
    operations.push({ kind: 'removed', text: oldLines[oldIndex++] })
  }
  while (newIndex < newLines.length) {
    operations.push({ kind: 'added', text: newLines[newIndex++] })
  }

  return operations
}

function splitEditorLines(text: string) {
  return normalizeEditorText(text).split('\n')
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
