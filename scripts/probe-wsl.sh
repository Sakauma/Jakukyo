#!/usr/bin/env bash
set -u
export PATH="/home/sakauma/.nvm/versions/node/v22.20.0/bin:$PATH"
printf 'Node: '; node --version
printf 'npm: '; npm --version
for bin in cargo rustc gcc g++ cmake wine wine64 makensis dpkg-deb zip 7z; do
  command -v "$bin" || true
done
for dir in "$HOME/.cache/electron" "$HOME/.cache/electron-builder" "$HOME/.cargo/bin" /usr/bin/x86_64-w64-mingw32-gcc; do
  if test -e "$dir"; then ls -ld "$dir"; fi
done
