#!/usr/bin/env bash
set -euo pipefail
SOURCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_DIRECTORY="${JAKUKYO_NODE_DIRECTORY:-/home/sakauma/.nvm/versions/node/v22.20.0/bin}"
if ! test -x "$NODE_DIRECTORY/node"; then
  printf 'Existing WSL Node not found: %s\nSet JAKUKYO_NODE_DIRECTORY to an installed Node 22.12+ directory.\n' "$NODE_DIRECTORY" >&2
  exit 1
fi
export PATH="$NODE_DIRECTORY:$PATH"
BUILD_ROOT="$SOURCE_ROOT/.wsl-build"
mkdir -p "$BUILD_ROOT" "$SOURCE_ROOT/release"
# Separate Linux node_modules from the Windows development checkout.
for item in src public desktop docs; do
  if test -d "$SOURCE_ROOT/$item"; then
    if test "$BUILD_ROOT" != "$SOURCE_ROOT/.wsl-build"; then exit 1; fi
    rm -rf -- "$BUILD_ROOT/$item"
    mkdir -p "$BUILD_ROOT/$item"
    cp -a "$SOURCE_ROOT/$item/." "$BUILD_ROOT/$item/"
  fi
done
cp "$SOURCE_ROOT/package.json" "$SOURCE_ROOT/package-lock.json" "$SOURCE_ROOT/tsconfig.json" "$SOURCE_ROOT/vite.config.ts" "$SOURCE_ROOT/index.html" "$SOURCE_ROOT/THIRD_PARTY_NOTICES.md" "$BUILD_ROOT/"
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
