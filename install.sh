#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="ix-memory"
SKIP_BUILD=false
UNINSTALL=false

usage() {
  cat <<'EOF'
ix-openclaw-plugin installer

Usage:
  ./install.sh
  ./install.sh --skip-build
  ./install.sh --uninstall

Options:
  --skip-build   Skip `npm install` and `npm run build`
  --uninstall    Remove the installed plugin and exit
  --help         Show this message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --help|-h)
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

need_cmd() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd not found. $hint" >&2
    exit 1
  fi
}

need_cmd openclaw "Install OpenClaw first."

if [[ "$UNINSTALL" == true ]]; then
  openclaw plugins uninstall "$PLUGIN_ID" >/dev/null 2>&1 || true
  echo "Uninstalled $PLUGIN_ID"
  exit 0
fi

need_cmd npm "Install Node.js and npm first."

if [[ "$SKIP_BUILD" != true ]]; then
  npm install --prefix "$REPO_DIR"
  npm run build --prefix "$REPO_DIR"
fi

openclaw plugins uninstall "$PLUGIN_ID" >/dev/null 2>&1 || true
openclaw plugins install -l "$REPO_DIR"

echo "Installed $PLUGIN_ID from $REPO_DIR"
