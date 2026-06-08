'use strict'

const fs = require('fs')
const path = require('path')

const mode = process.argv[2] === 'production' ? 'production' : 'development'
const projectRoot = path.resolve(__dirname, '..')
const outDir = path.join(projectRoot, 'out')
const buildLogPath = resolveOutputPath(
  process.env.WEBUI_BUILD_LOG || path.join('out', 'webui-build.log')
)
const diagnosticsLogPath = path.join(outDir, 'webui-diagnostics.log')
const diagnosticsJsonPath = path.join(outDir, 'webui-diagnostics.json')

process.env.NODE_ENV = mode
process.env.TS_NODE_PROJECT = path.join(projectRoot, 'script', 'tsconfig.json')

initializeBuildLog()

requireLocal('ts-node').register({
  project: process.env.TS_NODE_PROJECT,
})

const webpack = requireLocal('webpack')
const configModule = require(path.join(projectRoot, 'app', 'webpack.web.ts'))
const config = configModule.default || configModule

webpack(config, (error, stats) => {
  if (error) {
    const fatalErrorText = formatFatalError(error)
    writeBuildLog(fatalErrorText)
    writeFatalDiagnosticsFile(fatalErrorText)
    emitConsole(
      [fatalErrorText, '', formatDiagnosticsPaths([])].join('\n'),
      'error'
    )
    process.exitCode = 1
    return
  }

  if (stats !== undefined) {
    const summary = stats.toString(getSummaryStatsOptions())
    const statsJson = stats.toJson(getJsonStatsOptions())
    const diagnostics = collectDiagnostics(statsJson)
    const diagnosticsText = formatDiagnostics(diagnostics)
    const fullBuildLog = formatBuildLog(summary, diagnosticsText, diagnostics)

    writeBuildLog(fullBuildLog)
    writeDiagnosticsFiles(diagnosticsText, statsJson, diagnostics)

    emitConsole(formatConsoleSummary(summary, diagnostics), 'log')

    if (stats.hasErrors()) {
      process.exitCode = 1
    }
  }
})

function getSummaryStatsOptions() {
  return {
    assets: true,
    builtAt: true,
    cachedAssets: true,
    children: true,
    chunks: false,
    colors: shouldUseColors(),
    entrypoints: false,
    errors: false,
    logging: 'warn',
    modules: false,
    performance: true,
    timings: true,
    version: true,
    warnings: false,
  }
}

function getJsonStatsOptions() {
  return {
    all: false,
    assets: true,
    builtAt: true,
    cachedAssets: true,
    children: true,
    chunks: false,
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

function shouldUseColors() {
  const noColor = process.env.NO_COLOR

  if (
    noColor !== undefined &&
    noColor !== '' &&
    noColor !== '0' &&
    noColor.toLowerCase() !== 'false'
  ) {
    return false
  }

  return Boolean(process.stdout.isTTY)
}

function resolveOutputPath(value) {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value)
}

function initializeBuildLog() {
  fs.mkdirSync(path.dirname(buildLogPath), { recursive: true })
  fs.writeFileSync(
    buildLogPath,
    [
      '================ WEBUI BUILD LOG ================',
      `Started at: ${new Date().toISOString()}`,
      `Mode: ${mode}`,
      `Project root: ${projectRoot}`,
      `Working directory: ${process.cwd()}`,
      `Node.js: ${process.version}`,
      `Command: node ${process.argv.slice(1).join(' ')}`,
      '',
    ].join('\n'),
    'utf8'
  )
}

function writeBuildLog(text) {
  if (text.trim().length === 0) {
    return
  }

  fs.appendFileSync(buildLogPath, `${stripAnsi(text)}\n`, 'utf8')
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

function emitConsole(text, stream) {
  if (stream === 'error') {
    console.error(text)
  } else {
    console.log(text)
  }
}

function formatBuildLog(summary, diagnosticsText, diagnostics) {
  const lines = []

  if (summary.trim().length > 0) {
    lines.push('================ WEBPACK SUMMARY ================')
    lines.push(summary)
    lines.push('')
  }

  if (diagnosticsText.trim().length > 0) {
    lines.push(diagnosticsText)
    lines.push('')
  }

  lines.push(formatDiagnosticsPaths(diagnostics))
  lines.push('')
  lines.push(`Finished at: ${new Date().toISOString()}`)
  lines.push('============== END WEBUI BUILD LOG ==============')

  return lines.join('\n')
}

function formatConsoleSummary(summary, diagnostics) {
  const errors = diagnostics.filter(x => x.type === 'error').length
  const warnings = diagnostics.filter(x => x.type === 'warning').length
  const lines = []

  if (summary.trim().length > 0) {
    lines.push(summary)
    lines.push('')
  }

  lines.push('================ WEBUI BUILD DIAGNOSTICS ================')
  lines.push(`Total errors: ${errors}`)
  lines.push(`Total warnings: ${warnings}`)
  lines.push('')
  lines.push('Complete build logs were written to:')
  lines.push(`  ${buildLogPath}`)
  lines.push(`  ${diagnosticsLogPath}`)
  lines.push(`  ${diagnosticsJsonPath}`)
  lines.push('')
  lines.push(
    'The console intentionally prints only this summary to avoid PowerShell truncation.'
  )
  lines.push('============== END WEBUI BUILD DIAGNOSTICS ==============')

  return lines.join('\n')
}

function formatDiagnosticsPaths(diagnostics) {
  const errors = diagnostics.filter(x => x.type === 'error').length
  const warnings = diagnostics.filter(x => x.type === 'warning').length

  return [
    '================ WEBUI DIAGNOSTIC FILES ================',
    `Total errors: ${errors}`,
    `Total warnings: ${warnings}`,
    '',
    'Complete build logs were written to:',
    `  ${buildLogPath}`,
    `  ${diagnosticsLogPath}`,
    `  ${diagnosticsJsonPath}`,
    '============== END WEBUI DIAGNOSTIC FILES ==============',
  ].join('\n')
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

function formatDiagnostics(diagnostics) {
  if (diagnostics.length === 0) {
    return ''
  }

  const errors = diagnostics.filter(x => x.type === 'error').length
  const warnings = diagnostics.filter(x => x.type === 'warning').length
  const lines = [
    '',
    '================ WEBUI FULL DIAGNOSTICS ================',
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    `Total errors: ${errors}`,
    `Total warnings: ${warnings}`,
    '',
  ]

  diagnostics.forEach((entry, index) => {
    const diagnostic = entry.diagnostic
    const title = `${entry.type.toUpperCase()} ${index + 1}/${
      diagnostics.length
    }`

    lines.push(`---------------- ${title} ----------------`)
    lines.push(`Compiler: ${entry.compiler}`)
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
  })

  lines.push('============== END WEBUI FULL DIAGNOSTICS ==============')

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

function writeDiagnosticsFiles(diagnosticsText, statsJson, diagnostics) {
  fs.mkdirSync(outDir, { recursive: true })

  fs.writeFileSync(
    diagnosticsLogPath,
    stripAnsi(
      diagnosticsText.trim().length > 0
        ? diagnosticsText
        : 'No WebUI diagnostics were reported.'
    ),
    'utf8'
  )
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

function writeFatalDiagnosticsFile(fatalErrorText) {
  fs.mkdirSync(outDir, { recursive: true })

  fs.writeFileSync(diagnosticsLogPath, stripAnsi(fatalErrorText), 'utf8')
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

function stringify(value) {
  return JSON.stringify(value, null, 2)
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

      writeBuildLog(message)
      emitConsole(message, 'error')
      process.exit(1)
    }

    throw error
  }
}
