import { strict as assert } from 'assert'
import { describe, it } from 'node:test'

import {
  buildFileTreeFromPaths,
  createCodeEditorDraftKey,
  createUnifiedDiff,
  detectLineEnding,
  detectLanguageFromPathAndContent,
  filterRepositoryFilePaths,
  findSearchMatches,
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

  it('creates stable line diffs when a line is deleted', () => {
    const diff = createUnifiedDiff(
      ['alpha', 'beta', 'gamma', 'delta'].join('\n'),
      ['alpha', 'gamma', 'delta'].join('\n'),
      'src/example.ts'
    )

    assert.ok(diff.includes('-beta'))
    assert.ok(diff.includes(' gamma'))
    assert.ok(diff.includes(' delta'))
    assert.ok(!diff.includes('-gamma'))
    assert.ok(!diff.includes('+gamma'))
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
})
