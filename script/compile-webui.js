'use strict'

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
    console.error(error)
    process.exitCode = 1
    return
  }

  if (stats !== undefined) {
    console.log(stats.toString(getStatsOptions()))

    if (stats.hasErrors()) {
      process.exitCode = 1
    }
  }
})

function getStatsOptions() {
  return {
    assets: true,
    builtAt: true,
    cachedAssets: true,
    children: true,
    chunks: false,
    colors: shouldUseColors(),
    entrypoints: false,
    errorDetails: true,
    errors: true,
    errorsSpace: Number.MAX_SAFE_INTEGER,
    logging: 'warn',
    moduleTrace: true,
    modules: false,
    performance: true,
    reasons: true,
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
