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
    console.log(
      stats.toString({
        colors: true,
        chunks: false,
        modules: false,
        children: true,
      })
    )

    if (stats.hasErrors()) {
      process.exitCode = 1
    }
  }
})

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
