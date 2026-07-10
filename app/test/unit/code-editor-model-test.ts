import { strict as assert } from 'assert'
import { describe, it } from 'node:test'

import {
  applyCodeEditorTextEditAction,
  applyCodeEditorHistoryAction,
  buildFileTreeFromPaths,
  canApplyCodeEditorHistoryAction,
  createLineDiffRows,
  createFoldedLineDiffRows,
  createFoldedSideBySideDiffRows,
  createCodeEditorTextEditAction,
  createCodeEditorDiffExpansion,
  detectLineEnding,
  detectLanguageFromPathAndContent,
  filterRepositoryFilePaths,
  findSearchMatches,
  isCodeEditorDocumentDirty,
  normalizeRepositoryRelativePath,
  parseIgnoredPathList,
} from '../../src/ui/code-editor/code-editor-model'

describe('Code editor model helpers', () => {
  it('builds a sorted repository file tree from relative paths', () => {
    const tree = buildFileTreeFromPaths([
      'src/app.tsx',
      'README.md',
      'src/lib/state.ts',
      'src/components/button.tsx',
    ])

    assert.deepEqual(
      tree.map(node => `${node.kind}:${node.name}`),
      ['directory:src', 'file:README.md']
    )

    const src = tree[0]
    assert.equal(src.kind, 'directory')
    assert.deepEqual(
      src.children.map(node => `${node.kind}:${node.name}`),
      ['directory:components', 'directory:lib', 'file:app.tsx']
    )
  })

  it('normalizes repository paths for stable editor addressing', () => {
    assert.equal(
      normalizeRepositoryRelativePath('\\src\\components\\button.tsx'),
      'src/components/button.tsx'
    )
  })

  it('detects CRLF only when the document already uses it', () => {
    assert.equal(detectLineEnding('one\r\ntwo\r\n'), 'crlf')
    assert.equal(detectLineEnding('one\ntwo\n'), 'lf')
    assert.equal(detectLineEnding(''), 'lf')
    assert.equal(detectLineEnding('', 'crlf'), 'crlf')
  })

  it('finds search matches with case, whole-word, and regex options', () => {
    assert.equal(
      findSearchMatches('Foo foo food', 'foo', {
        caseSensitive: false,
        wholeWord: true,
        useRegex: false,
      }).length,
      2
    )

    assert.equal(
      findSearchMatches('alpha-1 alpha-20 beta', 'alpha-\\d+', {
        caseSensitive: true,
        wholeWord: false,
        useRegex: true,
      }).length,
      2
    )
  })

  it('creates stable line diffs when a line is deleted', () => {
    const diff = createLineDiffRows(
      ['alpha', 'beta', 'gamma', 'delta'].join('\n'),
      ['alpha', 'gamma', 'delta'].join('\n')
    )

    assert.deepEqual(
      diff.map(row => `${row.kind}:${row.oldText || row.newText}`),
      ['context:alpha', 'removed:beta', 'context:gamma', 'context:delta']
    )
  })

  it('folds unchanged lines outside change context without returning their text', () => {
    const original = Array.from(
      { length: 20 },
      (_, index) => `line-${index + 1}`
    )
    const current = [...original]
    current[9] = 'changed-10'

    const rows = createFoldedLineDiffRows(
      createLineDiffRows(original.join('\n'), current.join('\n')),
      [],
      2
    )
    const collapsed = rows.filter(row => row.kind === 'collapsed')

    assert.equal(collapsed.length, 2)
    assert.deepEqual(
      collapsed.map(row =>
        row.kind === 'collapsed'
          ? [row.oldStartLine, row.newStartLine, row.lineCount]
          : null
      ),
      [
        [1, 1, 7],
        [13, 13, 8],
      ]
    )
    assert.equal(
      rows.some(row => 'oldText' in row && row.oldText === 'line-1'),
      false
    )
  })

  it('expands a leading unchanged region upward in 20-line steps', () => {
    const original = Array.from(
      { length: 100 },
      (_, index) => `line-${index + 1}`
    )
    const current = [...original]
    current[50] = 'changed-51'
    const diffRows = createLineDiffRows(original.join('\n'), current.join('\n'))
    const folded = createFoldedLineDiffRows(diffRows, [], 2)
    const firstRegion = folded.find(row => row.kind === 'collapsed')
    assert.notEqual(firstRegion, undefined)
    if (firstRegion === undefined || firstRegion.kind !== 'collapsed') {
      return
    }

    assert.equal(firstRegion.canExpandUp, true)
    assert.equal(firstRegion.canExpandDown, false)
    assert.equal(firstRegion.expansionType, 'up')

    const expanded = createFoldedLineDiffRows(
      diffRows,
      [{ id: firstRegion.id, up: 20, down: 0 }],
      2
    )
    const remaining = expanded.find(
      row => row.kind === 'collapsed' && row.id === firstRegion.id
    )
    assert.notEqual(remaining, undefined)
    assert.equal(remaining?.kind === 'collapsed' ? remaining.lineCount : 0, 28)
    assert.equal(
      expanded.some(row => 'oldText' in row && row.oldText === 'line-29'),
      true
    )
    assert.equal(
      expanded.some(row => 'oldText' in row && row.oldText === 'line-28'),
      false
    )
  })

  it('expands a trailing unchanged region downward in 20-line steps', () => {
    const original = Array.from(
      { length: 100 },
      (_, index) => `line-${index + 1}`
    )
    const current = [...original]
    current[49] = 'changed-50'
    const diffRows = createLineDiffRows(original.join('\n'), current.join('\n'))
    const folded = createFoldedLineDiffRows(diffRows, [], 2)
    const region = folded.filter(row => row.kind === 'collapsed').at(-1)
    assert.notEqual(region, undefined)
    if (region === undefined || region.kind !== 'collapsed') {
      return
    }

    assert.equal(region.canExpandUp, false)
    assert.equal(region.canExpandDown, true)
    assert.equal(region.expansionType, 'down')
    const expanded = createFoldedLineDiffRows(
      diffRows,
      [{ id: region.id, up: 0, down: 20 }],
      2
    )
    assert.equal(
      expanded.some(row => 'oldText' in row && row.oldText === 'line-72'),
      true
    )
    assert.equal(
      expanded.some(row => 'oldText' in row && row.oldText === 'line-73'),
      false
    )
  })

  it('fully reveals a region when directional expansions meet', () => {
    const original = Array.from(
      { length: 70 },
      (_, index) => `line-${index + 1}`
    )
    const current = [...original]
    current[9] = 'changed-10'
    current[54] = 'changed-55'
    const diffRows = createLineDiffRows(original.join('\n'), current.join('\n'))
    const folded = createFoldedLineDiffRows(diffRows, [], 2)
    const middle = folded.find(
      row => row.kind === 'collapsed' && row.canExpandUp && row.canExpandDown
    )
    assert.notEqual(middle, undefined)
    if (middle === undefined || middle.kind !== 'collapsed') {
      return
    }
    assert.equal(middle.expansionType, 'both')

    const expanded = createFoldedLineDiffRows(
      diffRows,
      [{ id: middle.id, up: 20, down: 20 }],
      2
    )
    assert.equal(
      expanded.some(row => row.kind === 'collapsed' && row.id === middle.id),
      false
    )
  })

  it('uses Expand All for collapsed regions with at most 20 lines', () => {
    const original = Array.from(
      { length: 20 },
      (_, index) => `line-${index + 1}`
    )
    const current = [...original]
    current[9] = 'changed-10'
    const diffRows = createLineDiffRows(original.join('\n'), current.join('\n'))
    const folded = createFoldedLineDiffRows(diffRows, [], 2)
    const region = folded.find(row => row.kind === 'collapsed')
    assert.notEqual(region, undefined)
    if (region === undefined || region.kind !== 'collapsed') {
      return
    }

    assert.equal(region.expansionType, 'all')
    const expansion = createCodeEditorDiffExpansion(undefined, region, 'all')
    const expanded = createFoldedLineDiffRows(diffRows, [expansion], 2)
    assert.equal(
      expanded.some(row => row.kind === 'collapsed' && row.id === region.id),
      false
    )
  })

  it('uses the same collapsed regions in unified and split diff modes', () => {
    const original = Array.from(
      { length: 20 },
      (_, index) => `line-${index + 1}`
    )
    const current = [...original]
    current[9] = 'changed-10'
    const unified = createFoldedLineDiffRows(
      createLineDiffRows(original.join('\n'), current.join('\n')),
      [],
      2
    )
    const split = createFoldedSideBySideDiffRows(unified)

    assert.deepEqual(
      split.filter(row => row.kind === 'collapsed'),
      unified.filter(row => row.kind === 'collapsed')
    )
  })

  it('applies persisted editor actions for undo and redo', () => {
    const original = ['alpha', 'beta', 'gamma'].join('\n')
    const current = ['alpha', 'BETA', 'gamma', 'delta'].join('\n')
    const action = createCodeEditorTextEditAction(original, current)

    assert.equal(
      applyCodeEditorTextEditAction(original, action, 'redo'),
      current
    )
    assert.equal(
      applyCodeEditorTextEditAction(current, action, 'undo'),
      original
    )
  })

  it('records line-ending-only changes as undoable editor actions', () => {
    const action = createCodeEditorTextEditAction(
      'alpha\nbeta\n',
      'alpha\nbeta\n',
      'crlf',
      'lf'
    )

    assert.deepEqual(
      applyCodeEditorHistoryAction('alpha\nbeta\n', action, 'undo'),
      {
        contents: 'alpha\nbeta\n',
        lineEnding: 'crlf',
      }
    )
    assert.deepEqual(
      applyCodeEditorHistoryAction('alpha\nbeta\n', action, 'redo'),
      {
        contents: 'alpha\nbeta\n',
        lineEnding: 'lf',
      }
    )
  })

  it('restores text and line endings together across undo and redo', () => {
    const action = createCodeEditorTextEditAction(
      'alpha\nbeta',
      'alpha\nBETA',
      'crlf',
      'lf'
    )

    assert.deepEqual(
      applyCodeEditorHistoryAction('alpha\nBETA', action, 'undo'),
      {
        contents: 'alpha\nbeta',
        lineEnding: 'crlf',
      }
    )
    assert.deepEqual(
      applyCodeEditorHistoryAction('alpha\nbeta', action, 'redo'),
      {
        contents: 'alpha\nBETA',
        lineEnding: 'lf',
      }
    )
  })

  it('rejects undo and redo requests when their respective history stack is empty', () => {
    assert.equal(canApplyCodeEditorHistoryAction('undo', 0, 2), false)
    assert.equal(canApplyCodeEditorHistoryAction('redo', 2, 0), false)
    assert.equal(canApplyCodeEditorHistoryAction('undo', 1, 0), true)
    assert.equal(canApplyCodeEditorHistoryAction('redo', 0, 1), true)
  })

  it('treats a line-ending-only conversion as a dirty document', () => {
    assert.equal(
      isCodeEditorDocumentDirty('alpha\nbeta', 'alpha\nbeta', 'lf', 'crlf'),
      true
    )
    assert.equal(
      isCodeEditorDocumentDirty('alpha\nbeta', 'alpha\nbeta', 'crlf', 'crlf'),
      false
    )
  })

  it('rejects persisted editor actions when the cached contents diverged', () => {
    const action = createCodeEditorTextEditAction('alpha\nbeta', 'alpha\nBETA')

    assert.throws(
      () => applyCodeEditorTextEditAction('alpha\nchanged', action, 'undo'),
      /no longer matches/
    )
  })

  it('filters repository paths with editable ignore patterns', () => {
    const paths = [
      'src/app.ts',
      'node_modules/pkg/index.js',
      'dist/app.js',
      'docs/readme.md',
    ]

    assert.deepEqual(
      filterRepositoryFilePaths(paths, ['node_modules', 'dist'], false),
      ['docs/readme.md', 'src/app.ts']
    )

    assert.deepEqual(
      filterRepositoryFilePaths(paths, ['node_modules', 'dist'], true),
      [
        'dist/app.js',
        'docs/readme.md',
        'node_modules/pkg/index.js',
        'src/app.ts',
      ]
    )
  })

  it('parses ignored path lists from user editable text', () => {
    assert.deepEqual(parseIgnoredPathList('node_modules, dist\n.git\n'), [
      'node_modules',
      'dist',
      '.git',
    ])
  })

  it('detects likely languages from code content when extensions are unknown', () => {
    assert.equal(
      detectLanguageFromPathAndContent(
        'script.tool',
        '#!/usr/bin/env python\nprint("hi")'
      ),
      'python'
    )
    assert.equal(
      detectLanguageFromPathAndContent(
        'component.view',
        'import React from "react"\nexport const A = () => <div />'
      ),
      'javascript'
    )
    assert.equal(
      detectLanguageFromPathAndContent(
        'program.source',
        '#include <iostream>\nint main() { return 0; }'
      ),
      'cpp'
    )
  })

  it('detects patch files from path and content', () => {
    assert.equal(
      detectLanguageFromPathAndContent(
        'changes.patch',
        'diff --git a/a b/a\n+added'
      ),
      'patch'
    )
    assert.equal(
      detectLanguageFromPathAndContent(
        'unknown.file',
        '@@ -1,2 +1,2 @@\n-old\n+new'
      ),
      'patch'
    )
  })

  it('keeps ambiguous comment-heavy unknown files unhighlighted', () => {
    assert.equal(
      detectLanguageFromPathAndContent(
        'notes.unknown',
        '// import value from "somewhere"\n// const sample = () => {}'
      ),
      'unknown'
    )
  })
})
