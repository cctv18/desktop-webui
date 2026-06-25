'use strict'

const fs = require('fs')
const path = require('path')

const removedStaticAssets = new Set([
  'github.bat',
  'github.sh',
  'cherry-pick-intro.png',
  'explore.svg',
  'organized-by-project-status.svg',
])

const runtimeOptionsWithValues = new Set([
  '--allowed-root',
  '--allowedRoot',
  '--config',
  '--copilot-cli-path',
  '--data-dir',
  '--git-config-global',
  '--git-directory',
  '--git-exec-path',
  '--git-path',
  '--host',
  '--log-file',
  '--oauth-callback-url',
  '--port',
  '--public-url',
  '--static-root',
])

const runtimeFlags = new Set([
  '--no-log-file',
  '--no-start',
  '--skip-system-proxy',
])

function parseCompileOptions(values) {
  const result = {
    mode: 'development',
    deleteSourceMaps: false,
  }

  for (let index = 0; index < values.length; index++) {
    const value = values[index]

    if (value === 'production' || value === 'development') {
      result.mode = value
      continue
    }

    if (value === '--debug-build' || value === '--debugBuild') {
      throw new Error(
        '--debug-build is no longer supported by the WebUI build.'
      )
    }

    if (
      value === '--delete-source-maps' ||
      value === '--deleteSourceMaps' ||
      value === '--delete-sourcemaps'
    ) {
      result.deleteSourceMaps = true
      continue
    }

    if (value === '--platform' || value === '--Platform') {
      throw new Error(
        '--platform is no longer supported by the WebUI build. Build once and configure deployment through server.conf or the run-webui launcher.'
      )
    }

    if (value.startsWith('--platform=') || value.startsWith('--Platform=')) {
      throw new Error(
        '--platform is no longer supported by the WebUI build. Build once and configure deployment through server.conf or the run-webui launcher.'
      )
    }

    const optionName = value.includes('=')
      ? value.slice(0, value.indexOf('='))
      : value

    if (runtimeFlags.has(optionName)) {
      throw new Error(
        `${optionName} is no longer supported by the WebUI build. Start or configure the server with out/run-webui.sh, out/run-webui.ps1, and server.conf.`
      )
    }

    if (runtimeOptionsWithValues.has(optionName)) {
      throw new Error(
        `${optionName} is a runtime option. Put it in server.conf or pass it to out/run-webui.sh / out/run-webui.ps1.`
      )
    }

    if (value.startsWith('-')) {
      throw new Error(`Unsupported WebUI build option: ${value}`)
    }
  }

  return result
}

function shouldCopyWebStaticAsset(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  return !removedStaticAssets.has(path.posix.basename(normalized))
}

function copyFilteredDirectory(
  source,
  destination,
  shouldCopyFile,
  options = {}
) {
  if (!fs.existsSync(source)) {
    return
  }

  copyFilteredEntry(source, destination, '', shouldCopyFile, options)
}

function copyFilteredEntry(
  source,
  destination,
  relativePath,
  shouldCopyFile,
  options
) {
  const stats = fs.lstatSync(source)

  if (stats.isDirectory()) {
    let copiedChild = false

    for (const entry of fs.readdirSync(source)) {
      copiedChild =
        copyFilteredEntry(
          path.join(source, entry),
          path.join(destination, entry),
          path.join(relativePath, entry),
          shouldCopyFile,
          options
        ) || copiedChild
    }

    return copiedChild
  }

  if (!shouldCopyFile(relativePath)) {
    return false
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })

  if (fs.existsSync(destination)) {
    if (options.force === true) {
      fs.rmSync(destination, { recursive: true, force: true })
    } else {
      throw new Error(`Refusing to overwrite existing asset: ${destination}`)
    }
  }

  if (stats.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination)
  } else {
    fs.copyFileSync(source, destination)
  }

  return true
}

function writeEmptyWebEmojiMetadata(destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.writeFileSync(destinationPath, '[]\n', 'utf8')
}

function removeDeployDiagnosticsOnSuccess(outDir, succeeded) {
  if (!succeeded) {
    return false
  }

  const diagnosticsPath = path.join(outDir, 'webui-deploy.diagnostics.json')
  if (!fs.existsSync(diagnosticsPath)) {
    return false
  }

  fs.rmSync(diagnosticsPath, { force: true })
  return true
}

function normalizeRelativePath(relativePath) {
  return `${relativePath}`.replace(/\\/g, '/').replace(/^\/+/, '')
}

module.exports = {
  copyFilteredDirectory,
  parseCompileOptions,
  removeDeployDiagnosticsOnSuccess,
  shouldCopyWebStaticAsset,
  writeEmptyWebEmojiMetadata,
}
