# Contributing to Desktop Widget

Thanks for wanting to make Desktop Widget better! This project welcomes bug
reports, translations, new widgets, and general improvements.

## Quick links

- Issues: https://github.com/SamVivan1/samvivan-gnome-widget/issues
- Discussions / ideas: open an issue with the `enhancement` label
- License: [Unlicense](LICENSE) (public domain) — by contributing you agree
  your work is released under the same terms

## Reporting bugs

Use the **Bug report** issue template and include:

- GNOME Shell version (`gnome-shell --version`) and distro
- Extension version (release tag or commit)
- Steps to reproduce, what you expected, what happened instead
- Relevant settings (Photos source, Bambu bridge configured, lyrics on/off)
- Logs, if available: `journalctl -b /usr/bin/gnome-shell | grep desktop-widget`

Please check existing issues first — duplicates are closed to keep the
tracker useful.

## Suggesting features

Use the **Feature request** template. New widget ideas are welcome, but keep
in mind every widget must follow the [widget module contract](#adding-a-widget)
and work headless-safe (no hard dependency on external services at enable time).

## Development setup

```bash
git clone https://github.com/SamVivan1/samvivan-gnome-widget.git
cd samvivan-gnome-widget
make install   # installs to ~/.local/share/gnome-shell/extensions, then log out/in
```

On Wayland there is no `Alt+F2 → r`; log out and back in after every install.
The running shell keeps the previously loaded code, so always re-install
and re-login before testing live — otherwise you validate code the live
session never sees.
Useful checks (also run in CI):

```bash
make check        # ESM parse check for every tracked .js file
make test         # node --test tests/*.test.mjs (pure logic, no gi needed)
glib-compile-schemas schemas/
```

A nested headless shell catches JS errors without breaking your live session:

```bash
mkdir -p /tmp/dwtest/xrt && chmod 700 /tmp/dwtest/xrt
XDG_RUNTIME_DIR=/tmp/dwtest/xrt dbus-run-session -- gnome-shell --headless 2>&1 | tail -30
```

## Code style

- ES modules (`import`/`export`), no `Lang`, no `Mainloop`
- Match the surrounding file (2-space indent in most files, tabs in `lib/`)
- Keep GNOME Shell–only code (gi imports, `resource:///` imports) out of the
  pure-logic helpers in `lib/` so they stay covered by `node --test`
- No `console.log` leftovers — use `warn(key, message)` from `logger.js`
- User-visible strings must be wrapped in `_('...')` (see Translations)

## Adding a widget

1. Create `widgets/mywidget/{widget.js,stylesheet.css}`
2. Implement the contract:
   - `export const type = '...'`
   - `export function label()` — returns the translated display name, e.g.
     ``return _('My Widget');`` (a function, not a const, so gettext runs at
     display time rather than at module import time)
   - `export const stylesheet = 'widgets/<type>/stylesheet.css'`
   - `export const defaultSize = 'small'|'medium'|'large'`
   - `export function render({ ...settings })`, optional `reconcile()` and `cleanup()`
3. Register the module in `extension.js` (`WIDGET_MODULES`) and add defaults
4. Add a preferences section in `prefs.js` if it needs settings
5. Add schema keys with `<summary>`/`<description>` if it needs GSettings
6. `make check && make test`, then test in the headless shell

## Translations

UI strings use gettext with domain `desktop-widget`:

- Wrap user-visible strings: `_('Hello')`, compositions as
  `_('Add %s').format(name)` — never translate at module top level
  (module-level code runs before gettext is bound; always translate inside
  functions)
- Do **not** wrap: log messages, CSS classes, icon names, GSettings keys,
  D-Bus names, URLs, or runtime data (`error.message`, device names)
- After adding/changing strings (requires `gettext` installed):

```bash
make pot          # regenerate po/desktop-widget.pot
make update-po    # merge into po/*.po
make translations # compile locale/*/LC_MESSAGES/*.mo (needed for testing)
```

- To start a new language: copy `po/id.po` to `po/<lang>.po`, fill in
  `msgstr` entries, add `<lang>` to `po/LINGUAS`, and run `make translations`
- Translation-only PRs are welcome any time — no code changes required

## Releases (maintainers)

- Every upload to extensions.gnome.org must bump `version` in `metadata.json`
- Tag `vX.Y.Z` → the Release workflow builds translations, packs the
  extension zip, and attaches it to the GitHub release
- Never commit generated files: `schemas/gschemas.compiled`, `locale/`,
  `build/`, `*.zip`
