import { strict as assert } from 'assert'
import { describe, it } from 'node:test'

import {
  buildFileTreeFromPaths,
  createCodeEditorDraftKey,
  detectLineEnding,
  findSearchMatches,
  normalizeRepositoryRelativePath,
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

  it('keys unsaved drafts by repository, branch, and file path', () => {
    const mainKey = createCodeEditorDraftKey('C:/repo', 'main', 'src/app.ts')
    const featureKey = createCodeEditorDraftKey(
      'C:/repo',
      'feature/a',
      'src/app.ts'
    )

    assert.notEqual(mainKey, featureKey)
    assert.ok(mainKey.includes('code-editor:draft:'))
  })

  it('detects CRLF only when the document already uses it', () => {
    assert.equal(detectLineEnding('one\r\ntwo\r\n'), 'crlf')
    assert.equal(detectLineEnding('one\ntwo\n'), 'lf')
    assert.equal(detectLineEnding(''), 'lf')
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
})
