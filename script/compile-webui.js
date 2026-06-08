'use strict'

const fs = require('fs')
const path = require('path')

const mode = process.argv[2] === 'production' ? 'production' : 'development'
const projectRoot = path.resolve(__dirname, '..')
const outDir = path.join(projectRoot, 'out')
const buildLogPath = resolveOutputPath(
  process.env.WEBUI_BUILD_LOG || path.join('out', 'webui-build.log')
)
const diagnosticsLogPath = resolveOutputPath(
  process.env.WEBUI_DIAGNOSTICS_LOG || path.join('out', 'webui-diagnostics.log')
)
const diagnosticsJsonPath = resolveOutputPath(
  process.env.WEBUI_DIAGNOSTICS_JSON ||
    path.join('out', 'webui-diagnostics.json')
)
const shouldPrintDiagnosticsToConsole =
  process.env.WEBUI_CONSOLE_DIAGNOSTICS === '1' ||
  process.env.WEBUI_CONSOLE_DIAGNOSTICS === 'true'
const consoleChunkSize = 1800

process.env.NO_COLOR = process.env.NO_COLOR || '1'
process.env.FORCE_COLOR = process.env.FORCE_COLOR || '0'
process.env.NODE_ENV = mode
process.env.TS_NODE_PROJECT = path.join(projectRoot, 'script', 'tsconfig.json')

process.stdout.setDefaultEncoding('utf8')
process.stderr.setDefaultEncoding('utf8')

initializeLogs()

requireLocal('ts-node').register({
  project: process.env.TS_NODE_PROJECT,
})

const webpack = requireLocal('webpack')
const configModule = require(path.join(projectRoot, 'app', 'webpack.web.ts'))
const config = configModule.default || configModule

webpack(config, (error, stats) => {
  if (error) {
    const fatalErrorText = formatFatalError(error)
    emitDiagnosticText(fatalErrorText, 'error')
    writeFatalDiagnosticsJson(fatalErrorText)
    emitLogPaths()
    process.exitCode = 1
    return
  }

  if (stats === undefined) {
    const message = 'Webpack finished without returning build stats.'
    emitDiagnosticText(message, 'error')
    emitLogPaths()
    process.exitCode = 1
    return
  }

  const statsJson = stats.toJson(getJsonStatsOptions())
  const diagnostics = collectDiagnostics(statsJson)

  writeBuildSummary(stats, diagnostics)
  emitDiagnostics(diagnostics)
  writeDiagnosticsJson(statsJson, diagnostics)

  if (!stats.hasErrors()) {
    copyWebRuntimeAssets()
  }

  emitLogPaths()

  if (stats.hasErrors()) {
    process.exitCode = 1
  }
})

function getJsonStatsOptions() {
  return {
    all: false,
    assets: true,
    builtAt: true,
    cachedAssets: true,
    children: true,
    chunks: false,
    colors: false,
    entrypoints: true,
    errorDetails: true,
    errors: true,
    errorsSpace: Number.MAX_SAFE_INTEGER,
    logging: 'warn',
    loggingTrace: true,
    moduleAssets: true,
    moduleTrace: true,
    modules: true,
    nestedModules: true,
    performance: true,
    reasons: true,
    relatedAssets: true,
    source: true,
    timings: true,
    version: true,
    warnings: true,
    warningsSpace: Number.MAX_SAFE_INTEGER,
  }
}

function getSummaryStatsOptions() {
  return {
    assets: true,
    builtAt: true,
    cachedAssets: true,
    children: false,
    chunks: false,
    colors: false,
    entrypoints: false,
    errors: false,
    modules: false,
    performance: true,
    timings: true,
    version: true,
    warnings: false,
  }
}

function resolveOutputPath(value) {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value)
}

function initializeLogs() {
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(path.dirname(buildLogPath), { recursive: true })
  fs.mkdirSync(path.dirname(diagnosticsLogPath), { recursive: true })
  fs.mkdirSync(path.dirname(diagnosticsJsonPath), { recursive: true })

  const header = [
    '================ WEBUI BUILD LOG ================',
    `Started at: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    `Project root: ${projectRoot}`,
    `Working directory: ${process.cwd()}`,
    `Node.js: ${process.version}`,
    `Command: node ${process.argv.slice(1).join(' ')}`,
    '',
  ].join('\n')

  writeUtf8BomFile(buildLogPath, `${header}\n`)
  writeUtf8BomFile(diagnosticsLogPath, `${header}\n`)
}

function copyWebRuntimeAssets() {
  const webOutDir = path.join(outDir, 'web')
  const staticDestination = path.join(webOutDir, 'static')
  const commonStaticSource = path.join(projectRoot, 'app', 'static', 'common')
  const platformStaticSource = path.join(
    projectRoot,
    'app',
    'static',
    process.platform
  )
  const emojiImagesSource = path.join(projectRoot, 'gemoji', 'images', 'emoji')
  const emojiImagesDestination = path.join(webOutDir, 'emoji')
  const emojiJsonSource = path.join(projectRoot, 'gemoji', 'db', 'emoji.json')
  const emojiJsonDestination = path.join(webOutDir, 'emoji.json')

  fs.mkdirSync(webOutDir, { recursive: true })

  fs.rmSync(staticDestination, { recursive: true, force: true })
  if (fs.existsSync(platformStaticSource)) {
    fs.cpSync(platformStaticSource, staticDestination, {
      recursive: true,
      verbatimSymlinks: true,
    })
  }
  fs.cpSync(commonStaticSource, staticDestination, {
    recursive: true,
    force: false,
    verbatimSymlinks: true,
  })

  fs.rmSync(emojiImagesDestination, { recursive: true, force: true })
  fs.cpSync(emojiImagesSource, emojiImagesDestination, {
    recursive: true,
    verbatimSymlinks: true,
  })
  fs.copyFileSync(emojiJsonSource, emojiJsonDestination)

  const text = [
    '================ WEBUI RUNTIME ASSETS ================',
    `Copied static assets to: ${staticDestination}`,
    `Copied emoji images to: ${emojiImagesDestination}`,
    `Copied emoji metadata to: ${emojiJsonDestination}`,
    '============== END WEBUI RUNTIME ASSETS ==============',
    '',
  ].join('\n')

  appendBuildLog(text)
}

function writeBuildSummary(stats, diagnostics) {
  const errors = diagnostics.filter(x => x.type === 'error').length
  const warnings = diagnostics.filter(x => x.type === 'warning').length
  const summary = stripAnsi(stats.toString(getSummaryStatsOptions()))
  const text = [
    '================ WEBPACK SUMMARY ================',
    summary,
    '',
    '================ WEBUI DIAGNOSTIC COUNTS ================',
    `Total errors: ${errors}`,
    `Total warnings: ${warnings}`,
    '============== END WEBUI DIAGNOSTIC COUNTS ==============',
    '',
  ].join('\n')

  appendBuildLog(text)
  emitConsole(
    [
      '================ WEBUI BUILD DIAGNOSTICS ================',
      `Total errors: ${errors}`,
      `Total warnings: ${warnings}`,
      '',
      'Every diagnostic with details is written to the log files below.',
      'Console diagnostics are disabled by default to avoid PowerShell transcript truncation.',
      '============== END WEBUI BUILD DIAGNOSTICS ==============',
      '',
    ].join('\n'),
    'log'
  )
}

function collectDiagnostics(statsJson) {
  const diagnostics = []

  collectDiagnosticsFromNode(statsJson, [], diagnostics)

  return diagnostics
}

function collectDiagnosticsFromNode(node, compilerPath, diagnostics) {
  if (node === null || typeof node !== 'object') {
    return
  }

  const currentPath =
    typeof node.name === 'string' && node.name.length > 0
      ? [...compilerPath, node.name]
      : compilerPath

  appendDiagnostics(diagnostics, 'error', currentPath, node.errors)
  appendDiagnostics(diagnostics, 'warning', currentPath, node.warnings)

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectDiagnosticsFromNode(child, currentPath, diagnostics)
    }
  }
}

function appendDiagnostics(diagnostics, type, compilerPath, items) {
  if (!Array.isArray(items)) {
    return
  }

  for (const item of items) {
    diagnostics.push({
      type,
      compiler: compilerPath.length > 0 ? compilerPath.join(' > ') : 'root',
      diagnostic: item,
    })
  }
}

function emitDiagnostics(diagnostics) {
  if (diagnostics.length === 0) {
    emitDiagnosticText('No WebUI diagnostics were reported.', 'log')
    return
  }

  const errors = diagnostics.filter(x => x.type === 'error').length
  const warnings = diagnostics.filter(x => x.type === 'warning').length
  const header = [
    '================ WEBUI FULL DIAGNOSTICS ================',
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    `Total errors: ${errors}`,
    `Total warnings: ${warnings}`,
    '',
  ].join('\n')

  emitDiagnosticText(header, 'log')

  diagnostics.forEach((entry, index) => {
    emitDiagnosticText(formatDiagnostic(entry, index, diagnostics.length), 'log')
  })

  emitDiagnosticText(
    '============== END WEBUI FULL DIAGNOSTICS ==============',
    'log'
  )
}

function formatDiagnostic(entry, index, total) {
  const diagnostic = entry.diagnostic
  const title = `${entry.type.toUpperCase()} ${index + 1}/${total}`
  const lines = [
    `---------------- ${title} ----------------`,
    `Compiler: ${entry.compiler}`,
  ]

  appendField(lines, 'File', diagnostic.file)
  appendField(lines, 'Module', diagnostic.moduleName)
  appendField(lines, 'Module identifier', diagnostic.moduleIdentifier)
  appendField(lines, 'Location', diagnostic.loc)
  appendField(lines, 'Chunk', diagnostic.chunkName)
  appendBlock(lines, 'Message', diagnostic.message)
  appendBlock(lines, 'Details', diagnostic.details)
  appendBlock(lines, 'Stack', diagnostic.stack)
  appendModuleTrace(lines, diagnostic.moduleTrace)
  appendBlock(lines, 'Raw diagnostic object', stringify(diagnostic))
  lines.push('')

  return lines.join('\n')
}

function appendField(lines, label, value) {
  if (value !== undefined && value !== null && String(value).length > 0) {
    lines.push(`${label}: ${value}`)
  }
}

function appendBlock(lines, label, value) {
  if (value === undefined || value === null || String(value).length === 0) {
    return
  }

  lines.push(`${label}:`)
  lines.push(String(value))
}

function appendModuleTrace(lines, moduleTrace) {
  if (!Array.isArray(moduleTrace) || moduleTrace.length === 0) {
    return
  }

  lines.push('Module trace:')
  moduleTrace.forEach((trace, index) => {
    lines.push(`  ${index + 1}. ${trace.moduleName ?? '<unknown module>'}`)
    appendIndentedField(lines, 'Module identifier', trace.moduleIdentifier)
    appendIndentedField(lines, 'Origin', trace.originName)
    appendIndentedField(lines, 'Origin identifier', trace.originIdentifier)
    appendIndentedField(lines, 'Dependency', trace.dependency)
    appendIndentedField(lines, 'Location', trace.loc)
  })
}

function appendIndentedField(lines, label, value) {
  if (value !== undefined && value !== null && String(value).length > 0) {
    lines.push(`     ${label}: ${value}`)
  }
}

function emitDiagnosticText(text, stream) {
  const cleanText = stripAnsi(text)

  appendBuildLog(`${cleanText}\n`)
  appendUtf8File(diagnosticsLogPath, `${cleanText}\n`)

  if (shouldPrintDiagnosticsToConsole) {
    emitConsole(cleanText, stream)
  }
}

function appendBuildLog(text) {
  appendUtf8File(buildLogPath, text)
}

function emitConsole(text, stream) {
  const write = stream === 'error' ? process.stderr.write : process.stdout.write
  const lines = String(text).split(/\r?\n/)

  for (const line of lines) {
    if (line.length === 0) {
      write.call(stream === 'error' ? process.stderr : process.stdout, '\n')
      continue
    }

    for (let index = 0; index < line.length; index += consoleChunkSize) {
      write.call(
        stream === 'error' ? process.stderr : process.stdout,
        `${line.slice(index, index + consoleChunkSize)}\n`
      )
    }
  }
}

function emitLogPaths() {
  const text = [
    '',
    '================ WEBUI DIAGNOSTIC FILES ================',
    'Complete build diagnostics were written to:',
    `  ${buildLogPath}`,
    `  ${diagnosticsLogPath}`,
    `  ${diagnosticsJsonPath}`,
    '',
    'Set WEBUI_CONSOLE_DIAGNOSTICS=1 to also print every diagnostic to the console.',
    '============== END WEBUI DIAGNOSTIC FILES ==============',
    '',
  ].join('\n')

  appendBuildLog(text)
  appendUtf8File(diagnosticsLogPath, text)
  emitConsole(text, 'log')
}

function writeDiagnosticsJson(statsJson, diagnostics) {
  fs.writeFileSync(
    diagnosticsJsonPath,
    stringify({
      generatedAt: new Date().toISOString(),
      mode,
      diagnostics,
      stats: statsJson,
    }),
    'utf8'
  )
}

function formatFatalError(error) {
  return [
    '================ WEBUI FATAL BUILD ERROR ================',
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    '',
    error && error.stack ? error.stack : String(error),
    '============== END WEBUI FATAL BUILD ERROR ==============',
  ].join('\n')
}

function writeFatalDiagnosticsJson(fatalErrorText) {
  fs.writeFileSync(
    diagnosticsJsonPath,
    stringify({
      generatedAt: new Date().toISOString(),
      mode,
      fatalError: fatalErrorText,
    }),
    'utf8'
  )
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function stringify(value) {
  return JSON.stringify(sanitizeForLog(value), null, 2)
}

function writeUtf8BomFile(filePath, text) {
  fs.writeFileSync(filePath, `\uFEFF${stripAnsi(text)}`, 'utf8')
}

function appendUtf8File(filePath, text) {
  fs.appendFileSync(filePath, stripAnsi(text), 'utf8')
}

function sanitizeForLog(value) {
  if (typeof value === 'string') {
    return stripAnsi(value)
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeForLog)
  }

  if (value !== null && typeof value === 'object') {
    const sanitized = {}

    for (const key of Object.keys(value)) {
      sanitized[key] = sanitizeForLog(value[key])
    }

    return sanitized
  }

  return value
}

function requireLocal(moduleName) {
  try {
    return require(require.resolve(moduleName, { paths: [projectRoot] }))
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      const message = [
        `Missing local dependency '${moduleName}'.`,
        '',
        'Install project dependencies from the desktop-webui root first:',
        '  yarn install --network-timeout 600000',
        '',
        'Or run one of the WebUI deployment helpers:',
        '  powershell -ExecutionPolicy Bypass -File script/deploy-webui.ps1 -NoStart',
        '  bash script/deploy-webui.sh --no-start',
        '',
        `Build log: ${buildLogPath}`,
      ].join('\n')

      emitDiagnosticText(message, 'error')
      emitLogPaths()
      process.exit(1)
    }

    throw error
  }
}
