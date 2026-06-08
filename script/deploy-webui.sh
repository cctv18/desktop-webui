#!/usr/bin/env bash

set -euo pipefail

HOST_ADDRESS="127.0.0.1"
PORT="8080"
ALLOWED_ROOT=""
PRODUCTION=0
NO_START=0
SKIP_INSTALL=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: bash script/deploy-webui.sh [options]

Options:
  --host <host>            Host to bind. Default: 127.0.0.1
  --port <port>            Port to bind. Default: 8080
  --allowed-root <path>    Filesystem root WebUI may access. Default: project root
  --production             Build production WebUI bundle
  --no-start               Install and compile only
  --skip-install           Do not run yarn install; fail if local deps are missing
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
  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
  step "Node.js version: $(node -v)"

  if [[ "$node_major" -lt 18 ]]; then
    echo "Node.js 18 or newer is required. Node.js 22 LTS is recommended for WebUI testing." >&2
    exit 1
  fi

  if [[ "$node_major" -gt 22 ]]; then
    echo "Warning: Node.js 22 LTS is recommended. Newer versions such as Node.js $node_major may expose dependency compatibility issues." >&2
  fi
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
  [[ -d "$PROJECT_ROOT/node_modules/ts-node" && -d "$PROJECT_ROOT/node_modules/webpack" ]]
}

cd "$PROJECT_ROOT"

step "Project root: $PROJECT_ROOT"
step "Allowed root: $ALLOWED_ROOT"

ensure_node
ensure_yarn

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  step "Installing project dependencies with Yarn."
  run yarn install --network-timeout 600000
elif ! project_dependencies_present; then
  echo "Project dependencies are missing. Rerun without --skip-install." >&2
  exit 1
fi

if ! project_dependencies_present; then
  echo "Project dependencies are still incomplete after install. Check Yarn output for failed native or network steps." >&2
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

step "Starting GitDesk WebUI on http://$HOST_ADDRESS:$PORT"
run node out/web-server.js --host "$HOST_ADDRESS" --port "$PORT" --allowedRoot "$ALLOWED_ROOT"
