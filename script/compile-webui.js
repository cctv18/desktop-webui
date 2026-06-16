'use strict'

const fs = require('fs')
const path = require('path')

const compileOptions = parseCompileOptions(process.argv.slice(2))
const mode = compileOptions.mode
const projectRoot = path.resolve(__dirname, '..')
const outDir = path.join(projectRoot, 'out')
const targetPlatform = normalizeTargetPlatform(
  compileOptions.platform || process.env.WEBUI_TARGET_PLATFORM || 'all'
)
const debugBuild =
  compileOptions.debugBuild || isTruthy(process.env.WEBUI_DEBUG_BUILD)
const deleteSourceMaps =
  compileOptions.deleteSourceMaps ||
  isTruthy(process.env.WEBUI_DELETE_SOURCE_MAPS)
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
const requiredRuntimeNodeMajor = 20
const preferredRuntimeNodeMajor = 22
const copilotRuntimePackageVersion = '1.0.62'
const copilotRuntimePackageSpec = `@github/copilot@${copilotRuntimePackageVersion}`

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

function parseCompileOptions(values) {
  const result = {
    mode: 'development',
    platform: undefined,
    debugBuild: false,
    deleteSourceMaps: false,
  }

  for (let index = 0; index < values.length; index++) {
    const value = values[index]

    if (value === 'production' || value === 'development') {
      result.mode = value
      continue
    }

    if (value === '--debug-build' || value === '--debugBuild') {
      result.debugBuild = true
      continue
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
      result.platform = values[index + 1]
      index++
      continue
    }

    if (value.startsWith('--platform=')) {
      result.platform = value.slice('--platform='.length)
      continue
    }

    if (value.startsWith('--Platform=')) {
      result.platform = value.slice('--Platform='.length)
    }
  }

  return result
}

function normalizeTargetPlatform(value) {
  const normalized = `${value || 'all'}`.trim().toLowerCase()

  switch (normalized) {
    case '':
    case 'all':
      return 'all'
    case 'current':
    case 'host':
      return normalizeNodePlatform(process.platform)
    case 'windows':
    case 'win':
    case 'win32':
      return 'win32'
    case 'mac':
    case 'macos':
    case 'darwin':
      return 'darwin'
    case 'linux':
      return 'linux'
    case 'android':
      return 'android'
    default:
      throw new Error(
        `Unsupported WebUI target platform "${value}". Use all, current, win32/windows, linux, darwin/macos, or android.`
      )
  }
}

function normalizeNodePlatform(value) {
  return value === 'win32' || value === 'darwin' || value === 'linux'
    ? value
    : value === 'android'
      ? 'android'
      : 'all'
}

function isTruthy(value) {
  if (value === undefined) {
    return false
  }

  const normalized = `${value}`.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
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
    `Target platform: ${targetPlatform}`,
    `Debug build: ${debugBuild ? 'yes' : 'no'}`,
    `Delete source maps: ${deleteSourceMaps ? 'yes' : 'no'}`,
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
  const faviconSource = path.join(commonStaticSource, 'favicon.ico')
  const faviconDestination = path.join(webOutDir, 'favicon.ico')
  const copilotDestination = path.join(outDir, 'copilot')
  const runtimeFiles = writeRuntimeLauncherFiles()

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
  if (fs.existsSync(faviconSource)) {
    fs.copyFileSync(faviconSource, faviconDestination)
  }
  generateLicenseMetadata(webOutDir)

  fs.rmSync(emojiImagesDestination, { recursive: true, force: true })
  fs.cpSync(emojiImagesSource, emojiImagesDestination, {
    recursive: true,
    verbatimSymlinks: true,
  })
  fs.copyFileSync(emojiJsonSource, emojiJsonDestination)

  fs.rmSync(copilotDestination, { recursive: true, force: true })

  const text = [
    '================ WEBUI RUNTIME ASSETS ================',
    `Copied static assets to: ${staticDestination}`,
    `Copied favicon to: ${faviconDestination}`,
    `Copied emoji images to: ${emojiImagesDestination}`,
    `Copied emoji metadata to: ${emojiJsonDestination}`,
    `Wrote runtime config to: ${runtimeFiles.serverConfigPath}`,
    `Wrote log timestamp hook to: ${runtimeFiles.timestampHookPath}`,
    `Wrote POSIX launcher to: ${runtimeFiles.shellLauncherPath}`,
    `Wrote PowerShell launcher to: ${runtimeFiles.powershellLauncherPath}`,
    `Copilot CLI will be installed by the runtime launcher when needed: ${copilotRuntimePackageSpec}`,
    `Runtime cleanup: ${debugBuild ? 'disabled (DebugBuild)' : 'enabled'}`,
    `Source map cleanup: ${deleteSourceMaps ? 'enabled' : 'disabled'}`,
    '============== END WEBUI RUNTIME ASSETS ==============',
    '',
  ].join('\n')

  appendBuildLog(text)

  if (deleteSourceMaps) {
    removeSourceMaps(outDir)
  }

  if (!debugBuild) {
    pruneReleaseRuntimeAssets()
  }
}

function getCopilotPackagePlatformsForTarget(platform) {
  switch (platform) {
    case 'win32':
      return ['win32']
    case 'darwin':
      return ['darwin']
    case 'android':
      return ['linux', 'linuxmusl']
    case 'linux':
      return ['linux', 'linuxmusl']
    default:
      return ['darwin', 'linux', 'linuxmusl', 'win32']
  }
}

function pruneReleaseRuntimeAssets() {
  pruneCopilotPlatformDirectories(path.join(outDir, 'copilot'))
  pruneCopilotExecutablePackages()
}

function removeSourceMaps(directory) {
  if (!fs.existsSync(directory)) {
    return
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      removeSourceMaps(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      fs.rmSync(fullPath, { force: true })
    }
  }
}

function pruneCopilotPlatformDirectories(rootDir) {
  if (targetPlatform === 'all' || !fs.existsSync(rootDir)) {
    return
  }

  const allowedPlatforms = new Set(
    getCopilotPackagePlatformsForTarget(targetPlatform)
  )
  const platformTokens = ['darwin', 'linux', 'linuxmusl', 'win32']

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name)

    if (!entry.isDirectory()) {
      continue
    }

    const matchedPlatform = platformTokens.find(platform =>
      entry.name.includes(platform)
    )

    if (
      matchedPlatform !== undefined &&
      !allowedPlatforms.has(matchedPlatform)
    ) {
      fs.rmSync(fullPath, { recursive: true, force: true })
      continue
    }

    pruneCopilotPlatformDirectories(fullPath)
  }
}

function pruneCopilotExecutablePackages() {
  if (targetPlatform === 'all') {
    return
  }

  const githubDestinationDir = path.join(outDir, 'node_modules', '@github')

  if (!fs.existsSync(githubDestinationDir)) {
    return
  }

  for (const entry of fs.readdirSync(githubDestinationDir)) {
    if (
      isCopilotExecutablePackage(entry) &&
      !shouldIncludeCopilotExecutablePackage(entry)
    ) {
      fs.rmSync(path.join(githubDestinationDir, entry), {
        recursive: true,
        force: true,
      })
    }
  }
}

function writeRuntimeLauncherFiles() {
  const serverConfigPath = path.join(outDir, 'server.conf')
  const shellLauncherPath = path.join(outDir, 'run-webui.sh')
  const powershellLauncherPath = path.join(outDir, 'run-webui.ps1')
  const timestampHookPath = path.join(outDir, 'webui-log-timestamps.js')

  fs.writeFileSync(serverConfigPath, getDefaultServerConfig(), 'utf8')
  fs.writeFileSync(timestampHookPath, getWebUILogTimestampHook(), 'utf8')
  fs.writeFileSync(shellLauncherPath, getRunWebUISh(), 'utf8')
  fs.writeFileSync(powershellLauncherPath, getRunWebUIPowerShell(), 'utf8')

  try {
    fs.chmodSync(shellLauncherPath, 0o755)
  } catch (error) {
    appendUtf8File(
      diagnosticsLogPath,
      `Unable to mark POSIX launcher as executable: ${error}\n`
    )
  }

  return {
    serverConfigPath,
    timestampHookPath,
    shellLauncherPath,
    powershellLauncherPath,
  }
}

function getWebUILogTimestampHook() {
  return [
    "'use strict'",
    '',
    'function pad(value, length) {',
    '  return String(value).padStart(length, "0")',
    '}',
    '',
    'function timestamp() {',
    '  const now = new Date()',
    '  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`',
    '  const time = `${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}.${pad(now.getMilliseconds(), 3)}000`',
    '  return `[${date} ${time}]`',
    '}',
    '',
    'for (const method of ["log", "info", "warn", "error", "debug"]) {',
    '  const original = console[method].bind(console)',
    '  console[method] = (...args) => original(timestamp(), ...args)',
    '}',
    '',
  ].join('\n')
}

function getDefaultServerConfig() {
  return [
    '# GitDesk WebUI runtime configuration.',
    '# Lines beginning with # are comments. Values are read by run-webui.sh and run-webui.ps1.',
    '# Relative paths are resolved from the directory containing web-server.js.',
    '',
    'host=127.0.0.1',
    'port=8080',
    'public-url=http://127.0.0.1:8080',
    '',
    '# Use : to separate multiple roots on Linux/Android and ; on Windows.',
    'allowedRoot=.',
    '',
    '# The WebUI server has a built-in default OAuth client id.',
    '# Remove the leading # only when overriding it manually.',
    '# oauth-client-id=Ov23liz1Wb08XDEhs7tm',
    '# oauth-client-secret=',
    '# oauth-callback-url=',
    '',
    '# Leave Git paths commented to let GitDesk WebUI discover Git from PATH.',
    '# git-path=/usr/bin/git',
    '# git-directory=',
    '# git-exec-path=/usr/lib/git-core',
    '# git-config-global=',
    '',
    'data-dir=.gitdesk-webui',
    'static-root=web',
    '# Leave commented to auto-detect runtime-installed Copilot support.',
    '# If the files are missing, run-webui will try a local npm install into this directory.',
    '# copilot-cli-path=node_modules/@github/copilot/index.js',
    '',
  ].join('\n')
}

function getRunWebUISh() {
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    '',
    'SCRIPT_PATH=$0',
    'case "$SCRIPT_PATH" in',
    '  /*) ;;',
    '  *) SCRIPT_PATH=$PWD/$SCRIPT_PATH ;;',
    'esac',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)',
    'CONFIG_FILE=$SCRIPT_DIR/server.conf',
    '',
    'HOST=',
    'PORT=',
    'PUBLIC_URL=',
    'ALLOWED_ROOT=',
    'OAUTH_CLIENT_ID=',
    'OAUTH_CLIENT_SECRET=',
    'OAUTH_CALLBACK_URL=',
    'GIT_PATH=',
    'GIT_DIRECTORY=',
    'GIT_EXEC_PATH=',
    'GIT_CONFIG_GLOBAL=',
    'DATA_DIR=',
    'STATIC_ROOT=',
    'COPILOT_CLI_PATH=',
    '',
    'CLI_HOST=',
    'CLI_PORT=',
    'CLI_PUBLIC_URL=',
    'CLI_ALLOWED_ROOT=',
    'CLI_OAUTH_CLIENT_ID=',
    'CLI_OAUTH_CLIENT_SECRET=',
    'CLI_OAUTH_CALLBACK_URL=',
    'CLI_GIT_PATH=',
    'CLI_GIT_DIRECTORY=',
    'CLI_GIT_EXEC_PATH=',
    'CLI_GIT_CONFIG_GLOBAL=',
    'CLI_DATA_DIR=',
    'CLI_STATIC_ROOT=',
    'CLI_COPILOT_CLI_PATH=',
    '',
    'usage() {',
    "  cat <<'USAGE'",
    'Usage: ./run-webui.sh [options]',
    '',
    'Options override values in server.conf:',
    '  --config <path>             Runtime config file. Default: ./server.conf',
    '  --host <host>               Host to bind',
    '  --port <port>               Port to bind',
    '  --public-url <url>          Browser-visible WebUI base URL',
    '  --allowed-root <paths>      Allowed repository roots',
    '  --oauth-client-id <id>      GitHub OAuth app client id',
    '  --oauth-client-secret <s>   GitHub OAuth app client secret',
    '  --oauth-callback-url <url>  OAuth callback URL',
    '  --git-path <path>           Git executable path',
    '  --git-directory <path>      Git installation root',
    '  --git-exec-path <path>      Git helper directory',
    '  --git-config-global <path>  Isolated global gitconfig path',
    '  --data-dir <path>           Account/token data directory',
    '  --static-root <path>        Web static asset directory',
    '  --copilot-cli-path <path>   Copilot CLI index.js path or package directory',
    '  -h, --help                  Show this help',
    'USAGE',
    '}',
    '',
    'trim() {',
    '  printf "%s" "$1" | sed "s/^[[:space:]]*//;s/[[:space:]]*$//"',
    '}',
    '',
    'command_exists() {',
    '  command -v "$1" >/dev/null 2>&1',
    '}',
    '',
    'run_as_root() {',
    '  if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then',
    '    "$@"',
    '  elif command_exists sudo; then',
    '    sudo "$@"',
    '  else',
    '    "$@"',
    '  fi',
    '}',
    '',
    'install_node_lts() {',
    `  echo "Installing Node.js ${preferredRuntimeNodeMajor} LTS for GitDesk WebUI runtime."`,
    '  if command_exists pkg; then',
    '    pkg install -y nodejs-lts || pkg install -y nodejs',
    '  elif command_exists apt-get; then',
    '    if command_exists curl; then',
    `      run_as_root sh -c "curl -fsSL https://deb.nodesource.com/setup_${preferredRuntimeNodeMajor}.x | bash -"`,
    '    elif command_exists wget; then',
    `      run_as_root sh -c "wget -qO- https://deb.nodesource.com/setup_${preferredRuntimeNodeMajor}.x | bash -"`,
    '    fi',
    '    run_as_root apt-get update',
    '    run_as_root apt-get install -y nodejs',
    '  elif command_exists dnf; then',
    '    if command_exists curl; then',
    `      run_as_root sh -c "curl -fsSL https://rpm.nodesource.com/setup_${preferredRuntimeNodeMajor}.x | bash -"`,
    '    fi',
    '    run_as_root dnf install -y nodejs npm',
    '  elif command_exists yum; then',
    '    if command_exists curl; then',
    `      run_as_root sh -c "curl -fsSL https://rpm.nodesource.com/setup_${preferredRuntimeNodeMajor}.x | bash -"`,
    '    fi',
    '    run_as_root yum install -y nodejs npm',
    '  elif command_exists pacman; then',
    '    run_as_root pacman -Sy --noconfirm nodejs npm',
    '  elif command_exists zypper; then',
    '    run_as_root zypper install -y nodejs npm',
    '  elif command_exists apk; then',
    '    run_as_root apk add nodejs-current npm || run_as_root apk add nodejs npm',
    '  else',
    `    echo "Node.js ${requiredRuntimeNodeMajor} or newer is required. Install Node.js ${preferredRuntimeNodeMajor} LTS, then rerun this script." >&2`,
    '    exit 1',
    '  fi',
    '  hash -r 2>/dev/null || true',
    '}',
    '',
    'ensure_node() {',
    '  if ! command_exists node; then',
    '    install_node_lts',
    '  fi',
    '',
    '  if command_exists node; then',
    '    NODE_MAJOR=$(node -p "Number(process.versions.node.split(\\".\\")[0])")',
    '  else',
    '    NODE_MAJOR=0',
    '  fi',
    '',
    `  if [ "$NODE_MAJOR" -lt ${requiredRuntimeNodeMajor} ]; then`,
    '    install_node_lts',
    '  fi',
    '',
    '  if ! command_exists node; then',
    '    echo "Node.js is still not available. Open a new shell and rerun this script." >&2',
    '    exit 1',
    '  fi',
    '',
    '  NODE_MAJOR=$(node -p "Number(process.versions.node.split(\\".\\")[0])")',
    `  if [ "$NODE_MAJOR" -lt ${requiredRuntimeNodeMajor} ]; then`,
    `    echo "Node.js ${requiredRuntimeNodeMajor} or newer is required. Node.js ${preferredRuntimeNodeMajor} LTS is recommended." >&2`,
    '    exit 1',
    '  fi',
    '}',
    '',
    'ensure_copilot_runtime() {',
    '  [ -n "$COPILOT_CLI_PATH" ] && return 0',
    '',
    '  managed_copilot_dir="$SCRIPT_DIR/node_modules/@github/copilot"',
    '  managed_copilot_index="$managed_copilot_dir/index.js"',
    '  managed_copilot_package="$managed_copilot_dir/package.json"',
    `  required_copilot_version="${copilotRuntimePackageVersion}"`,
    '  installed_copilot_version=',
    '',
    '  if [ -f "$managed_copilot_package" ]; then',
    '    installed_copilot_version=$(node -e "try { const pkg = require(process.argv[1]); console.log(pkg.version || \'\') } catch { process.exit(1) }" "$managed_copilot_package" 2>/dev/null || true)',
    '  fi',
    '',
    '  if [ -f "$managed_copilot_index" ] && [ "$installed_copilot_version" = "$required_copilot_version" ]; then',
    '    COPILOT_CLI_PATH=$managed_copilot_index',
    '    return 0',
    '  fi',
    '',
    '  if ! command_exists npm; then',
    '    echo "Warning: Copilot CLI is not installed and npm was not found. Copilot models will be unavailable until @github/copilot is installed." >&2',
    '    return 0',
    '  fi',
    '',
    `  echo "Copilot CLI is not installed. Installing ${copilotRuntimePackageSpec} into $SCRIPT_DIR."`,
    `  if npm install --omit=dev --omit=optional --no-audit --no-fund --prefix "$SCRIPT_DIR" "${copilotRuntimePackageSpec}"; then`,
    '    if [ -f "$managed_copilot_index" ]; then',
    '      COPILOT_CLI_PATH=$managed_copilot_index',
    '      return 0',
    '    fi',
    '  fi',
    '',
    '  echo "Warning: Unable to install Copilot CLI runtime. Copilot models will be unavailable until @github/copilot is installed." >&2',
    '}',
    '',
    'set_config_value() {',
    '  case "$1" in',
    '    host) HOST=$2 ;;',
    '    port) PORT=$2 ;;',
    '    public-url|publicUrl) PUBLIC_URL=$2 ;;',
    '    allowedRoot|allowed-root) ALLOWED_ROOT=$2 ;;',
    '    oauth-client-id|oauthClientId) OAUTH_CLIENT_ID=$2 ;;',
    '    oauth-client-secret|oauthClientSecret) OAUTH_CLIENT_SECRET=$2 ;;',
    '    oauth-callback-url|oauthCallbackUrl) OAUTH_CALLBACK_URL=$2 ;;',
    '    git-path|gitPath) GIT_PATH=$2 ;;',
    '    git-directory|gitDirectory) GIT_DIRECTORY=$2 ;;',
    '    git-exec-path|gitExecPath) GIT_EXEC_PATH=$2 ;;',
    '    git-config-global|gitConfigGlobal) GIT_CONFIG_GLOBAL=$2 ;;',
    '    data-dir|dataDir) DATA_DIR=$2 ;;',
    '    static-root|staticRoot) STATIC_ROOT=$2 ;;',
    '    copilot-cli-path|copilotCliPath) COPILOT_CLI_PATH=$2 ;;',
    '  esac',
    '}',
    '',
    'load_config() {',
    '  [ -f "$CONFIG_FILE" ] || return 0',
    '',
    '  while IFS= read -r line || [ -n "$line" ]; do',
    '    case "$line" in',
    '      ""|\\#*) continue ;;',
    '      *=*) ;;',
    '      *) continue ;;',
    '    esac',
    '',
    '    key=$(trim "${line%%=*}")',
    '    value=$(trim "${line#*=}")',
    '    [ -n "$key" ] || continue',
    '    set_config_value "$key" "$value"',
    '  done < "$CONFIG_FILE"',
    '}',
    '',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --config) CONFIG_FILE=$2; shift 2 ;;',
    '    --host) CLI_HOST=$2; shift 2 ;;',
    '    --port) CLI_PORT=$2; shift 2 ;;',
    '    --public-url) CLI_PUBLIC_URL=$2; shift 2 ;;',
    '    --allowed-root|--allowedRoot) CLI_ALLOWED_ROOT=$2; shift 2 ;;',
    '    --oauth-client-id) CLI_OAUTH_CLIENT_ID=$2; shift 2 ;;',
    '    --oauth-client-secret) CLI_OAUTH_CLIENT_SECRET=$2; shift 2 ;;',
    '    --oauth-callback-url) CLI_OAUTH_CALLBACK_URL=$2; shift 2 ;;',
    '    --git-path) CLI_GIT_PATH=$2; shift 2 ;;',
    '    --git-directory) CLI_GIT_DIRECTORY=$2; shift 2 ;;',
    '    --git-exec-path) CLI_GIT_EXEC_PATH=$2; shift 2 ;;',
    '    --git-config-global) CLI_GIT_CONFIG_GLOBAL=$2; shift 2 ;;',
    '    --data-dir) CLI_DATA_DIR=$2; shift 2 ;;',
    '    --static-root|--staticRoot) CLI_STATIC_ROOT=$2; shift 2 ;;',
    '    --copilot-cli-path) CLI_COPILOT_CLI_PATH=$2; shift 2 ;;',
    '    -h|--help) usage; exit 0 ;;',
    '    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;',
    '  esac',
    'done',
    '',
    'load_config',
    '',
    '[ -n "$CLI_HOST" ] && HOST=$CLI_HOST',
    '[ -n "$CLI_PORT" ] && PORT=$CLI_PORT',
    '[ -n "$CLI_PUBLIC_URL" ] && PUBLIC_URL=$CLI_PUBLIC_URL',
    '[ -n "$CLI_ALLOWED_ROOT" ] && ALLOWED_ROOT=$CLI_ALLOWED_ROOT',
    '[ -n "$CLI_OAUTH_CLIENT_ID" ] && OAUTH_CLIENT_ID=$CLI_OAUTH_CLIENT_ID',
    '[ -n "$CLI_OAUTH_CLIENT_SECRET" ] && OAUTH_CLIENT_SECRET=$CLI_OAUTH_CLIENT_SECRET',
    '[ -n "$CLI_OAUTH_CALLBACK_URL" ] && OAUTH_CALLBACK_URL=$CLI_OAUTH_CALLBACK_URL',
    '[ -n "$CLI_GIT_PATH" ] && GIT_PATH=$CLI_GIT_PATH',
    '[ -n "$CLI_GIT_DIRECTORY" ] && GIT_DIRECTORY=$CLI_GIT_DIRECTORY',
    '[ -n "$CLI_GIT_EXEC_PATH" ] && GIT_EXEC_PATH=$CLI_GIT_EXEC_PATH',
    '[ -n "$CLI_GIT_CONFIG_GLOBAL" ] && GIT_CONFIG_GLOBAL=$CLI_GIT_CONFIG_GLOBAL',
    '[ -n "$CLI_DATA_DIR" ] && DATA_DIR=$CLI_DATA_DIR',
    '[ -n "$CLI_STATIC_ROOT" ] && STATIC_ROOT=$CLI_STATIC_ROOT',
    '[ -n "$CLI_COPILOT_CLI_PATH" ] && COPILOT_CLI_PATH=$CLI_COPILOT_CLI_PATH',
    '',
    'HOST=${HOST:-127.0.0.1}',
    'PORT=${PORT:-8080}',
    '',
    'ensure_node',
    'ensure_copilot_runtime',
    '',
    'if [ ! -f "$SCRIPT_DIR/web-server.js" ]; then',
    '  echo "web-server.js was not found next to this launcher: $SCRIPT_DIR" >&2',
    '  exit 1',
    'fi',
    '',
    'if [ -z "$GIT_PATH" ] && ! command -v git >/dev/null 2>&1; then',
    '  echo "Warning: git was not found on PATH. Set git-path in server.conf if repository operations fail." >&2',
    'fi',
    '',
    'cd "$SCRIPT_DIR"',
    '',
    'TIMESTAMP_HOOK=$SCRIPT_DIR/webui-log-timestamps.js',
    'set --',
    '[ -f "$TIMESTAMP_HOOK" ] && set -- "$@" --require "$TIMESTAMP_HOOK"',
    'set -- "$@" web-server.js',
    '[ -n "$HOST" ] && set -- "$@" --host "$HOST"',
    '[ -n "$PORT" ] && set -- "$@" --port "$PORT"',
    '[ -n "$PUBLIC_URL" ] && set -- "$@" --public-url "$PUBLIC_URL"',
    '[ -n "$ALLOWED_ROOT" ] && set -- "$@" --allowedRoot "$ALLOWED_ROOT"',
    '[ -n "$OAUTH_CLIENT_ID" ] && set -- "$@" --oauth-client-id "$OAUTH_CLIENT_ID"',
    '[ -n "$OAUTH_CLIENT_SECRET" ] && set -- "$@" --oauth-client-secret "$OAUTH_CLIENT_SECRET"',
    '[ -n "$OAUTH_CALLBACK_URL" ] && set -- "$@" --oauth-callback-url "$OAUTH_CALLBACK_URL"',
    '[ -n "$GIT_PATH" ] && set -- "$@" --git-path "$GIT_PATH"',
    '[ -n "$GIT_DIRECTORY" ] && set -- "$@" --git-directory "$GIT_DIRECTORY"',
    '[ -n "$GIT_EXEC_PATH" ] && set -- "$@" --git-exec-path "$GIT_EXEC_PATH"',
    '[ -n "$GIT_CONFIG_GLOBAL" ] && set -- "$@" --git-config-global "$GIT_CONFIG_GLOBAL"',
    '[ -n "$DATA_DIR" ] && set -- "$@" --data-dir "$DATA_DIR"',
    '[ -n "$STATIC_ROOT" ] && set -- "$@" --static-root "$STATIC_ROOT"',
    '[ -n "$COPILOT_CLI_PATH" ] && set -- "$@" --copilot-cli-path "$COPILOT_CLI_PATH"',
    '',
    'echo "[$(date "+%Y-%m-%d %H:%M:%S.%3N000" 2>/dev/null || date)] Starting GitDesk WebUI on http://$HOST:$PORT"',
    'exec node "$@"',
    '',
  ].join('\n')
}

function getRunWebUIPowerShell() {
  return [
    'param(',
    '  [string]$Config = "",',
    '  [string]$HostAddress = "",',
    '  [int]$Port = 0,',
    '  [string]$PublicUrl = "",',
    '  [string]$AllowedRoot = "",',
    '  [string]$OAuthClientId = "",',
    '  [string]$OAuthClientSecret = "",',
    '  [string]$OAuthCallbackUrl = "",',
    '  [string]$GitPath = "",',
    '  [string]$GitDirectory = "",',
    '  [string]$GitExecPath = "",',
    '  [string]$GitConfigGlobal = "",',
    '  [string]$DataDir = "",',
    '  [string]$StaticRoot = "",',
    '  [string]$CopilotCliPath = ""',
    ')',
    '',
    '$ErrorActionPreference = "Stop"',
    '$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    'if ([string]::IsNullOrWhiteSpace($Config)) {',
    '  $Config = Join-Path $ScriptDir "server.conf"',
    '}',
    '',
    'function Read-ServerConfig {',
    '  param([string]$Path)',
    '  $values = @{}',
    '',
    '  if (-not (Test-Path $Path)) {',
    '    return $values',
    '  }',
    '',
    '  foreach ($line in Get-Content -LiteralPath $Path) {',
    '    $trimmed = $line.Trim()',
    '    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {',
    '      continue',
    '    }',
    '',
    '    $separator = $trimmed.IndexOf("=")',
    '    if ($separator -lt 1) {',
    '      continue',
    '    }',
    '',
    '    $key = $trimmed.Substring(0, $separator).Trim()',
    '    $value = $trimmed.Substring($separator + 1).Trim()',
    '    $values[$key] = $value',
    '  }',
    '',
    '  return $values',
    '}',
    '',
    'function Get-ConfigValue {',
    '  param(',
    '    [hashtable]$Values,',
    '    [string[]]$Names,',
    '    [string]$Fallback = ""',
    '  )',
    '',
    '  foreach ($name in $Names) {',
    '    if ($Values.ContainsKey($name)) {',
    '      return [string]$Values[$name]',
    '    }',
    '  }',
    '',
    '  return $Fallback',
    '}',
    '',
    'function Add-ServerArgument {',
    '  param(',
    '    [string]$Name,',
    '    [string]$Value',
    '  )',
    '',
    '  if (-not [string]::IsNullOrWhiteSpace($Value)) {',
    '    $script:NodeArguments += @($Name, $Value)',
    '  }',
    '}',
    '',
    'function Refresh-Path {',
    '  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")',
    '  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
    '  $env:Path = "$machinePath;$userPath"',
    '}',
    '',
    'function Install-NodeLTS {',
    '  $winget = Get-Command winget -ErrorAction SilentlyContinue',
    '  if ($null -eq $winget) {',
    `    throw "Node.js ${requiredRuntimeNodeMajor} or newer is required, and winget was not found. Install Node.js ${preferredRuntimeNodeMajor} LTS, then rerun this script."`,
    '  }',
    '',
    `  Write-Host "Installing Node.js ${preferredRuntimeNodeMajor} LTS for GitDesk WebUI runtime."`,
    '  & $winget.Source upgrade -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
    '  if ($LASTEXITCODE -ne 0) {',
    '    & $winget.Source install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements',
    '    if ($LASTEXITCODE -ne 0) {',
    '      Write-Warning "winget could not install or upgrade Node.js LTS. The version check will continue and report a hard error if Node.js is still too old."',
    '    }',
    '  }',
    '',
    '  Refresh-Path',
    '}',
    '',
    'function Ensure-Node {',
    '  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue',
    '  if ($null -eq $nodeCommand) {',
    '    Install-NodeLTS',
    '    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue',
    '  }',
    '',
    '  if ($null -ne $nodeCommand) {',
    "    $nodeMajor = [int](& $nodeCommand.Source -p \"Number(process.versions.node.split('.')[0])\")",
    '  } else {',
    '    $nodeMajor = 0',
    '  }',
    '',
    `  if ($nodeMajor -lt ${requiredRuntimeNodeMajor}) {`,
    '    Install-NodeLTS',
    '    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue',
    '  }',
    '',
    '  if ($null -eq $nodeCommand) {',
    '    throw "Node.js is still not available. Open a new PowerShell window and rerun this script."',
    '  }',
    '',
    "  $nodeMajor = [int](& $nodeCommand.Source -p \"Number(process.versions.node.split('.')[0])\")",
    `  if ($nodeMajor -lt ${requiredRuntimeNodeMajor}) {`,
    `    throw "Node.js ${requiredRuntimeNodeMajor} or newer is required. Node.js ${preferredRuntimeNodeMajor} LTS is recommended."`,
    '  }',
    '',
    '  return $nodeCommand',
    '}',
    '',
    'function Ensure-CopilotRuntime {',
    '  param([string]$CurrentValue)',
    '',
    '  if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {',
    '    return $CurrentValue',
    '  }',
    '',
    `  $requiredCopilotVersion = "${copilotRuntimePackageVersion}"`,
    '  $installedDir = Join-Path $ScriptDir "node_modules\\@github\\copilot"',
    '  $installedIndex = Join-Path $installedDir "index.js"',
    '  $installedPackage = Join-Path $installedDir "package.json"',
    '  $installedVersion = ""',
    '  if (Test-Path $installedPackage) {',
    '    try {',
    '      $installedVersion = (Get-Content -LiteralPath $installedPackage -Raw | ConvertFrom-Json).version',
    '    } catch {',
    '      $installedVersion = ""',
    '    }',
    '  }',
    '',
    '  if ((Test-Path $installedIndex) -and $installedVersion -eq $requiredCopilotVersion) {',
    '    return $installedIndex',
    '  }',
    '',
    '  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue',
    '  if ($null -eq $npmCommand) {',
    '    Write-Warning "Copilot CLI is not installed and npm was not found. Copilot models will be unavailable until @github/copilot is installed."',
    '    return ""',
    '  }',
    '',
    `  Write-Host "Copilot CLI is not installed. Installing ${copilotRuntimePackageSpec} into $ScriptDir."`,
    `  & $npmCommand.Source install --omit=dev --omit=optional --no-audit --no-fund --prefix $ScriptDir "${copilotRuntimePackageSpec}"`,
    '  if ($LASTEXITCODE -eq 0 -and (Test-Path $installedIndex)) {',
    '    return $installedIndex',
    '  }',
    '',
    '  Write-Warning "Unable to install Copilot CLI runtime. Copilot models will be unavailable until @github/copilot is installed."',
    '  return ""',
    '}',
    '',
    '$configValues = Read-ServerConfig $Config',
    '$hostValue = Get-ConfigValue $configValues @("host") "127.0.0.1"',
    '$portValue = Get-ConfigValue $configValues @("port") "8080"',
    '$publicUrlValue = Get-ConfigValue $configValues @("public-url", "publicUrl") ""',
    '$allowedRootValue = Get-ConfigValue $configValues @("allowedRoot", "allowed-root") ""',
    '$oauthClientIdValue = Get-ConfigValue $configValues @("oauth-client-id", "oauthClientId") ""',
    '$oauthClientSecretValue = Get-ConfigValue $configValues @("oauth-client-secret", "oauthClientSecret") ""',
    '$oauthCallbackUrlValue = Get-ConfigValue $configValues @("oauth-callback-url", "oauthCallbackUrl") ""',
    '$gitPathValue = Get-ConfigValue $configValues @("git-path", "gitPath") ""',
    '$gitDirectoryValue = Get-ConfigValue $configValues @("git-directory", "gitDirectory") ""',
    '$gitExecPathValue = Get-ConfigValue $configValues @("git-exec-path", "gitExecPath") ""',
    '$gitConfigGlobalValue = Get-ConfigValue $configValues @("git-config-global", "gitConfigGlobal") ""',
    '$dataDirValue = Get-ConfigValue $configValues @("data-dir", "dataDir") ""',
    '$staticRootValue = Get-ConfigValue $configValues @("static-root", "staticRoot") ""',
    '$copilotCliPathValue = Get-ConfigValue $configValues @("copilot-cli-path", "copilotCliPath") ""',
    '',
    'if ($PSBoundParameters.ContainsKey("HostAddress")) { $hostValue = $HostAddress }',
    'if ($PSBoundParameters.ContainsKey("Port") -and $Port -gt 0) { $portValue = "$Port" }',
    'if ($PSBoundParameters.ContainsKey("PublicUrl")) { $publicUrlValue = $PublicUrl }',
    'if ($PSBoundParameters.ContainsKey("AllowedRoot")) { $allowedRootValue = $AllowedRoot }',
    'if ($PSBoundParameters.ContainsKey("OAuthClientId")) { $oauthClientIdValue = $OAuthClientId }',
    'if ($PSBoundParameters.ContainsKey("OAuthClientSecret")) { $oauthClientSecretValue = $OAuthClientSecret }',
    'if ($PSBoundParameters.ContainsKey("OAuthCallbackUrl")) { $oauthCallbackUrlValue = $OAuthCallbackUrl }',
    'if ($PSBoundParameters.ContainsKey("GitPath")) { $gitPathValue = $GitPath }',
    'if ($PSBoundParameters.ContainsKey("GitDirectory")) { $gitDirectoryValue = $GitDirectory }',
    'if ($PSBoundParameters.ContainsKey("GitExecPath")) { $gitExecPathValue = $GitExecPath }',
    'if ($PSBoundParameters.ContainsKey("GitConfigGlobal")) { $gitConfigGlobalValue = $GitConfigGlobal }',
    'if ($PSBoundParameters.ContainsKey("DataDir")) { $dataDirValue = $DataDir }',
    'if ($PSBoundParameters.ContainsKey("StaticRoot")) { $staticRootValue = $StaticRoot }',
    'if ($PSBoundParameters.ContainsKey("CopilotCliPath")) { $copilotCliPathValue = $CopilotCliPath }',
    '',
    '$nodeCommand = Ensure-Node',
    '$copilotCliPathValue = Ensure-CopilotRuntime $copilotCliPathValue',
    '',
    '$serverBundle = Join-Path $ScriptDir "web-server.js"',
    'if (-not (Test-Path $serverBundle)) {',
    '  throw "web-server.js was not found next to this launcher: $ScriptDir"',
    '}',
    '',
    'if ([string]::IsNullOrWhiteSpace($gitPathValue) -and $null -eq (Get-Command git -ErrorAction SilentlyContinue)) {',
    '  Write-Warning "git was not found on PATH. Set git-path in server.conf if repository operations fail."',
    '}',
    '',
    'Set-Location $ScriptDir',
    '$timestampHook = Join-Path $ScriptDir "webui-log-timestamps.js"',
    '$script:NodeArguments = @()',
    'if (Test-Path $timestampHook) {',
    '  $script:NodeArguments += @("--require", $timestampHook)',
    '}',
    '$script:NodeArguments += "web-server.js"',
    'Add-ServerArgument "--host" $hostValue',
    'Add-ServerArgument "--port" $portValue',
    'Add-ServerArgument "--public-url" $publicUrlValue',
    'Add-ServerArgument "--allowedRoot" $allowedRootValue',
    'Add-ServerArgument "--oauth-client-id" $oauthClientIdValue',
    'Add-ServerArgument "--oauth-client-secret" $oauthClientSecretValue',
    'Add-ServerArgument "--oauth-callback-url" $oauthCallbackUrlValue',
    'Add-ServerArgument "--git-path" $gitPathValue',
    'Add-ServerArgument "--git-directory" $gitDirectoryValue',
    'Add-ServerArgument "--git-exec-path" $gitExecPathValue',
    'Add-ServerArgument "--git-config-global" $gitConfigGlobalValue',
    'Add-ServerArgument "--data-dir" $dataDirValue',
    'Add-ServerArgument "--static-root" $staticRootValue',
    'Add-ServerArgument "--copilot-cli-path" $copilotCliPathValue',
    '',
    'Write-Host "[$((Get-Date).ToString(\'yyyy-MM-dd HH:mm:ss.ffffff\'))] Starting GitDesk WebUI on http://$hostValue`:$portValue"',
    '& $nodeCommand.Source @script:NodeArguments',
    'exit $LASTEXITCODE',
    '',
  ].join('\n')
}

function generateLicenseMetadata(webOutDir) {
  const chooseALicense = path.join(
    webOutDir,
    'static',
    'choosealicense.com'
  )
  const licensesDir = path.join(chooseALicense, '_licenses')

  if (!fs.existsSync(licensesDir)) {
    appendUtf8File(
      diagnosticsLogPath,
      `License metadata source not found: ${licensesDir}\n`
    )
    return
  }

  const licenses = []
  for (const file of fs.readdirSync(licensesDir)) {
    const fullPath = path.join(licensesDir, file)
    const contents = fs.readFileSync(fullPath, 'utf8')
    const parsed = parseLicenseFrontMatter(contents)

    if (parsed === null || parsed.attributes.hidden === true) {
      continue
    }

    licenses.push({
      name: parsed.attributes.nickname || parsed.attributes.title,
      featured: parsed.attributes.featured === true,
      hidden: false,
      body: `${parsed.body.trim()}\n`,
    })
  }

  fs.writeFileSync(
    path.join(webOutDir, 'static', 'available-licenses.json'),
    JSON.stringify(licenses),
    'utf8'
  )

  const chooseALicenseLicense = path.join(chooseALicense, 'LICENSE.md')
  if (fs.existsSync(chooseALicenseLicense)) {
    const licenseText = fs.readFileSync(chooseALicenseLicense, 'utf8')
    const licenseWithHeader = `GitHub Desktop uses licensing information provided by choosealicense.com.

The bundle in available-licenses.json has been generated from a source list provided at https://github.com/github/choosealicense.com, which is made available under the below license:

------------

${licenseText}`

    fs.writeFileSync(
      path.join(webOutDir, 'static', 'LICENSE.choosealicense.md'),
      licenseWithHeader,
      'utf8'
    )
  }

  fs.rmSync(chooseALicense, { recursive: true, force: true })
}

function parseLicenseFrontMatter(contents) {
  if (!contents.startsWith('---')) {
    return null
  }

  const end = contents.indexOf('\n---', 3)
  if (end < 0) {
    return null
  }

  const attributes = {}
  for (const rawLine of contents.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine.trim())
    if (match === null) {
      continue
    }

    const key = match[1]
    const value = match[2].trim()
    if (value === 'true') {
      attributes[key] = true
    } else if (value === 'false') {
      attributes[key] = false
    } else if (value.length > 0) {
      attributes[key] = value.replace(/^['"]|['"]$/g, '')
    }
  }

  if (typeof attributes.title !== 'string') {
    return null
  }

  return {
    attributes,
    body: contents.slice(end + '\n---'.length),
  }
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
