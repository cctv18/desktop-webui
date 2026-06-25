import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const {
  copyFilteredDirectory,
  parseCompileOptions,
  removeDeployDiagnosticsOnSuccess,
  shouldCopyWebStaticAsset,
  writeEmptyWebEmojiMetadata,
} = require('../../../../script/webui-build-utils')

const testRoot = join(process.cwd(), 'out', 'test-webui-build-utils')

describe('webui-build-utils', () => {
  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  describe('parseCompileOptions', () => {
    it('keeps build-only options that still change the output', () => {
      assert.deepStrictEqual(
        parseCompileOptions(['production', '--delete-source-maps']),
        {
          mode: 'production',
          deleteSourceMaps: true,
        }
      )
    })

    it('rejects the removed platform option', () => {
      assert.throws(
        () => parseCompileOptions(['--platform', 'linux']),
        /--platform is no longer supported/
      )
      assert.throws(
        () => parseCompileOptions(['--platform=win32']),
        /--platform is no longer supported/
      )
    })

    it('rejects runtime options that belong to run-webui launchers', () => {
      assert.throws(
        () => parseCompileOptions(['--no-start']),
        /--no-start is no longer supported/
      )
      assert.throws(
        () => parseCompileOptions(['--static-root', 'web']),
        /--static-root is a runtime option/
      )
    })

    it('rejects the removed debug build option', () => {
      assert.throws(
        () => parseCompileOptions(['--debug-build']),
        /--debug-build is no longer supported/
      )
    })
  })

  describe('shouldCopyWebStaticAsset', () => {
    it('omits Desktop CLI launchers and unused WebUI static assets', () => {
      const omitted = [
        'github.bat',
        'github.sh',
        'cherry-pick-intro.png',
        'explore.svg',
        'organized-by-project-status.svg',
      ]

      for (const asset of omitted) {
        assert.equal(shouldCopyWebStaticAsset(asset), false)
      }
    })

    it('keeps static assets that are still referenced at runtime', () => {
      const kept = [
        'release-note-header-left.svg',
        'release-note-header-right.svg',
        'welcome-illustration-right.svg',
        'gitignore/Node.gitignore',
      ]

      for (const asset of kept) {
        assert.equal(shouldCopyWebStaticAsset(asset), true)
      }
    })
  })

  describe('writeEmptyWebEmojiMetadata', () => {
    it('writes an empty placeholder without reading gemoji data', async () => {
      const destination = join(testRoot, 'emoji.json')

      writeEmptyWebEmojiMetadata(destination)

      assert.equal(await readFile(destination, 'utf8'), '[]\n')
    })
  })

  describe('copyFilteredDirectory', () => {
    it('does not create filtered static directories', async () => {
      const source = join(testRoot, 'source')
      const destination = join(testRoot, 'destination')

      await mkdir(join(source, 'unused'), { recursive: true })
      await writeFile(join(source, 'unused', 'github.sh'), 'script', 'utf8')
      await writeFile(join(source, 'paper-stack.svg'), 'svg', 'utf8')

      copyFilteredDirectory(source, destination, shouldCopyWebStaticAsset)

      assert.equal(existsSync(join(destination, 'unused')), false)
      assert.equal(existsSync(join(destination, 'paper-stack.svg')), true)
    })
  })

  describe('removeDeployDiagnosticsOnSuccess', () => {
    it('removes deploy diagnostics only after a successful build', async () => {
      const diagnosticsPath = join(testRoot, 'webui-deploy.diagnostics.json')
      await mkdir(testRoot, { recursive: true })
      await writeFile(diagnosticsPath, '{"large":true}', 'utf8')

      removeDeployDiagnosticsOnSuccess(testRoot, false)
      assert.equal(existsSync(diagnosticsPath), true)

      removeDeployDiagnosticsOnSuccess(testRoot, true)
      assert.equal(existsSync(diagnosticsPath), false)
    })

    it('ignores missing deploy diagnostics files', async () => {
      await mkdir(testRoot, { recursive: true })

      removeDeployDiagnosticsOnSuccess(testRoot, true)

      assert.equal(
        await readFile(join(testRoot, 'webui-deploy.diagnostics.json'), 'utf8')
          .then(() => 'exists')
          .catch(() => 'missing'),
        'missing'
      )
    })
  })
})
