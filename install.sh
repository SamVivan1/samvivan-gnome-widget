#!/usr/bin/env bash
# Desktop Widget installer for desktop-widget@samvivan
set -euo pipefail

EXT="desktop-widget@samvivan"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXT}"
REPO="SamVivan1/samvivan-gnome-widget"
BRANCH="main"
ZIP="${EXT}.shell-extension.zip"

usage() {
  cat <<EOF
Usage: install.sh [options]
  --uninstall   Uninstall extension
  --branch BR   Use different branch (default: main)
  --force       Reinstall even if exists
  -h, --help    Show help
EOF
}

uninstall_mode=0
force=0
branch="$BRANCH"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) uninstall_mode=1; shift ;;
    --branch) branch="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

if (( uninstall_mode )); then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" && pwd)"
  if [[ -x "$script_dir/uninstall.sh" ]]; then
    exec "$script_dir/uninstall.sh"
  fi
  if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$EXT" 2>/dev/null || true
  fi
  rm -rf "$EXT_DIR"
  echo "Uninstalled $EXT from $EXT_DIR"
  exit 0
fi

if [[ -d "$EXT_DIR" && $force -eq 0 ]]; then
  echo "Extension already installed: $EXT_DIR"
  echo "Run with --force to reinstall, or --uninstall to remove."
  exit 0
fi

if [[ -f "metadata.json" && -f "extension.js" && -d "widgets" ]]; then
  echo "Using local repo as source..."
  SRCDIR="$(pwd)"
else
  echo "Downloading from https://github.com/${REPO}/archive/refs/heads/${branch}.zip"
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  curl -fsSL "https://github.com/${REPO}/archive/refs/heads/${branch}.zip" -o "$TMPDIR/repo.zip"
  unzip -q "$TMPDIR/repo.zip" -d "$TMPDIR"
  SRCDIR=$(find "$TMPDIR" -maxdepth 1 -type d -name "*samvivan-gnome-widget*")
fi

rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
rsync -a --exclude=".git" --exclude="screenshots" --exclude="docs" --exclude="build" --exclude="*.zip" "$SRCDIR/" "$EXT_DIR/"

if command -v glib-compile-schemas >/dev/null 2>&1; then
  glib-compile-schemas "$EXT_DIR/schemas/" || true
fi

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$EXT" 2>/dev/null || true
  gnome-extensions enable "$EXT" 2>/dev/null || true
  echo "gnome-extensions enabled $EXT"
fi

echo "--- Done ---"
echo "Installed to: $EXT_DIR"
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  echo "On Wayland, logout/login is required for GNOME Shell to load the new extension."
else
  echo "On X11, try: Alt+F2 → 'r' → Enter (or logout/login)."
fi
