#!/usr/bin/env bash

set -euo pipefail

DELETE_SOURCE_MAPS=0
PRODUCTION=0
SKIP_INSTALL=0
FULL_NATIVE_INSTALL=0
SKIP_SYSTEM_PROXY=0
LOG_FILE="out/webui-deploy.log"
REQUIRED_NODE_MAJOR=20
PREFERRED_NODE_MAJOR=22

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: bash script/deploy-webui.sh [options]

Options:
  --delete-source-maps     Delete generated .map files after the build
  --production             Build production WebUI bundle
  --skip-install           Do not run yarn install; fail if local deps are missing
  --full-native-install    Run package install scripts for full Desktop native dependencies
  --skip-system-proxy      Do not auto-configure proxy variables during deploy
  --log-file <path>        Write full deploy output to a log file. Default: out/webui-deploy.log
  --no-log-file            Do not write a deploy log file
  -h, --help               Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --delete-source-maps|--delete-sourcemaps)
      DELETE_SOURCE_MAPS=1
      shift
      ;;
    --production)
      PRODUCTION=1
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
    --skip-system-proxy)
      SKIP_SYSTEM_PROXY=1
      shift
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

step() {
  printf '==> %s\n' "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [[ "$(id -u 2>/dev/null || echo 1)" == "0" ]]; then
    run "$@"
  elif command_exists sudo; then
    run sudo "$@"
  else
    run "$@"
  fi
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_proxy_url() {
  local proxy_value
  proxy_value="$(trim "$1")"
  [[ -n "$proxy_value" ]] || return 0

  case "$proxy_value" in
    *://*) printf '%s' "$proxy_value" ;;
    *) printf 'http://%s' "$proxy_value" ;;
  esac
}

set_proxy_environment() {
  local proxy_value
  proxy_value="$(normalize_proxy_url "$1")"
  [[ -n "$proxy_value" ]] || return 1

  [[ -n "${HTTP_PROXY:-}" ]] || HTTP_PROXY="$proxy_value"
  [[ -n "${HTTPS_PROXY:-}" ]] || HTTPS_PROXY="$proxy_value"
  [[ -n "${ALL_PROXY:-}" ]] || ALL_PROXY="$proxy_value"
  [[ -n "${http_proxy:-}" ]] || http_proxy="$proxy_value"
  [[ -n "${https_proxy:-}" ]] || https_proxy="$proxy_value"
  [[ -n "${all_proxy:-}" ]] || all_proxy="$proxy_value"
  NODE_USE_ENV_PROXY=1
  export HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NODE_USE_ENV_PROXY
  return 0
}

get_proxy_from_pac_url() {
  local pac_url="$1"
  local pac_content=""
  local proxy_value=""

  pac_url="$(trim "$pac_url")"
  [[ -n "$pac_url" ]] || return 0

  if command_exists curl; then
    pac_content="$(curl -fsSL --max-time 5 "$pac_url" 2>/dev/null || true)"
  elif command_exists wget; then
    pac_content="$(wget -qO- --timeout=5 "$pac_url" 2>/dev/null || true)"
  fi

  [[ -n "$pac_content" ]] || return 0
  proxy_value="$(
    printf '%s' "$pac_content" |
      grep -Eio '(PROXY|HTTPS?|SOCKS5?)[[:space:]]+[^;[:space:]]+:[0-9]+' |
      head -n 1 |
      awk '{print $2}' || true
  )"
  normalize_proxy_url "$proxy_value"
}

gsettings_value() {
  local value
  value="$(gsettings get "$1" "$2" 2>/dev/null || true)"
  printf '%s' "$value" | sed "s/^'//;s/'$//"
}

get_gsettings_proxy() {
  command_exists gsettings || return 0

  local proxy_mode
  proxy_mode="$(gsettings_value org.gnome.system.proxy mode)"
  case "$proxy_mode" in
    manual)
      local schema proxy_host proxy_port
      for schema in org.gnome.system.proxy.https org.gnome.system.proxy.http; do
        proxy_host="$(gsettings_value "$schema" host)"
        proxy_port="$(gsettings get "$schema" port 2>/dev/null || true)"
        proxy_port="$(printf '%s' "$proxy_port" | tr -dc '0-9')"
        if [[ -n "$proxy_host" && -n "$proxy_port" && "$proxy_port" -gt 0 ]]; then
          normalize_proxy_url "$proxy_host:$proxy_port"
          return 0
        fi
      done
      ;;
    auto)
      get_proxy_from_pac_url "$(gsettings_value org.gnome.system.proxy autoconfig-url)"
      return 0
      ;;
  esac
}

get_kde_proxy() {
  local kde_proxy_file="${XDG_CONFIG_HOME:-$HOME/.config}/kioslaverc"
  local proxy_value

  [[ -f "$kde_proxy_file" ]] || return 0
  proxy_value="$(
    awk -F= 'BEGIN{section=0} /^\[Proxy Settings\]/{section=1; next} /^\[/{section=0} section && ($1=="httpsProxy" || $1=="httpProxy") {print $2; exit}' "$kde_proxy_file"
  )"
  normalize_proxy_url "$proxy_value"
}

initialize_proxy_environment() {
  local existing_proxy="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-${ALL_PROXY:-${all_proxy:-}}}}}}"
  local system_proxy=""

  if [[ -n "$existing_proxy" ]]; then
    if set_proxy_environment "$existing_proxy"; then
      step "Using existing proxy environment for Node/Copilot: $(normalize_proxy_url "$existing_proxy")"
    fi
    return 0
  fi

  system_proxy="$(get_gsettings_proxy)"
  [[ -n "$system_proxy" ]] || system_proxy="$(get_kde_proxy)"

  if set_proxy_environment "$system_proxy"; then
    step "Detected system proxy for Node/Copilot: $system_proxy"
  fi
}

run() {
  "$@"
}

install_node() {
  step "Installing Node.js ${PREFERRED_NODE_MAJOR} LTS for GitDesk WebUI."

  if command_exists pkg; then
    run pkg install -y nodejs-lts || run pkg install -y nodejs
  elif command_exists apt-get; then
    if command_exists curl; then
      run_as_root sh -c "curl -fsSL https://deb.nodesource.com/setup_${PREFERRED_NODE_MAJOR}.x | bash -"
    elif command_exists wget; then
      run_as_root sh -c "wget -qO- https://deb.nodesource.com/setup_${PREFERRED_NODE_MAJOR}.x | bash -"
    fi
    run_as_root apt-get update
    run_as_root apt-get install -y nodejs
  elif command_exists dnf; then
    if command_exists curl; then
      run_as_root sh -c "curl -fsSL https://rpm.nodesource.com/setup_${PREFERRED_NODE_MAJOR}.x | bash -"
    fi
    run_as_root dnf install -y nodejs npm
  elif command_exists yum; then
    if command_exists curl; then
      run_as_root sh -c "curl -fsSL https://rpm.nodesource.com/setup_${PREFERRED_NODE_MAJOR}.x | bash -"
    fi
    run_as_root yum install -y nodejs npm
  elif command_exists pacman; then
    run_as_root pacman -Sy --noconfirm nodejs npm
  elif command_exists zypper; then
    run_as_root zypper install -y nodejs npm
  elif command_exists apk; then
    run_as_root apk add nodejs-current npm || run_as_root apk add nodejs npm
  else
    echo "Node.js ${REQUIRED_NODE_MAJOR} or newer is required. Install Node.js ${PREFERRED_NODE_MAJOR} LTS, then rerun this script." >&2
    exit 1
  fi

  hash -r 2>/dev/null || true
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

  if [[ "$node_major" -lt "$REQUIRED_NODE_MAJOR" ]]; then
    install_node
    node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
    node_platform="$(node -p "process.platform")"
    node_arch="$(node -p "process.arch")"
    step "Node.js version after install: $(node -v)"
    step "Node.js platform/arch after install: $node_platform/$node_arch"
  fi

  if [[ "$node_major" -lt "$REQUIRED_NODE_MAJOR" ]]; then
    echo "Node.js ${REQUIRED_NODE_MAJOR} or newer is required. Node.js ${PREFERRED_NODE_MAJOR} LTS is recommended for WebUI testing." >&2
    exit 1
  fi

  if [[ "$node_major" -gt "$PREFERRED_NODE_MAJOR" ]]; then
    echo "Warning: Node.js ${PREFERRED_NODE_MAJOR} LTS is recommended. Newer versions such as Node.js $node_major may expose dependency compatibility issues." >&2
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
    -d "$PROJECT_ROOT/app/node_modules/@codemirror/view" &&
    -d "$PROJECT_ROOT/app/node_modules/@codemirror/state" &&
    -d "$PROJECT_ROOT/app/node_modules/@github/copilot"
  ]]
}

yarn_install() {
  local directory="$1"
  local ignore_scripts="$2"
  local ignore_platform="$3"
  local args=(install --network-timeout 600000)

  if [[ "$ignore_scripts" -eq 1 ]]; then
    args+=(--ignore-scripts)
  fi

  if [[ "$ignore_platform" -eq 1 ]]; then
    args+=(--ignore-platform)
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
if [[ -n "$LOG_FILE" ]]; then
  step "Detailed WebUI build log: $WEBUI_BUILD_LOG"
  step "Detailed WebUI diagnostics log: $WEBUI_DIAGNOSTICS_LOG"
  step "Detailed WebUI diagnostics JSON: $WEBUI_DIAGNOSTICS_JSON"
fi

if [[ "$SKIP_SYSTEM_PROXY" -eq 1 ]]; then
  step "Skipping system proxy auto-configuration for Node/Copilot."
else
  initialize_proxy_environment
fi
ensure_node
YARN_IGNORE_PLATFORM=1
export WEBUI_DELETE_SOURCE_MAPS="$DELETE_SOURCE_MAPS"
step "Target platform: all supported WebUI runtimes"
step "Delete source maps: $([[ "$DELETE_SOURCE_MAPS" -eq 1 ]] && printf yes || printf no)"
ensure_yarn

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  step "Yarn optional dependency platform/CPU exclusion messages are expected; Yarn is selecting packages for the current architecture."

  if [[ "$FULL_NATIVE_INSTALL" -eq 1 ]]; then
    step "Installing full Desktop dependencies with native install scripts."
    echo "Warning: Full native install requires C/C++ build tools such as build-essential, python3, and make on Linux." >&2
    yarn_install "$PROJECT_ROOT" 0 "$YARN_IGNORE_PLATFORM"
  else
    step "Installing root dependencies for WebUI with native scripts disabled."
    yarn_install "$PROJECT_ROOT" 1 "$YARN_IGNORE_PLATFORM"

    step "Installing app dependencies for WebUI with native scripts disabled."
    yarn_install "$PROJECT_ROOT/app" 1 "$YARN_IGNORE_PLATFORM"
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

if [[ ! -f "$PROJECT_ROOT/out/run-webui.sh" ]]; then
  echo "WebUI runtime launcher was not produced: $PROJECT_ROOT/out/run-webui.sh" >&2
  exit 1
fi

if [[ ! -x "$PROJECT_ROOT/out/run-webui.sh" ]]; then
  chmod +x "$PROJECT_ROOT/out/run-webui.sh" || true
fi

step "WebUI build completed. Configure out/server.conf, then start with out/run-webui.sh."
