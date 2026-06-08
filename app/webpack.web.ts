import * as path from 'path'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import webpack from 'webpack'
import merge from 'webpack-merge'
import * as common from './webpack.common'

const outputDir = path.resolve(__dirname, '..', 'out')
const replacements = common.replacements

const tsRule = {
  test: /\.tsx?$/,
  include: path.resolve(__dirname, 'src'),
  use: [{ loader: 'ts-loader' }],
  exclude: /node_modules/,
}

const webAliases = {
  keytar: path.resolve(__dirname, 'src/lib/webui-shims/keytar'),
  'desktop-notifications': path.resolve(
    __dirname,
    'src/lib/webui-shims/desktop-notifications'
  ),
  'desktop-notifications/dist/notification-callback': path.resolve(
    __dirname,
    'src/lib/webui-shims/desktop-notifications'
  ),
  'desktop-trampoline': path.resolve(
    __dirname,
    'src/lib/webui-shims/desktop-trampoline'
  ),
  'fs-admin': path.resolve(__dirname, 'src/lib/webui-shims/fs-admin'),
  'registry-js': path.resolve(__dirname, 'src/lib/webui-shims/registry-js'),
  electron: path.resolve(__dirname, 'src/ui/platform/electron-web-shim'),
  'electron/main': path.resolve(__dirname, 'src/ui/platform/electron-web-shim'),
  fs: path.resolve(__dirname, 'src/ui/platform/fs-web-shim'),
  'fs/promises': path.resolve(
    __dirname,
    'src/ui/platform/fs-promises-web-shim'
  ),
  path: path.resolve(__dirname, 'src/ui/platform/path-web-shim'),
  child_process: path.resolve(
    __dirname,
    'src/ui/platform/child-process-web-shim'
  ),
  [path.resolve(__dirname, 'src/main-process/menu')]: path.resolve(
    __dirname,
    'src/ui/platform/menu-web-shim'
  ),
}

const webRenderer: webpack.Configuration = {
  name: 'web-renderer',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: 'source-map',
  target: 'web',
  entry: {
    web: path.resolve(__dirname, 'src/ui/web-index'),
  },
  output: {
    filename: 'webui.js',
    path: path.join(outputDir, 'web'),
    publicPath: '/',
  },
  module: {
    rules: [
      tsRule,
      {
        test: /\.(scss|css)$/,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.(jpe?g|png|gif|ico)$/,
        type: 'asset/resource',
      },
      {
        test: /\.cmd$/,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
    alias: webAliases,
    fallback: {
      buffer: false,
      crypto: false,
      os: false,
      stream: false,
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'static', 'index.html'),
      chunks: ['web'],
    }),
    new webpack.DefinePlugin(
      Object.assign({}, replacements, {
        __PROCESS_KIND__: JSON.stringify('web'),
      })
    ),
  ],
}

const webServer: webpack.Configuration = merge(
  {},
  {
    optimization: {
      emitOnErrors: false,
    },
    externals: common.externals,
    output: {
      filename: 'web-server.js',
      path: outputDir,
      library: {
        type: 'commonjs2',
      },
    },
    module: {
      rules: [
        tsRule,
        {
          test: /\.node$/,
          loader: 'awesome-node-loader',
          options: {
            name: '[name].[ext]',
          },
        },
      ],
    },
    resolve: {
      extensions: ['.js', '.ts', '.tsx'],
      alias: {
        keytar: path.resolve(__dirname, 'src/lib/webui-shims/keytar'),
        'desktop-notifications': path.resolve(
          __dirname,
          'src/lib/webui-shims/desktop-notifications'
        ),
        'desktop-notifications/dist/notification-callback': path.resolve(
          __dirname,
          'src/lib/webui-shims/desktop-notifications'
        ),
        'desktop-trampoline': path.resolve(
          __dirname,
          'src/lib/webui-shims/desktop-trampoline'
        ),
        'fs-admin': path.resolve(__dirname, 'src/lib/webui-shims/fs-admin'),
        'registry-js': path.resolve(
          __dirname,
          'src/lib/webui-shims/registry-js'
        ),
        electron: path.resolve(__dirname, 'src/web-server/electron-shim'),
        'electron/main': path.resolve(
          __dirname,
          'src/web-server/electron-shim'
        ),
      },
    },
    node: {
      __dirname: false,
      __filename: false,
    },
  },
  {
    name: 'web-server',
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: 'source-map',
    target: 'node',
    entry: {
      server: path.resolve(__dirname, 'src/web-server/main'),
    },
    plugins: [
      new webpack.DefinePlugin(
        Object.assign({}, replacements, {
          __PROCESS_KIND__: JSON.stringify('web-server'),
        })
      ),
    ],
  }
)

// eslint-disable-next-line no-restricted-syntax
export default [webRenderer, webServer]
