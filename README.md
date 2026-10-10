# Desktop Widget for GNOME Shell

[![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-50-e67e22.svg)](#requirements) [![License: Unlicense](https://img.shields.io/badge/license-Unlicense-green.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/SamVivan1/samvivan-gnome-widget)](https://github.com/SamVivan1/samvivan-gnome-widget/releases)

A lightweight desktop widget suite for GNOME Shell 50. Forked from `widgets@distro.com`, it lives directly on your desktop layer with full drag/resize controls and a comprehensive settings panel.

![Desktop Widget preview](docs/screenshot-desktop.png)

## Features

- **Clock** – Clean digital time display
- **Calendar** – Month view at a glance, with a dot under every day that has events (1–3 dots, bar for more)
- **Agenda** – Today's schedule and the upcoming week from your Evolution/Online Accounts calendars, with public holidays highlighted. Resize it to show more or fewer days.
- **Weather** – Uses GNOME Weather locations
- **Photos** – Rotate local images or random photos from your Immich library, with automatic fallback. Supports all photos, favorites-only, or a specific album. Configurable interval and image quality.
- **Battery** – System battery + GSConnect phone battery (when available). Devices pop and slide in/out as they connect or disconnect (respects GNOME reduce-motion).
- **Placement** – Drag, resize, snap-to-grid, configurable grid gap, multi-monitor support (`-1` = primary)
- **Behavior** – Edit/Lock/Hide-all modes, widget opacity (10–100%), optional top-panel icon
- **Panel menu** – Quick toggle/edit/add/reset widgets from the top bar

## Requirements

- GNOME Shell 50
- `glib-compile-schemas` (usually present on Linux distros with GNOME)
- For Immich: a running Immich server + API key
- For Calendar/Agenda events: `python3-gi` and the Evolution Data Server introspection packages (see below). Without them the widgets still work but only as a plain month view / empty agenda.

### Calendar data (optional)

Installing these enables events from GNOME Calendar, Evolution, and online accounts
(Google/Microsoft 365):

```bash
sudo apt install python3-gi gir1.2-ecal-2.0 gir1.2-edataserver-1.2 gir1.2-ical-3.0
```

Events are read through a small helper process (`tools/eds_events.py`). A separate
process is used on purpose: importing Evolution Data Server inside GNOME Shell
crashes the shell when those objects are freed.

## Installation

### 1) One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/SamVivan1/samvivan-gnome-widget/main/install.sh | bash
```

Options:
- `--force` to reinstall over an existing install
- `--uninstall` to remove it
- `--branch <name>` to install from a different branch

### 2) From GitHub Release (.zip)

Download the latest `desktop-widget@samvivan.shell-extension.zip` from [Releases](https://github.com/SamVivan1/samvivan-gnome-widget/releases), then run:

```bash
gnome-extensions install --force desktop-widget@samvivan.shell-extension.zip
gnome-extensions enable desktop-widget@samvivan
```

### 3) From source (Makefile)

```bash
git clone https://github.com/SamVivan1/samvivan-gnome-widget.git
cd samvivan-gnome-widget
make install
```

### After installation (Wayland)

GNOME Shell on Wayland does not support `Alt+F2 → r`. **Log out and back in** after installing/enabling. After login, open the panel menu → Desktop Widget to add widgets or edit them.

## Usage

1. Log out/in after install
2. Panel menu (top bar → Desktop Widget) → `Add <Widget>` to add widgets
3. Enable `Edit Widgets` to drag and resize
4. `Lock Widgets` to prevent accidental moves/resizes
5. `Hide All Widgets` to temporarily hide everything without losing layout
6. `Reset Default Widgets` to restore defaults

## Preferences

Open preferences via: `gnome-extensions prefs desktop-widget@samvivan` or panel menu → Desktop Widget → (gear/extension settings if available).

### General
- **Monitor** – target monitor (-1 = primary)
- **Grid size** – snap grid while dragging (1–200 px)
- **Widget gap** – spacing from edges (0–200 px)
- **Snap to grid** – toggle
- **Edit/Lock/Hide all/Opacity** – behavior
- **Show panel icon** – toggle top panel button

### Photos
- **Photo source** – `Immich + local (fallback)`, `Immich only`, `Local only`
- **Change interval (minutes)** – 1–1440 minutes (default 30)
- **Immich** – Server URL, API key, scope (`All photos`, `Favorites only`, `Specific album`), album dropdown, image quality (`Preview` recommended / `Thumbnail` / `Full size`)

### Widgets
- Per-widget visibility, X/Y, Width/Height
- Reset to default layout

## Immich Setup

1. Open Immich → Account Settings → API Keys → Create API Key (with read access)
2. In Preferences → Photos, set Server URL (e.g. `https://immich.example.com`)
3. Paste the API key (stored in dconf as plain text per-user on this system)
4. Choose scope: `all` / `favorites` / `album` (album dropdown loads automatically)
5. Set image quality and interval
6. Thumbnails are cached to `~/.cache/desktop-widget/immich/<hash>/` and pruned automatically

## Settings keys (reference)

| Key | Type | Default | Description |
|---|---|---|---|
| `layout-json` | `s` | `''` | Serialized widget layout (JSON) |
| `monitor-index` | `i` | `-1` | Target monitor |
| `grid-size` | `i` | `20` | Snap grid size (px) |
| `widget-gap` | `i` | `14` | Edge spacing (px) |
| `snap-to-grid` | `b` | `true` | Snap while dragging |
| `lock-widgets` | `b` | `false` | Disable drag/resize |
| `hide-all` | `b` | `false` | Temporarily hide all |
| `edit-mode` | `b` | `false` | Show edit controls |
| `widget-opacity` | `i` | `100` | Opacity 10–100% |
| `show-panel-icon` | `b` | `true` | Show top panel icon |
| `photos-source` | `s` | `'mixed'` | `local`/`immich`/`mixed` |
| `photo-interval` | `i` | `1800` | Seconds between image changes |
| `immich-server-url` | `s` | `''` | Immich base URL |
| `immich-api-key` | `s` | `''` | Immich API key |
| `immich-scope` | `s` | `'all'` | `all`/`favorites`/`album` |
| `immich-album-id` | `s` | `''` | Album ID when scope=album |
| `immich-size` | `s` | `'preview'` | `thumbnail`/`preview`/`fullsize` |
| `calendar-sources` | `as` | `[]` | EDS calendar UIDs to show (empty = all enabled) |

## Uninstall

### 1) One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/SamVivan1/samvivan-gnome-widget/main/uninstall.sh | bash
```

This removes the extension directory and disables it. Your saved settings and the Immich thumbnail cache are kept. To remove those too, add `--purge`:

```bash
curl -fsSL https://raw.githubusercontent.com/SamVivan1/samvivan-gnome-widget/main/uninstall.sh | bash -s -- --purge
```

### 2) Other ways

```bash
# via the installer's flag
curl -fsSL https://raw.githubusercontent.com/SamVivan1/samvivan-gnome-widget/main/install.sh | bash -s -- --uninstall

# from a local checkout
make uninstall      # removes the extension
./uninstall.sh --purge   # removes extension + settings + cache
```

> On Wayland, **log out and back in** after uninstalling so GNOME Shell drops the extension.

## Troubleshooting

- **Widgets don't appear after install**: Wayland requires logout/login. Also check `gnome-extensions list --enabled`.
- **Photos stay same / don't rotate**: Check interval and source in Preferences → Photos. For Immich, verify URL/API key reachability.
- **Immich shows "Album list unavailable"**: Server URL or API key wrong; check network/firewall. Albums load with 600ms debounce after changes.
- **Extension crashes at enable**: Try disabling, clearing layout? If needed, reset via panel menu or clear `layout-json` in dconf (advanced).
- **Live reload on Wayland**: `Alt+F2 → r` is disabled; logout/login is the safe way.

## Development

### Structure
```
.
├── install.sh            # one-liner installer
├── uninstall.sh          # one-liner uninstaller (--purge to wipe data)
├── Makefile              # make check/install/uninstall/pack
├── scripts/              # check.sh (ESM parse) + pack.py (build release zip)
├── extension.js          # GNOME Shell entry, layout/drag/resize, panel menu
├── prefs.js              # libadwaita preferences UI
├── metadata.json         # Extension metadata
├── logger.js             # Logging helpers
├── stylesheet.css        # Global styles
├── schemas/              # GSettings schema
├── lib/
│   └── calendarData.js   # runs tools/eds_events.py, caches + refreshes events
├── tools/
│   └── eds_events.py     # EDS -> JSON helper (separate process, avoids shell crash)
├── widgets/
│   ├── clock/            # type/label/stylesheet/defaultSize + render/cleanup/style
│   ├── calendar/         # month view + event dots
│   ├── agenda/           # today + upcoming events
│   ├── weather/
│   ├── photos/           # rotation + Immich + local sources
│   └── battery/          # system + GSConnect
└── workspaceIntegration.js
```

### Widget module contract
Each widget module must export:
- `export const type = '...'`
- `export const label = '...'`
- `export const stylesheet = 'widgets/<type>/stylesheet.css'`
- `export const defaultSize = 'small'|'medium'|'large'`

And provide:
- `export function style()` (optional)
- `export function render({ ...settings })` – returns a `Clutter.Actor`/container
- `export function reconcile({ ...settings, animate })` (optional) – takes precedence over `render` for in-place updates without clearing the body; set `animate` to `false` for instant changes
- `export function cleanup(actor)` (optional)

### Adding a widget
1. Create `widgets/mywidget/{widget.js,stylesheet.css}`
2. Implement the contract above
3. Add default size to layout/extension defaults if desired
4. Add prefs entry if needed
5. `make check && make install` (or sync + logout/login)

### Testing (nested headless shell)
```bash
mkdir -p /tmp/opencode/xrt && chmod 700 /tmp/opencode/xrt
XDG_RUNTIME_DIR=/tmp/opencode/xrt dbus-run-session -- gnome-shell --headless 2>&1 | tail -30
```
(Useful to catch JS errors without breaking your live session.)

## Credits

- Forked from [`widgets@distro.com`](https://extensions.gnome.org/extension/6081/widgets/) — original concept and structure
- Immich integration, Photos rotation/fallback, GSConnect phone battery, prefs, and polish by `desktop-widget@samvivan`

## License

This is free and unencumbered software released into the public domain (see [LICENSE](LICENSE)).
