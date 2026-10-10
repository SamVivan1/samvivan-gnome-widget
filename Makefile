EXTUUID := desktop-widget@samvivan
PREFIX  := $(HOME)/.local/share/gnome-shell/extensions/$(EXTUUID)

.PHONY: check
check:
	@bash scripts/check.sh

.PHONY: clean
clean:
	rm -rf build *.zip

.PHONY: pack
pack: clean check
	@python3 scripts/pack.py $(CURDIR)

.PHONY: install
install: pack
	@rm -rf $(PREFIX)
	@mkdir -p $(PREFIX)
	@unzip -q $(EXTUUID).shell-extension.zip -d $(PREFIX)/..
	@if command -v glib-compile-schemas >/dev/null 2>&1; then glib-compile-schemas $(PREFIX)/schemas/; fi
	@command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions enable $(EXTUUID) 2>/dev/null || true
	@echo "Installed to $(PREFIX). If on Wayland, logout/login to load changes."

.PHONY: uninstall
uninstall:
	@command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions disable $(EXTUUID) 2>/dev/null || true
	@rm -rf $(PREFIX)
	@echo "Uninstalled $(EXTUUID)"

.PHONY: enable
enable:
	@command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions enable $(EXTUUID)

.PHONY: disable
disable:
	@command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions disable $(EXTUUID)

.PHONY: prefs
prefs:
	@command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions prefs $(EXTUUID) || true
