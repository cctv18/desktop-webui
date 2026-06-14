#!/usr/bin/env bash

set -euo pipefail

HOST_ADDRESS="127.0.0.1"
PORT="8080"
PUBLIC_URL=""
ALLOWED_ROOT=""
PRODUCTION=0
NO_START=0
SKIP_INSTALL=0
FULL_NATIVE_INSTALL=0
LOG_FILE="out/webui-deploy.log"
GIT_PATH=""
GIT_DIRECTORY=""
GIT_EXEC_PATH_ARG=""
GIT_CONFIG_GLOBAL=""
DATA_DIR=""
STATIC_ROOT=""
COPILOT_CLI_PATH=""
OAUTH_CLIENT_ID=""
OAUTH_CLIENT_SECRET=""
OAUTH_CALLBACK_URL=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: bash script/deploy-webui.sh [options]

Options:
  --host <host>            Host to bind. Default: 127.0.0.1
  --port <port>            Port to bind. Default: 8080
  --public-url <url>       Browser-visible WebUI base URL
  --allowed-root <path>    Filesystem root WebUI may access. Default: project root
  --production             Build production WebUI bundle
  --no-start               Install and compile only
  --skip-install           Do not run yarn install; fail if local deps are missing
  --full-native-install    Run package install scripts for full Desktop native dependencies
  --git-path <path>        Exact Git executable path for the WebUI server
  --git-directory <path>   Git installation root for the WebUI server
  --git-exec-path <path>   Git helper directory, e.g. /usr/lib/git-core
  --git-config-global <path>
                           Independent WebUI global gitconfig path
  --data-dir <path>        Independent WebUI account/token data directory
  --static-root <path>     Web static asset directory
  --copilot-cli-path <path>
                           Copilot CLI index.js path or package directory
  --oauth-client-id <id>   Override the built-in GitHub OAuth client id
  --oauth-client-secret <secret>
                           GitHub OAuth client secret
  --oauth-callback-url <url>
                           GitHub OAuth callback URL
  --log-file <path>        Write full deploy output to a log file. Default: out/webui-deploy.log
  --no-log-file            Do not write a deploy log file
  -h, --help               Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST_ADDRESS="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --public-url)
      PUBLIC_URL="$2"
      shift 2
      ;;
    --allowed-root)
      ALLOWED_ROOT="$2"
      shift 2
      ;;
    --production)
      PRODUCTION=1
      shift
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --full-native-install)
      FULL_NATIVE_INSTALL=1
      shift
      ;;
    --git-path)
      GIT_PATH="$2"
      shift 2
      ;;
    --git-directory)
      GIT_DIRECTORY="$2"
      shift 2
      ;;
    --git-exec-path)
      GIT_EXEC_PATH_ARG="$2"
      shift 2
      ;;
    --git-config-global)
      GIT_CONFIG_GLOBAL="$2"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="$2"
      shift 2
      ;;
    --static-root)
      STATIC_ROOT="$2"
      shift 2
      ;;
    --copilot-cli-path)
      COPILOT_CLI_PATH="$2"
      shift 2
      ;;
    --oauth-client-id)
      OAUTH_CLIENT_ID="$2"
      shift 2
      ;;
    --oauth-client-secret)
      OAUTH_CLIENT_SECRET="$2"
      shift 2
      ;;
    --oauth-callback-url)
      OAUTH_CALLBACK_URL="$2"
      shift 2
      ;;
    --log-file)
      LOG_FILE="$2"
      shift 2
      ;;
    --no-log-file)
      LOG_FILE=""
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ALLOWED_ROOT" ]]; then
  ALLOWED_ROOT="$PROJECT_ROOT"
fi

step() {
  printf '==> %s\n' "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

default_public_url() {
  local url_host="$HOST_ADDRESS"

  if [[ "$url_host" == "0.0.0.0" || "$url_host" == "::" || "$url_host" == "[::]" ]]; then
    url_host="127.0.0.1"
  elif [[ "$url_host" == *:* && "$url_host" != \[* ]]; then
    url_host="[$url_host]"
  fi

  printf 'http://%s:%s' "$url_host" "$PORT"
}

run() {
  "$@"
}

install_node() {
  step "Node.js was not found. Trying to install Node.js with the system package manager."

  if command_exists apt-get; then
    run sudo apt-get update
    run sudo apt-get install -y nodejs npm
  elif command_exists dnf; then
    run sudo dnf install -y nodejs npm
  elif command_exists yum; then
    run sudo yum install -y nodejs npm
  elif command_exists pacman; then
    run sudo pacman -Sy --noconfirm nodejs npm
  elif command_exists zypper; then
    run sudo zypper install -y nodejs npm
  elif command_exists apk; then
    run sudo apk add nodejs npm
  else
    echo "Node.js is required. Install Node.js 22 LTS, then rerun this script." >&2
    exit 1
  fi
}

ensure_node() {
  if ! command_exists node; then
    install_node
  fi

  if ! command_exists node; then
    echo "Node.js is still not available. Open a new shell and rerun this script." >&2
    exit 1
  fi

  local node_major
  local node_platform
  local node_arch
  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
  node_platform="$(node -p "process.platform")"
  node_arch="$(node -p "process.arch")"
  step "Node.js version: $(node -v)"
  step "Node.js platform/arch: $node_platform/$node_arch"

  if [[ "$node_major" -lt 18 ]]; then
    echo "Node.js 18 or newer is required. Node.js 22 LTS is recommended for WebUI testing." >&2
    exit 1
  fi

  if [[ "$node_major" -gt 22 ]]; then
    echo "Warning: Node.js 22 LTS is recommended. Newer versions such as Node.js $node_major may expose dependency compatibility issues." >&2
  fi

  case "$node_arch" in
    x64|arm64)
      ;;
    arm)
      echo "Warning: ARMv7/armv7a WebUI deployment is experimental. Some upstream Desktop dependencies do not publish ARMv7 prebuilt packages; prefer x64 or arm64 when possible." >&2
      ;;
    *)
      echo "Warning: Architecture '$node_arch' is not a primary WebUI target. x64 and arm64 are the expected deployment architectures." >&2
      ;;
  esac
}

ensure_yarn() {
  if command_exists yarn; then
    step "Yarn version: $(yarn --version)"
    return
  fi

  step "Yarn was not found. Trying Corepack first."

  if command_exists corepack; then
    corepack enable || true
    corepack prepare yarn@1.22.22 --activate || true
  fi

  if ! command_exists yarn; then
    step "Installing Yarn 1.x with npm."
    npm install --global yarn@1.22.22 || sudo npm install --global yarn@1.22.22
  fi

  if ! command_exists yarn; then
    echo "Yarn is still not available. Install Yarn 1.x, then rerun this script." >&2
    exit 1
  fi

  step "Yarn version: $(yarn --version)"
}

project_dependencies_present() {
  [[
    -d "$PROJECT_ROOT/node_modules/ts-node" &&
    -d "$PROJECT_ROOT/node_modules/webpack" &&
    -d "$PROJECT_ROOT/app/node_modules/react" &&
    -d "$PROJECT_ROOT/app/node_modules/dugite" &&
    -d "$PROJECT_ROOT/app/node_modules/@github/copilot"
  ]]
}

yarn_install() {
  local directory="$1"
  local ignore_scripts="$2"
  local args=(install --network-timeout 600000)

  if [[ "$ignore_scripts" -eq 1 ]]; then
    args+=(--ignore-scripts)
  fi

  (cd "$directory" && yarn "${args[@]}")
}

cd "$PROJECT_ROOT"

if [[ -n "$LOG_FILE" ]]; then
  if [[ "$LOG_FILE" != /* ]]; then
    LOG_FILE="$PROJECT_ROOT/$LOG_FILE"
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"
  export NO_COLOR="${NO_COLOR:-1}"
  export FORCE_COLOR="${FORCE_COLOR:-0}"
  LOG_STEM="${LOG_FILE%.*}"
  export WEBUI_BUILD_LOG="${WEBUI_BUILD_LOG:-$LOG_FILE}"
  export WEBUI_DIAGNOSTICS_LOG="${WEBUI_DIAGNOSTICS_LOG:-$LOG_STEM.diagnostics.log}"
  export WEBUI_DIAGNOSTICS_JSON="${WEBUI_DIAGNOSTICS_JSON:-$LOG_STEM.diagnostics.json}"
  export WEBUI_CONSOLE_DIAGNOSTICS="${WEBUI_CONSOLE_DIAGNOSTICS:-0}"
  exec > >(tee -a "$LOG_FILE") 2>&1
fi

step "Project root: $PROJECT_ROOT"
step "Allowed root: $ALLOWED_ROOT"
if [[ -n "$LOG_FILE" ]]; then
  step "Detailed WebUI build log: $WEBUI_BUILD_LOG"
  step "Detailed WebUI diagnostics log: $WEBUI_DIAGNOSTICS_LOG"
  step "Detailed WebUI diagnostics JSON: $WEBUI_DIAGNOSTICS_JSON"
fi

ensure_node
ensure_yarn

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  step "Yarn optional dependency platform/CPU exclusion messages are expected; Yarn is selecting packages for the current architecture."

  if [[ "$FULL_NATIVE_INSTALL" -eq 1 ]]; then
    step "Installing full Desktop dependencies with native install scripts."
    echo "Warning: Full native install requires C/C++ build tools such as build-essential, python3, and make on Linux." >&2
    yarn_install "$PROJECT_ROOT" 0
  else
    step "Installing root dependencies for WebUI with native scripts disabled."
    yarn_install "$PROJECT_ROOT" 1

    step "Installing app dependencies for WebUI with native scripts disabled."
    yarn_install "$PROJECT_ROOT/app" 1
  fi
elif ! project_dependencies_present; then
  echo "Project dependencies are missing. Rerun without --skip-install." >&2
  exit 1
fi

if ! project_dependencies_present; then
  echo "Project dependencies are still incomplete after install. Check Yarn output for failed network steps, or rerun without --skip-install." >&2
  exit 1
fi

if [[ "$PRODUCTION" -eq 1 ]]; then
  step "Compiling WebUI production bundle."
  run yarn run compile:webui:prod
else
  step "Compiling WebUI development bundle."
  run yarn run compile:webui
fi

if [[ ! -f "$PROJECT_ROOT/out/web-server.js" ]]; then
  echo "WebUI server bundle was not produced: $PROJECT_ROOT/out/web-server.js" >&2
  exit 1
fi

if [[ "$NO_START" -eq 1 ]]; then
  step "Build completed. Skipping server start because --no-start was set."
  exit 0
fi

runtime_script="$PROJECT_ROOT/out/run-webui.sh"
if [[ ! -f "$runtime_script" ]]; then
  echo "WebUI runtime launcher was not produced: $runtime_script" >&2
  exit 1
fi

if [[ ! -x "$runtime_script" ]]; then
  chmod +x "$runtime_script" || true
fi

if [[ -z "$PUBLIC_URL" ]]; then
  PUBLIC_URL="$(default_public_url)"
fi

step "Starting GitDesk WebUI via out/run-webui.sh on $PUBLIC_URL"
run_args=(
  --host "$HOST_ADDRESS"
  --port "$PORT"
  --public-url "$PUBLIC_URL"
  --allowedRoot "$ALLOWED_ROOT"
)

if [[ -n "$GIT_PATH" ]]; then
  run_args+=(--git-path "$GIT_PATH")
fi

if [[ -n "$GIT_DIRECTORY" ]]; then
  run_args+=(--git-directory "$GIT_DIRECTORY")
fi

if [[ -n "$GIT_EXEC_PATH_ARG" ]]; then
  run_args+=(--git-exec-path "$GIT_EXEC_PATH_ARG")
fi

if [[ -n "$GIT_CONFIG_GLOBAL" ]]; then
  run_args+=(--git-config-global "$GIT_CONFIG_GLOBAL")
fi

if [[ -n "$DATA_DIR" ]]; then
  run_args+=(--data-dir "$DATA_DIR")
fi

if [[ -n "$STATIC_ROOT" ]]; then
  run_args+=(--static-root "$STATIC_ROOT")
fi

if [[ -n "$COPILOT_CLI_PATH" ]]; then
  run_args+=(--copilot-cli-path "$COPILOT_CLI_PATH")
fi

if [[ -n "$OAUTH_CLIENT_ID" ]]; then
  run_args+=(--oauth-client-id "$OAUTH_CLIENT_ID")
fi

if [[ -n "$OAUTH_CLIENT_SECRET" ]]; then
  run_args+=(--oauth-client-secret "$OAUTH_CLIENT_SECRET")
fi

if [[ -n "$OAUTH_CALLBACK_URL" ]]; then
  run_args+=(--oauth-callback-url "$OAUTH_CALLBACK_URL")
fi

run "$runtime_script" "${run_args[@]}"
