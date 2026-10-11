EXTUUID := desktop-widget@samvivan
PREFIX  := $(HOME)/.local/share/gnome-shell/extensions/$(EXTUUID)
GETTEXT_DOMAIN := desktop-widget
POT := po/$(GETTEXT_DOMAIN).pot
XGETTEXT_FLAGS = --language=JavaScript --keyword=_ --from-code=UTF-8 \
	--package-name="Desktop Widget" --package-version=1.0.0 \
	--copyright-holder="desktop-widget@samvivan"

.PHONY: check
check:
	@bash scripts/check.sh

.PHONY: test
test:
	@node --test tests/*.test.mjs

.PHONY: pot
pot:
	@command -v xgettext >/dev/null 2>&1 || { echo "xgettext not found (install gettext)"; exit 1; }
	@xgettext $(XGETTEXT_FLAGS) -o po/desktop-widget.pot $(shell grep -v '^#' po/POTFILES.in)
	@echo "Wrote po/desktop-widget.pot"

.PHONY: update-po
update-po: pot
	@for po in po/*.po; do \
		command -v msgmerge >/dev/null 2>&1 || { echo "msgmerge not found (install gettext)"; exit 1; }; \
		msgmerge --quiet --update "$$po" po/desktop-widget.pot; \
	done
	@echo "Updated po/*.po"

.PHONY: translations
translations:
	@command -v msgfmt >/dev/null 2>&1 || { echo "msgfmt not found (install gettext)"; exit 1; }
	@for po in po/*.po; do \
		lang=$$(basename "$$po" .po); \
		mkdir -p "locale/$$lang/LC_MESSAGES"; \
		msgfmt -c -o "locale/$$lang/LC_MESSAGES/desktop-widget.mo" "$$po"; \
	done
	@echo "Compiled translations into locale/"

.PHONY: clean-translations
clean-translations:
	@rm -rf locale


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
