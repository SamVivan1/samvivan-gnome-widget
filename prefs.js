import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Immich from './widgets/photos/immich.js';

const LAYOUT_KEY = 'layout-json';
const EXTENSION_PATH = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

const WIDGET_LABELS = {
  clock: 'Clock',
  calendar: 'Calendar',
  agenda: 'Agenda',
  weather: 'Weather',
  photos: 'Photos',
  battery: 'Battery',
  bambu: 'Bambu Lab',
};

const WIDGET_DEFAULT_SIZES = {
  clock: 'small',
  calendar: 'small',
  agenda: 'medium',
  weather: 'small',
  photos: 'medium',
  battery: 'medium',
  bambu: 'medium',
};

const WIDGET_DIMENSIONS = {
  small: [220, 220],
  medium: [454, 220],
  large: [454, 454],
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
    window.add(this._buildCalendarPage());
    window.add(this._buildBambuPage());
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

  _buildCalendarPage() {
    const page = new Adw.PreferencesPage({
      name: 'calendar',
      title: 'Calendar',
      icon_name: 'x-office-calendar-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: 'Calendars',
      description: 'Which calendars the Calendar and Agenda widgets read from Evolution. Deselecting every calendar shows all of them.',
    });

    const statusRow = new Adw.ActionRow({title: 'Loading calendars…'});
    group.add(statusRow);
    page.add(group);

    this._loadCalendarSources(group, statusRow);

    return page;
  };

  _loadCalendarSources(group, statusRow) {
    const helper = GLib.build_filenamev([EXTENSION_PATH, 'tools', 'eds_events.py']);
    const python = GLib.find_program_in_path('python3');

    if (!python || !Gio.File.new_for_path(helper).query_exists(null)) {
      statusRow.title = 'Calendar support unavailable';
      statusRow.subtitle = 'Install python3-gi and Evolution Data Server introspection';
      return;
    };

    let proc;

    try {
      proc = Gio.Subprocess.new(
        [python, helper, '--list-sources'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (error) {
      statusRow.title = 'Could not read calendars';
      statusRow.subtitle = error.message;
      return;
    };

    proc.communicate_utf8_async(null, null, (source, result) => {
      let stdout = '';

      try {
        [, stdout] = proc.communicate_utf8_finish(result);
      } catch (error) {
        statusRow.title = 'Could not read calendars';
        statusRow.subtitle = error.message;
        return;
      };

      let payload;

      try {
        payload = JSON.parse(stdout || '{}');
      } catch (error) {
        statusRow.title = 'Could not read calendars';
        statusRow.subtitle = error.message;
        return;
      };

      this._populateCalendarSources(group, statusRow, payload);
    });
  };

  _populateCalendarSources(group, statusRow, payload) {
    if (payload.ok !== true) {
      statusRow.title = 'Calendar support unavailable';
      statusRow.subtitle = payload.error ?? 'Install python3-gi and Evolution Data Server introspection';
      return;
    };

    const sources = payload.sources ?? [];

    if (sources.length === 0) {
      statusRow.title = 'No calendars found';
      statusRow.subtitle = 'Add a calendar in GNOME Calendar or Evolution';
      return;
    };

    group.remove(statusRow);

    const stored = this._settings.get_strv('calendar-sources');
    const allSelected = stored.length === 0;
    const selected = new Set(stored);
    const switches = [];

    const persist = () => {
      const active = switches.filter(item => item.row.get_active()).map(item => item.uid);

      this._settings.set_strv(
        'calendar-sources',
        active.length === switches.length ? [] : active);
    };

    for (const source of sources) {
      const row = new Adw.SwitchRow({
        title: source.name,
        subtitle: source.holiday ? 'Public holidays' : (source.uid ?? ''),
      });

      row.set_active(allSelected || selected.has(source.uid));
      row.connect('notify::active', persist);
      group.add(row);
      switches.push({uid: source.uid, row});
    };
  };

  _buildBambuPage() {
    const page = new Adw.PreferencesPage({
      name: 'bambu',
      title: 'Bambu Lab',
      icon_name: 'printer-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: 'Bridge connection',
      description: 'Point the widget at the self-hosted Bambu bridge (see homelab/bambu-bridge). Run it next to the printer and expose it through a Cloudflare Tunnel.',
    });

    const urlRow = new Adw.EntryRow({title: 'Bridge URL'});
    urlRow.set_text(this._settings.get_string('bambu-endpoint-url'));
    urlRow.connect('notify::text', () => {
      this._settings.set_string('bambu-endpoint-url', urlRow.get_text().trim());
    });
    group.add(urlRow);

    const tokenRow = new Adw.PasswordEntryRow({title: 'Bearer token'});
    tokenRow.set_text(this._settings.get_string('bambu-token'));
    tokenRow.connect('notify::text', () => {
      this._settings.set_string('bambu-token', tokenRow.get_text().trim());
    });
    group.add(tokenRow);

    const refreshRow = new Adw.SpinRow({
      title: 'Refresh interval (seconds)',
      subtitle: 'How often the widget polls the bridge (3-300)',
      adjustment: new Gtk.Adjustment({lower: 3, upper: 300, step_increment: 1, page_increment: 5}),
    });
    this._settings.bind('bambu-refresh', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(refreshRow);

    const testRow = new Adw.ActionRow({
      title: 'Connection status',
      subtitle: 'Not tested yet',
    });
    const testButton = new Gtk.Button({
      label: 'Test connection',
      valign: Gtk.Align.CENTER,
    });
    testButton.connect('clicked', () => this._testBambuConnection(testRow, testButton));
    testRow.add_suffix(testButton);
    group.add(testRow);

    page.add(group);

    return page;
  };

  _testBambuConnection(row, button) {
    const endpoint = this._settings.get_string('bambu-endpoint-url').trim().replace(/\/+$/, '');
    const token = this._settings.get_string('bambu-token').trim();

    if (!endpoint || !token) {
      row.subtitle = 'Set the bridge URL and token first';
      return;
    };

    row.subtitle = 'Testing…';
    button.set_sensitive(false);

    const session = new Soup.Session({timeout: 10, user_agent: 'desktop-widget'});
    const message = Soup.Message.new('GET', `${endpoint}/health`);

    message.request_headers.append('Authorization', `Bearer ${token}`);
    message.request_headers.append('accept', 'application/json');

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
      try {
        const bytes = source.send_and_read_finish(result);
        const status = message.get_status();

        if (status !== Soup.Status.OK) {
          row.subtitle = `Bridge replied with HTTP ${status}`;
        } else {
          const payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));

          row.subtitle = payload.connected === true
            ? 'Bridge reachable, printer connected'
            : 'Bridge reachable, printer not connected';
        };
      } catch (error) {
        row.subtitle = `Connection failed: ${error.message}`;
      } finally {
        button.set_sensitive(true);
      };
    });
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

    const listGroup = new Adw.PreferencesGroup({
      title: 'Individual widgets',
      description: 'Add, remove, show or hide each widget and fine-tune its position and size.',
    });
    page.add(listGroup);

    const addGroup = new Adw.PreferencesGroup({
      title: 'Add widget',
      description: 'Adds a new widget to the layout below.',
    });
    page.add(addGroup);

    let rows = [];

    const persist = () => {
      this._settings.set_string(LAYOUT_KEY, JSON.stringify(this._layout));
    };

    const render = () => {
      for (const row of rows) {
        listGroup.remove(row);
      };

      rows = [];

      const widgets = this._layout.widgets;

      if (widgets.length === 0) {
        const empty = new Adw.ActionRow({
          title: 'No widgets configured',
          subtitle: 'Add one from the "Add widget" section below.',
        });
        listGroup.add(empty);
        rows.push(empty);
      } else {
        for (const widget of widgets) {
          const row = this._buildWidgetRow(widget, persist, () => {
            this._layout.widgets = this._layout.widgets.filter(item => item !== widget);
            persist();
            render();
          });
          listGroup.add(row);
          rows.push(row);
        };
      };

      const resetRow = new Adw.ButtonRow({title: 'Reset to default layout'});
      resetRow.add_css_class('destructive-action');
      resetRow.connect('activated', () => {
        this._settings.set_string(LAYOUT_KEY, '');
        this._layout = {widgets: []};
        render();
      });
      listGroup.add(resetRow);
      rows.push(resetRow);
    };

    for (const [type, label] of Object.entries(WIDGET_LABELS)) {
      const row = new Adw.ButtonRow({title: `Add ${label}`});
      row.connect('activated', () => {
        this._layout.widgets.push(this._newWidget(type));
        persist();
        render();
      });
      addGroup.add(row);
    };

    render();

    return page;
  };

  _newWidget(type) {
    const size = WIDGET_DEFAULT_SIZES[type] ?? 'small';
    const [width, height] = WIDGET_DIMENSIONS[size] ?? WIDGET_DIMENSIONS.small;
    const count = this._layout.widgets.length;

    return {
      id: `${type}-${Date.now()}`,
      type,
      size,
      x: 32 + (count % 4) * 240,
      y: 96 + Math.floor(count / 4) * 250,
      width,
      height,
      data: {},
    };
  };

  _buildWidgetRow(widget, persist, onRemove) {
    const row = new Adw.ExpanderRow({
      title: widgetLabel(widget.type),
      subtitle: this._subtitleFor(widget),
    });

    const save = () => {
      persist();
      row.set_subtitle(this._subtitleFor(widget));
    };

    const visibleRow = new Adw.SwitchRow({title: 'Visible'});
    visibleRow.set_active(widget.hidden !== true);
    visibleRow.connect('notify::active', () => {
      widget.hidden = !visibleRow.get_active();
      save();
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
        save();
      });
      row.add_row(spin);
    };

    addSpin('X position', 'x', -10000, 10000);
    addSpin('Y position', 'y', -10000, 10000);
    addSpin('Width', 'width', 80, 10000);
    addSpin('Height', 'height', 80, 10000);

    const removeRow = new Adw.ButtonRow({title: 'Remove widget'});
    removeRow.add_css_class('destructive-action');
    removeRow.connect('activated', () => onRemove());
    row.add_row(removeRow);

    return row;
  };
};
