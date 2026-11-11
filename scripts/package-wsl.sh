#!/usr/bin/env bash
set -euo pipefail
SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
supported_node() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(process.platform === "linux" && (major > 22 || major === 22 && minor >= 12) ? 0 : 1);
  ' >/dev/null 2>&1
}

if test -n "${JAKUKYO_NODE_DIRECTORY:-}"; then
  if ! test -x "$JAKUKYO_NODE_DIRECTORY/node"; then
    printf 'WSL Node was not found in JAKUKYO_NODE_DIRECTORY: %s\n' "$JAKUKYO_NODE_DIRECTORY" >&2
    exit 1
  fi
  export PATH="$JAKUKYO_NODE_DIRECTORY:$PATH"
elif ! supported_node; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if test -s "$nvm_script"; then
    set +u
    . "$nvm_script" || true
    nvm use --silent node >/dev/null 2>&1 || true
    set -u
  fi
fi
if ! supported_node; then
  printf 'An installed Linux Node.js 22.12+ is required. Set JAKUKYO_NODE_DIRECTORY or select a supported PATH/NVM version.\n' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf 'npm was not found beside the selected Node.js installation.\n' >&2
  exit 1
fi
BUILD_ROOT="$SOURCE_ROOT/.wsl-build"
mkdir -p "$BUILD_ROOT" "$SOURCE_ROOT/release"
# Separate Linux node_modules from the Windows development checkout.
for item in src public desktop docs scripts; do
  if test -d "$SOURCE_ROOT/$item"; then
    if test "$BUILD_ROOT" != "$SOURCE_ROOT/.wsl-build"; then exit 1; fi
    rm -rf -- "$BUILD_ROOT/$item"
    mkdir -p "$BUILD_ROOT/$item"
    cp -a "$SOURCE_ROOT/$item/." "$BUILD_ROOT/$item/"
  fi
done
cp "$SOURCE_ROOT/package.json" "$SOURCE_ROOT/package-lock.json" "$SOURCE_ROOT/tsconfig.json" "$SOURCE_ROOT/vite.config.ts" "$SOURCE_ROOT/index.html" "$BUILD_ROOT/"
cd "$BUILD_ROOT"
if ! cmp -s package-lock.json .installed-lock.json || ! test -d node_modules; then
  npm ci --ignore-scripts --no-audit --no-fund
  cp package-lock.json .installed-lock.json
fi
node desktop/prepare-runtime.mjs
if test "${1:-}" = "--prepare-only"; then exit 0; fi
npm run build
export JAKUKYO_RELEASE_DIR="$SOURCE_ROOT/release"
node desktop/package-windows.mjs
