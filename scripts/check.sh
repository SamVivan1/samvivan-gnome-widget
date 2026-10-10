#!/usr/bin/env bash
# ESM parse check for all tracked .js files.
# GNOME Shell loads extensions as ES modules, but `node --check` treats a .js
# file as CommonJS and may pass invalid ESM. Copying to .mjs forces ESM parsing.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "ESM parse check..."

if ! command -v node >/dev/null 2>&1; then
  echo "node not found; skipping ESM parse check"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

status=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  dst="$tmp/$(basename "$f" .js).mjs"
  cp "$f" "$dst"
  if ! node --check "$dst" >/dev/null 2>&1; then
    echo "FAIL: $f"
    status=1
  fi
done < <(git ls-files "*.js")

if [ "$status" -eq 0 ]; then
  echo "ESM parse check passed"
fi
exit "$status"
