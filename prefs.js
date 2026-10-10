import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Immich from './widgets/photos/immich.js';

const LAYOUT_KEY = 'layout-json';

const WIDGET_LABELS = {
  clock: 'Clock',
  calendar: 'Calendar',
  weather: 'Weather',
  photos: 'Photos',
  battery: 'Battery',
};

function widgetLabel(type) {
  return WIDGET_LABELS[type] ?? type;
};

function readLayout(settings) {
  try {
    const parsed = JSON.parse(settings.get_string(LAYOUT_KEY));

    if (parsed && Array.isArray(parsed.widgets)) {
      return parsed;
    };
  } catch (error) {
    // ignore malformed layout, fall back to empty
  };

  return {widgets: []};
};

function monitorChoices(display) {
  const choices = [{index: -1, label: 'Primary monitor'}];

  if (display) {
    const monitors = display.get_monitors();
    const count = monitors.get_n_items();

    for (let i = 0; i < count; i++) {
      const monitor = monitors.get_item(i);
      const geometry = monitor.get_geometry();
      const connector = monitor.get_connector?.() ?? `Monitor ${i + 1}`;

      choices.push({
        index: i,
        label: `${connector} (${geometry.width}×${geometry.height})`,
      });
    };
  };

  return choices;
};

export default class DesktopWidgetPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    this._window = window;
    this._settings = this.getSettings();
    this._layout = readLayout(this._settings);

    window.add(this._buildGeneralPage(window));
    window.add(this._buildPhotosPage());
    window.add(this._buildWidgetsPage());
  };

  _buildGeneralPage(window) {
    const page = new Adw.PreferencesPage({
      name: 'general',
      title: 'General',
      icon_name: 'emblem-system-symbolic',
    });

    const placement = new Adw.PreferencesGroup({
      title: 'Placement',
      description: 'Where the widgets live and how they are positioned.',
    });

    const choices = monitorChoices(window.get_display());
    const labels = choices.map(choice => choice.label);
    const monitorRow = new Adw.ComboRow({
      title: 'Monitor',
      model: Gtk.StringList.new(labels),
    });
    const currentIndex = this._settings.get_int('monitor-index');
    const selected = Math.max(0, choices.findIndex(choice => choice.index === currentIndex));
    monitorRow.set_selected(selected);
    monitorRow.connect('notify::selected', () => {
      this._settings.set_int('monitor-index', choices[monitorRow.get_selected()].index);
    });
    placement.add(monitorRow);

    const gridRow = new Adw.SpinRow({
      title: 'Grid size',
      subtitle: 'Snap grid in pixels used while dragging widgets',
      adjustment: new Gtk.Adjustment({lower: 1, upper: 200, step_increment: 1, page_increment: 10}),
    });
    this._settings.bind('grid-size', gridRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    placement.add(gridRow);

    const gapRow = new Adw.SpinRow({
      title: 'Widget gap',
      subtitle: 'Spacing in pixels between widgets and the screen edges',
      adjustment: new Gtk.Adjustment({lower: 0, upper: 200, step_increment: 1, page_increment: 10}),
    });
    this._settings.bind('widget-gap', gapRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    placement.add(gapRow);

    const snapRow = new Adw.SwitchRow({
      title: 'Snap to grid',
      subtitle: 'Snap widget positions to the grid while dragging',
    });
    this._settings.bind('snap-to-grid', snapRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    placement.add(snapRow);

    page.add(placement);

    const behavior = new Adw.PreferencesGroup({title: 'Behavior'});

    const editRow = new Adw.SwitchRow({
      title: 'Edit mode',
      subtitle: 'Show drag handles and remove buttons on the widgets',
    });
    this._settings.bind('edit-mode', editRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(editRow);

    const lockRow = new Adw.SwitchRow({
      title: 'Lock widgets',
      subtitle: 'Prevent moving and resizing widgets',
    });
    this._settings.bind('lock-widgets', lockRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(lockRow);

    const hideRow = new Adw.SwitchRow({
      title: 'Hide all widgets',
      subtitle: 'Temporarily hide every widget without deleting the layout',
    });
    this._settings.bind('hide-all', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(hideRow);

    const opacityRow = new Adw.SpinRow({
      title: 'Widget opacity (%)',
      adjustment: new Gtk.Adjustment({lower: 10, upper: 100, step_increment: 1, page_increment: 10}),
    });
    this._settings.bind('widget-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(opacityRow);

    page.add(behavior);

    const panel = new Adw.PreferencesGroup({
      title: 'Top panel',
      description: 'Control the Desktop Widget button in the top panel.',
    });

    const panelIconRow = new Adw.SwitchRow({
      title: 'Show panel icon',
      subtitle: 'Show the Desktop Widget button in the top panel',
    });
    this._settings.bind('show-panel-icon', panelIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    panel.add(panelIconRow);

    page.add(panel);

    return page;
  };

  _buildPhotosPage() {
    const page = new Adw.PreferencesPage({
      name: 'photos',
      title: 'Photos',
      icon_name: 'image-x-generic-symbolic',
    });

    const sources = ['mixed', 'immich', 'local'];
    const scopes = ['all', 'favorites', 'album'];
    const sizes = ['preview', 'thumbnail', 'fullsize'];

    const sourceGroup = new Adw.PreferencesGroup({
      title: 'Display',
      description: 'Where the Photos widget gets its images and how often it changes.',
    });

    const sourceRow = new Adw.ComboRow({
      title: 'Photo source',
      subtitle: 'Immich is used first; local photos are a fallback when unavailable',
      model: Gtk.StringList.new(['Immich + local (fallback)', 'Immich only', 'Local only']),
    });
    sourceRow.set_selected(Math.max(0, sources.indexOf(this._settings.get_string('photos-source'))));
    sourceRow.connect('notify::selected', () => {
      this._settings.set_string('photos-source', sources[sourceRow.get_selected()]);
    });
    sourceGroup.add(sourceRow);

    const intervalRow = new Adw.SpinRow({
      title: 'Change interval (minutes)',
      adjustment: new Gtk.Adjustment({lower: 1, upper: 1440, step_increment: 1, page_increment: 5}),
    });
    intervalRow.set_value(Math.max(1, Math.round(this._settings.get_int('photo-interval') / 60) || 30));
    intervalRow.connect('notify::value', () => {
      this._settings.set_int('photo-interval', Math.round(intervalRow.get_value()) * 60);
    });
    sourceGroup.add(intervalRow);

    page.add(sourceGroup);

    const immichGroup = new Adw.PreferencesGroup({
      title: 'Immich',
      description: 'Pull random photos from your Immich server. Create an API key under Account Settings → API Keys.',
    });

    const urlRow = new Adw.EntryRow({title: 'Server URL'});
    urlRow.set_text(this._settings.get_string('immich-server-url'));
    urlRow.connect('notify::text', () => {
      this._settings.set_string('immich-server-url', urlRow.get_text().trim());
    });
    immichGroup.add(urlRow);

    const keyRow = new Adw.PasswordEntryRow({title: 'API key'});
    keyRow.set_text(this._settings.get_string('immich-api-key'));
    keyRow.connect('notify::text', () => {
      this._settings.set_string('immich-api-key', keyRow.get_text().trim());
    });
    immichGroup.add(keyRow);

    const scopeRow = new Adw.ComboRow({
      title: 'Show',
      model: Gtk.StringList.new(['All photos', 'Favorites only', 'Specific album']),
    });
    scopeRow.set_selected(Math.max(0, scopes.indexOf(this._settings.get_string('immich-scope'))));
    immichGroup.add(scopeRow);

    const albumRow = new Adw.ComboRow({title: 'Album'});
    albumRow.set_model(Gtk.StringList.new(['Loading albums…']));
    albumRow.set_sensitive(false);
    immichGroup.add(albumRow);

    const sizeRow = new Adw.ComboRow({
      title: 'Image quality',
      model: Gtk.StringList.new(['Preview (recommended)', 'Thumbnail (lightest)', 'Full size']),
    });
    sizeRow.set_selected(Math.max(0, sizes.indexOf(this._settings.get_string('immich-size'))));
    sizeRow.connect('notify::selected', () => {
      this._settings.set_string('immich-size', sizes[sizeRow.get_selected()]);
    });
    immichGroup.add(sizeRow);

    page.add(immichGroup);

    const albums = [];

    const populateAlbums = () => {
      if (albums.length === 0) {
        albumRow.set_model(Gtk.StringList.new(['No albums found']));
        albumRow.set_sensitive(false);
        return;
      };

      albumRow.set_model(Gtk.StringList.new(albums.map(album => `${album.name} (${album.count})`)));
      albumRow.set_sensitive(true);

      let index = albums.findIndex(album => album.id === this._settings.get_string('immich-album-id'));

      if (index < 0) {
        index = 0;
        this._settings.set_string('immich-album-id', albums[0].id);
      };

      albumRow.set_selected(index);
    };

    albumRow.connect('notify::selected', () => {
      const album = albums[albumRow.get_selected()];

      if (album) {
        this._settings.set_string('immich-album-id', album.id);
      };
    });

    const loadAlbums = () => {
      albumRow.set_model(Gtk.StringList.new(['Loading albums…']));
      albumRow.set_sensitive(false);

      Immich.fetchAlbumChoices(this._settings).then(choices => {
        albums.length = 0;
        albums.push(...choices);
        populateAlbums();
      }).catch(() => {
        albums.length = 0;
        albumRow.set_model(Gtk.StringList.new(['Album list unavailable']));
        albumRow.set_sensitive(false);
      });
    };

    let albumTimeoutId = 0;
    const scheduleAlbumFetch = () => {
      if (albumTimeoutId) {
        GLib.Source.remove(albumTimeoutId);
      };

      albumTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        albumTimeoutId = 0;
        loadAlbums();
        return GLib.SOURCE_REMOVE;
      });
    };

    const syncAlbumVisibility = () => {
      albumRow.set_visible(scopes[scopeRow.get_selected()] === 'album');
    };

    scopeRow.connect('notify::selected', () => {
      this._settings.set_string('immich-scope', scopes[scopeRow.get_selected()]);
      syncAlbumVisibility();
    });

    syncAlbumVisibility();

    this._settings.connect('changed::immich-server-url', scheduleAlbumFetch);
    this._settings.connect('changed::immich-api-key', scheduleAlbumFetch);

    loadAlbums();

    return page;
  };

  _subtitleFor(widget) {
    if (widget.hidden === true) {
      return 'Hidden';
    };

    return `Position: ${Math.round(widget.x ?? 0)}, ${Math.round(widget.y ?? 0)} · ${Math.round(widget.width ?? 0)}×${Math.round(widget.height ?? 0)}`;
  };

  _buildWidgetsPage() {
    const page = new Adw.PreferencesPage({
      name: 'widgets',
      title: 'Widgets',
      icon_name: 'view-grid-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: 'Individual widgets',
      description: 'Show or hide each widget and fine-tune its position and size. Add widgets from the panel menu.',
    });

    const widgets = this._layout.widgets;

    if (widgets.length === 0) {
      group.add(new Adw.ActionRow({
        title: 'No widgets configured',
        subtitle: 'Use the panel menu → Desktop Widgets → Add Widget, or press Reset below.',
      }));
    } else {
      widgets.forEach((widget, index) => {
        group.add(this._buildWidgetRow(widget, index));
      });
    };

    const resetRow = new Adw.ButtonRow({title: 'Reset to default layout'});
    resetRow.add_css_class('destructive-action');
    resetRow.connect('activated', () => {
      this._settings.set_string(LAYOUT_KEY, '');
      this._layout = {widgets: []};
      this._window?.close();
    });
    group.add(resetRow);

    page.add(group);

    return page;
  };

  _buildWidgetRow(widget) {
    const row = new Adw.ExpanderRow({
      title: widgetLabel(widget.type),
      subtitle: this._subtitleFor(widget),
    });

    const persist = () => {
      this._settings.set_string(LAYOUT_KEY, JSON.stringify(this._layout));
      row.set_subtitle(this._subtitleFor(widget));
    };

    const visibleRow = new Adw.SwitchRow({title: 'Visible'});
    visibleRow.set_active(widget.hidden !== true);
    visibleRow.connect('notify::active', () => {
      widget.hidden = !visibleRow.get_active();
      persist();
    });
    row.add_row(visibleRow);

    const addSpin = (title, key, lower, upper) => {
      const spin = new Adw.SpinRow({
        title,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: 1, page_increment: 10}),
      });
      spin.set_value(Math.round(widget[key] ?? 0));
      spin.connect('notify::value', () => {
        widget[key] = Math.round(spin.get_value());
        persist();
      });
      row.add_row(spin);
    };

    addSpin('X position', 'x', -10000, 10000);
    addSpin('Y position', 'y', -10000, 10000);
    addSpin('Width', 'width', 80, 10000);
    addSpin('Height', 'height', 80, 10000);

    return row;
  };
};
