#!/usr/bin/env bash
# Desktop Widget uninstaller for desktop-widget@samvivan
set -euo pipefail

EXT="desktop-widget@samvivan"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXT}"
SCHEMA="org.gnome.shell.extensions.desktop-widget"
DCONF_PATH="/org/gnome/shell/extensions/desktop-widget/"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/desktop-widget"

usage() {
  cat <<EOF
Usage: uninstall.sh [options]
  --purge       Also remove saved settings and the Immich thumbnail cache
  -h, --help    Show help

Uninstalls the Desktop Widget extension ($EXT).
EOF
}

purge=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) purge=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$EXT" 2>/dev/null || true
fi

if [[ -d "$EXT_DIR" ]]; then
  rm -rf "$EXT_DIR"
  echo "Removed $EXT_DIR"
else
  echo "Extension directory not found (already uninstalled): $EXT_DIR"
fi

if (( purge )); then
  if command -v dconf >/dev/null 2>&1; then
    dconf reset -f "$DCONF_PATH" 2>/dev/null || true
    echo "Reset settings: $DCONF_PATH"
  fi

  if [[ -d "$CACHE_DIR" ]]; then
    rm -rf "$CACHE_DIR"
    echo "Removed cache: $CACHE_DIR"
  fi
else
  echo "Saved settings and cache kept. Use --purge to remove them too."
fi

echo "--- Done ---"
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  echo "On Wayland, logout/login to fully remove it from GNOME Shell."
else
  echo "On X11, try: Alt+F2 → 'r' → Enter (or logout/login)."
fi
