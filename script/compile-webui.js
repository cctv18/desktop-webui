'use strict'

const path = require('path')

const mode = process.argv[2] === 'production' ? 'production' : 'development'
const projectRoot = path.resolve(__dirname, '..')

process.env.NODE_ENV = mode
process.env.TS_NODE_PROJECT = path.join(projectRoot, 'script', 'tsconfig.json')

require('ts-node').register({
  project: process.env.TS_NODE_PROJECT,
})

const webpack = require('webpack')
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
