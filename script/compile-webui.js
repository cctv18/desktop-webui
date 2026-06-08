'use strict'

const fs = require('fs')
const path = require('path')

const mode = process.argv[2] === 'production' ? 'production' : 'development'
const projectRoot = path.resolve(__dirname, '..')

process.env.NODE_ENV = mode
process.env.TS_NODE_PROJECT = path.join(projectRoot, 'script', 'tsconfig.json')

requireLocal('ts-node').register({
  project: process.env.TS_NODE_PROJECT,
})

const webpack = requireLocal('webpack')
const configModule = require(path.join(projectRoot, 'app', 'webpack.web.ts'))
const config = configModule.default || configModule

webpack(config, (error, stats) => {
  if (error) {
    const fatalErrorText = formatFatalError(error)
    console.error(fatalErrorText)
    writeFatalDiagnosticsFile(fatalErrorText)
    process.exitCode = 1
    return
  }

  if (stats !== undefined) {
    const summary = stats.toString(getSummaryStatsOptions())
    const statsJson = stats.toJson(getJsonStatsOptions())
    const diagnostics = collectDiagnostics(statsJson)
    const diagnosticsText = formatDiagnostics(diagnostics)

    if (summary.trim().length > 0) {
      console.log(summary)
    }

    if (diagnosticsText.length > 0) {
      console.log(diagnosticsText)
    }

    writeDiagnosticsFiles(summary, diagnosticsText, statsJson, diagnostics)

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

function writeDiagnosticsFiles(summary, diagnosticsText, statsJson, diagnostics) {
  const outDir = path.join(projectRoot, 'out')
  fs.mkdirSync(outDir, { recursive: true })

  const textPath = path.join(outDir, 'webui-diagnostics.log')
  const jsonPath = path.join(outDir, 'webui-diagnostics.json')
  const text = [summary, diagnosticsText].filter(x => x.trim().length > 0)

  fs.writeFileSync(textPath, text.join('\n\n'), 'utf8')
  fs.writeFileSync(
    jsonPath,
    stringify({
      generatedAt: new Date().toISOString(),
      mode,
      diagnostics,
      stats: statsJson,
    }),
    'utf8'
  )

  console.log(
    [
      '',
      'Detailed WebUI diagnostics were written to:',
      `  ${textPath}`,
      `  ${jsonPath}`,
    ].join('\n')
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
  const outDir = path.join(projectRoot, 'out')
  fs.mkdirSync(outDir, { recursive: true })

  const textPath = path.join(outDir, 'webui-diagnostics.log')
  const jsonPath = path.join(outDir, 'webui-diagnostics.json')

  fs.writeFileSync(textPath, fatalErrorText, 'utf8')
  fs.writeFileSync(
    jsonPath,
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
      console.error(
        [
          `Missing local dependency '${moduleName}'.`,
          '',
          'Install project dependencies from the desktop-webui root first:',
          '  yarn install --network-timeout 600000',
          '',
          'Or run one of the WebUI deployment helpers:',
          '  powershell -ExecutionPolicy Bypass -File script/deploy-webui.ps1 -NoStart',
          '  bash script/deploy-webui.sh --no-start',
        ].join('\n')
      )
      process.exit(1)
    }

    throw error
  }
}
