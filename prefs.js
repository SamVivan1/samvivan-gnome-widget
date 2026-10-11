import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Immich from './widgets/photos/immich.js';

const LAYOUT_KEY = 'layout-json';
const EXTENSION_PATH = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

const WIDGET_LABELS = {
  clock: _('Clock'),
  calendar: _('Calendar'),
  agenda: _('Agenda'),
  weather: _('Weather'),
  photos: _('Photos'),
  battery: _('Battery'),
  bambu: _('Bambu Lab'),
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

function rgbaToHex(rgba) {
  const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');

  return `#${channel(rgba.red)}${channel(rgba.green)}${channel(rgba.blue)}`;
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
  const choices = [{index: -1, label: _('Primary monitor')}];

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
    window.add(this._buildDeveloperPage());
  };

  _buildGeneralPage(window) {
    const page = new Adw.PreferencesPage({
      name: 'general',
      title: _('General'),
      icon_name: 'emblem-system-symbolic',
    });

    const placement = new Adw.PreferencesGroup({
      title: _('Placement'),
      description: 'Where the widgets live and how they are positioned.',
    });

    const choices = monitorChoices(window.get_display());
    const labels = choices.map(choice => choice.label);
    const monitorRow = new Adw.ComboRow({
      title: _('Monitor'),
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
      title: _('Grid size'),
      subtitle: _('Snap grid in pixels used while dragging widgets'),
      adjustment: new Gtk.Adjustment({lower: 1, upper: 200, step_increment: 1, page_increment: 10}),
    });
    this._settings.bind('grid-size', gridRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    placement.add(gridRow);

    const gapRow = new Adw.SpinRow({
      title: _('Widget gap'),
      subtitle: _('Spacing in pixels between widgets and the screen edges'),
      adjustment: new Gtk.Adjustment({lower: 0, upper: 200, step_increment: 1, page_increment: 10}),
    });
    this._settings.bind('widget-gap', gapRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    placement.add(gapRow);

    const snapRow = new Adw.SwitchRow({
      title: _('Snap to grid'),
      subtitle: _('Snap widget positions to the grid while dragging'),
    });
    this._settings.bind('snap-to-grid', snapRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    placement.add(snapRow);

    page.add(placement);

    const behavior = new Adw.PreferencesGroup({title: _('Behavior')});

    const editRow = new Adw.SwitchRow({
      title: _('Edit mode'),
      subtitle: _('Show drag handles and remove buttons on the widgets'),
    });
    this._settings.bind('edit-mode', editRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(editRow);

    const hideRow = new Adw.SwitchRow({
      title: _('Hide all widgets'),
      subtitle: _('Temporarily hide every widget without deleting the layout'),
    });
    this._settings.bind('hide-all', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(hideRow);

    const opacityRow = new Adw.SpinRow({
      title: _('Widget opacity (%)'),
      adjustment: new Gtk.Adjustment({lower: 10, upper: 100, step_increment: 1, page_increment: 10}),
    });
    this._settings.bind('widget-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    behavior.add(opacityRow);

    page.add(behavior);

    const panel = new Adw.PreferencesGroup({
      title: _('Top panel'),
      description: 'Control the Desktop Widget button in the top panel.',
    });

    const panelIconRow = new Adw.SwitchRow({
      title: _('Show panel icon'),
      subtitle: _('Show the Desktop Widget button in the top panel'),
    });
    this._settings.bind('show-panel-icon', panelIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    panel.add(panelIconRow);

    page.add(panel);

    return page;
  };

  _buildPhotosPage() {
    const page = new Adw.PreferencesPage({
      name: 'photos',
      title: _('Photos'),
      icon_name: 'image-x-generic-symbolic',
    });

    const sources = ['mixed', 'immich', 'local'];
    const scopes = ['all', 'favorites', 'album'];
    const sizes = ['preview', 'thumbnail', 'fullsize'];

    const sourceGroup = new Adw.PreferencesGroup({
      title: _('Display'),
      description: 'Where the Photos widget gets its images and how often it changes.',
    });

    const sourceRow = new Adw.ComboRow({
      title: _('Photo source'),
      subtitle: _('Immich is used first; local photos are a fallback when unavailable'),
      model: Gtk.StringList.new(['Immich + local (fallback)', 'Immich only', 'Local only']),
    });
    sourceRow.set_selected(Math.max(0, sources.indexOf(this._settings.get_string('photos-source'))));
    sourceRow.connect('notify::selected', () => {
      this._settings.set_string('photos-source', sources[sourceRow.get_selected()]);
    });
    sourceGroup.add(sourceRow);

    const intervalRow = new Adw.SpinRow({
      title: _('Change interval (minutes)'),
      adjustment: new Gtk.Adjustment({lower: 1, upper: 1440, step_increment: 1, page_increment: 5}),
    });
    intervalRow.set_value(Math.max(1, Math.round(this._settings.get_int('photo-interval') / 60) || 30));
    intervalRow.connect('notify::value', () => {
      this._settings.set_int('photo-interval', Math.round(intervalRow.get_value()) * 60);
    });
    sourceGroup.add(intervalRow);

    page.add(sourceGroup);

    const immichGroup = new Adw.PreferencesGroup({
      title: _('Immich'),
      description: 'Pull random photos from your Immich server. Create an API key under Account Settings → API Keys.',
    });

    const urlRow = new Adw.EntryRow({title: _('Server URL')});
    urlRow.set_text(this._settings.get_string('immich-server-url'));
    urlRow.connect('notify::text', () => {
      this._settings.set_string('immich-server-url', urlRow.get_text().trim());
    });
    immichGroup.add(urlRow);

    const keyRow = new Adw.PasswordEntryRow({title: _('API key')});
    keyRow.set_text(this._settings.get_string('immich-api-key'));
    keyRow.connect('notify::text', () => {
      this._settings.set_string('immich-api-key', keyRow.get_text().trim());
    });
    immichGroup.add(keyRow);

    const scopeRow = new Adw.ComboRow({
      title: _('Show'),
      model: Gtk.StringList.new(['All photos', 'Favorites only', 'Specific album']),
    });
    scopeRow.set_selected(Math.max(0, scopes.indexOf(this._settings.get_string('immich-scope'))));
    immichGroup.add(scopeRow);

    const albumRow = new Adw.ComboRow({title: _('Album')});
    albumRow.set_model(Gtk.StringList.new([_('Loading albums…')]));
    albumRow.set_sensitive(false);
    immichGroup.add(albumRow);

    const sizeRow = new Adw.ComboRow({
      title: _('Image quality'),
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
        albumRow.set_model(Gtk.StringList.new([_('No albums found')]));
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
      albumRow.set_model(Gtk.StringList.new([_('Loading albums…')]));
      albumRow.set_sensitive(false);

      Immich.fetchAlbumChoices(this._settings).then(choices => {
        albums.length = 0;
        albums.push(...choices);
        populateAlbums();
      }).catch(() => {
        albums.length = 0;
        albumRow.set_model(Gtk.StringList.new([_('Album list unavailable')]));
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
      title: _('Calendar'),
      icon_name: 'x-office-calendar-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: _('Calendars'),
      description: 'Which calendars the Calendar and Agenda widgets read from Evolution. Deselecting every calendar shows all of them.',
    });

    const statusRow = new Adw.ActionRow({title: _('Loading calendars…')});
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
      title: _('Bambu Lab'),
      icon_name: 'printer-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: _('Bridge connection'),
      description: 'Point the widget at the self-hosted Bambu bridge (see homelab/bambu-bridge). Run it next to the printer and expose it through a Cloudflare Tunnel.',
    });

    const urlRow = new Adw.EntryRow({title: _('Bridge URL')});
    urlRow.set_text(this._settings.get_string('bambu-endpoint-url'));
    urlRow.connect('notify::text', () => {
      this._settings.set_string('bambu-endpoint-url', urlRow.get_text().trim());
    });
    group.add(urlRow);

    const tokenRow = new Adw.PasswordEntryRow({title: _('Bearer token')});
    tokenRow.set_text(this._settings.get_string('bambu-token'));
    tokenRow.connect('notify::text', () => {
      this._settings.set_string('bambu-token', tokenRow.get_text().trim());
    });
    group.add(tokenRow);

    const refreshRow = new Adw.SpinRow({
      title: _('Refresh interval (seconds)'),
      subtitle: _('How often the widget polls the bridge (3-300)'),
      adjustment: new Gtk.Adjustment({lower: 3, upper: 300, step_increment: 1, page_increment: 5}),
    });
    this._settings.bind('bambu-refresh', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(refreshRow);

    const testRow = new Adw.ActionRow({
      title: _('Connection status'),
      subtitle: _('Not tested yet'),
    });
    const testButton = new Gtk.Button({
      label: _('Test connection'),
      valign: Gtk.Align.CENTER,
    });
    testButton.connect('clicked', () => this._testBambuConnection(testRow, testButton));
    testRow.add_suffix(testButton);
    group.add(testRow);

    page.add(group);

    page.add(this._buildBambuOfflineGroup());

    return page;
  };

  _buildBambuOfflineGroup() {
    const group = new Adw.PreferencesGroup({
      title: _('Offline face'),
      description: 'What to show when the bridge is reachable but the printer is offline.',
    });

    const funRow = new Adw.SwitchRow({
      title: _('Animated face'),
      subtitle: _('Show a cute mochi face that reacts to temperature, battery and CPU load instead of a plain “Printer offline” message'),
    });
    this._settings.bind('bambu-offline-fun', funRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(funRow);

    const alwaysRow = new Adw.SwitchRow({
      title: _('Always show the face'),
      subtitle: _('Show it even when the printer is online or the bridge is unreachable (good for testing)'),
    });
    this._settings.bind('bambu-offline-always', alwaysRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(alwaysRow);

    const faceOnlineRow = new Adw.SwitchRow({
      title: _('Show the face while printing'),
      subtitle: _('Replace the job details with the face so it can react to print events (printing, paused, failed, finished)'),
    });
    this._settings.bind('bambu-face-online', faceOnlineRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(faceOnlineRow);

    const accentRow = new Adw.SwitchRow({
      title: _('Use system accent colour'),
      subtitle: _('Turn off to pick a custom colour for the face'),
    });
    group.add(accentRow);

    const colorRow = new Adw.ActionRow({title: _('Face colour')});
    const colorButton = new Gtk.ColorButton({valign: Gtk.Align.CENTER, use_alpha: false});

    colorRow.add_suffix(colorButton);
    group.add(colorRow);

    const captionRow = new Adw.EntryRow({title: _('Caption (leave empty to hide)')});
    captionRow.set_text(this._settings.get_string('bambu-offline-caption'));
    captionRow.connect('notify::text', () => {
      this._settings.set_string('bambu-offline-caption', captionRow.get_text());
    });
    group.add(captionRow);

    const thresholdRows = [];

    const addThreshold = (title, subtitle, key, lower, upper) => {
      const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: 1, page_increment: 5}),
      });

      row.set_value(this._settings.get_int(key));
      row.connect('notify::value', () => {
        this._settings.set_int(key, Math.round(row.get_value()));
      });
      group.add(row);
      thresholdRows.push(row);
    };

    addThreshold('Hot above', 'Temperature (°C) at or above which the face looks hot', 'bambu-hot-temp', 30, 110);
    addThreshold('Sleepy below', 'Battery (%) at or below which the face looks sleepy while unplugged', 'bambu-low-battery', 0, 100);
    addThreshold('Busy above', 'CPU load (%) at or above which the face looks busy', 'bambu-high-load', 0, 100);
    addThreshold('Overloaded above', 'RAM usage (%) at or above which the face looks overloaded', 'bambu-high-ram', 0, 100);

    let syncing = false;

    const applyColorState = () => {
      const enabled = this._settings.get_boolean('bambu-offline-fun')
        || this._settings.get_boolean('bambu-offline-always');
      const hex = this._settings.get_string('bambu-offline-color');
      const usesAccent = !hex;

      syncing = true;
      accentRow.set_active(usesAccent);
      syncing = false;

      accentRow.set_sensitive(enabled);
      colorRow.set_sensitive(enabled);
      colorButton.set_sensitive(enabled && !usesAccent);

      for (const row of thresholdRows) {
        row.set_sensitive(enabled);
      };

      if (!usesAccent) {
        const rgba = new Gdk.RGBA();

        if (rgba.parse(hex)) {
          colorButton.set_rgba(rgba);
        };
      };

      faceOnlineRow.set_sensitive(this._settings.get_boolean('bambu-offline-fun'));
    };

    accentRow.connect('notify::active', () => {
      if (syncing) {
        return;
      };

      if (accentRow.get_active()) {
        this._settings.set_string('bambu-offline-color', '');
      } else {
        this._settings.set_string('bambu-offline-color', rgbaToHex(colorButton.get_rgba()));
      };

      applyColorState();
    });

    colorButton.connect('color-set', () => {
      this._settings.set_string('bambu-offline-color', rgbaToHex(colorButton.get_rgba()));
      applyColorState();
    });

    funRow.connect('notify::active', applyColorState);
    alwaysRow.connect('notify::active', applyColorState);
    applyColorState();

    return group;
  };

  _toast(message, timeout = 4) {
    try {
      this._window.add_toast?.(new Adw.Toast({title: message, timeout}));
    } catch (error) {
      // older libadwaita without add_toast; the row subtitle still shows the result
    };
  };

  _bambuEndpoint() {
    const raw = this._settings.get_string('bambu-endpoint-url').trim().replace(/\/+$/, '');

    if (!raw) {
      return '';
    };

    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  };

  _testBambuConnection(row, button) {
    const endpoint = this._bambuEndpoint();
    const token = this._settings.get_string('bambu-token').trim();

    if (!endpoint || !token) {
      row.subtitle = 'Set the bridge URL and token first';
      this._toast(_('Set the bridge URL and token first'));
      return;
    };

    row.subtitle = `Testing ${endpoint}/health…`;
    button.set_sensitive(false);

    const session = new Soup.Session({timeout: 12, user_agent: 'desktop-widget'});
    const message = Soup.Message.new('GET', `${endpoint}/health`);

    if (!message) {
      row.subtitle = 'Invalid bridge URL';
      button.set_sensitive(true);
      this._toast(_('Invalid bridge URL'));
      return;
    };

    message.request_headers.append('Authorization', `Bearer ${token}`);
    message.request_headers.append('accept', 'application/json');

    let settled = false;
    const finish = () => {
      settled = true;
      button.set_sensitive(true);
    };

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
      if (!settled) {
        session.abort();
        row.subtitle = 'Connection timed out after 15s';
        this._toast(_('Connection timed out'));
        finish();
      };

      return GLib.SOURCE_REMOVE;
    });

    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
      if (settled) {
        return;
      };

      GLib.source_remove(timeoutId);

      try {
        const bytes = source.send_and_read_finish(result);
        const status = message.get_status();

        if (status !== Soup.Status.OK) {
          row.subtitle = status === Soup.Status.BAD_GATEWAY
            ? 'HTTP 502 — the tunnel is up but the bridge is not running'
            : status === Soup.Status.UNAUTHORIZED
              ? 'HTTP 401 — token does not match API_TOKEN'
              : `Bridge replied with HTTP ${status}`;
          this._toast(row.subtitle);
        } else {
          const payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));

          row.subtitle = payload.connected === true
            ? 'Bridge reachable, printer connected'
            : `Bridge reachable, printer not connected (mock=${payload.mock === true})`;
          this._toast(row.subtitle);
        };
      } catch (error) {
        row.subtitle = `Connection failed: ${error.message}`;
        this._toast(_('Connection failed — see Bambu Lab page'));
      } finally {
        finish();
      };
    });
  };

  _subtitleFor(widget) {
    if (widget.hidden === true) {
      return 'Hidden';
    };

    return `Position: ${Math.round(widget.x ?? 0)}, ${Math.round(widget.y ?? 0)} · ${Math.round(widget.width ?? 0)}×${Math.round(widget.height ?? 0)}`;
  };

  _buildDeveloperPage() {
    const page = new Adw.PreferencesPage({
      name: 'developer',
      title: _('Developer'),
      icon_name: 'applications-engineering-symbolic',
    });

    const master = new Adw.PreferencesGroup({
      title: _('Developer mode'),
      description: 'Reveal extra controls for testing widgets without real-world conditions.',
    });

    const devRow = new Adw.SwitchRow({
      title: _('Enable developer mode'),
      subtitle: _('Show testing controls such as forcing the Bambu face mood'),
    });
    this._settings.bind('dev-mode', devRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    master.add(devRow);
    page.add(master);

    const faceGroup = new Adw.PreferencesGroup({
      title: _('Bambu face'),
      description: 'Preview every mood without stressing the CPU or draining the battery. Turn on “Always show the face” on the Bambu Lab page to see it while the printer is online.',
    });

    const cycleRow = new Adw.SwitchRow({
      title: _('Cycle all moods'),
      subtitle: _('Rotate through chill, hot, sleepy, charging, busy and overload automatically'),
    });
    this._settings.bind('bambu-dev-cycle', cycleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    faceGroup.add(cycleRow);

    const moods = ['auto', 'chill', 'hot', 'sleepy', 'charging', 'busy', 'overload', 'printing', 'paused', 'error', 'done'];
    const moodRow = new Adw.ComboRow({
      title: _('Force mood'),
      model: Gtk.StringList.new(['Auto (real sensors)', 'Chill', 'Hot', 'Sleepy', 'Charging', 'Busy', 'Overloaded', 'Printing', 'Paused', 'Error', 'Finished']),
    });
    moodRow.set_selected(Math.max(0, moods.indexOf(this._settings.get_string('bambu-dev-mood'))));
    moodRow.connect('notify::selected', () => {
      this._settings.set_string('bambu-dev-mood', moods[moodRow.get_selected()]);
    });
    faceGroup.add(moodRow);
    page.add(faceGroup);

    const syncState = () => {
      const enabled = this._settings.get_boolean('dev-mode');
      const cycling = this._settings.get_boolean('bambu-dev-cycle');

      faceGroup.set_sensitive(enabled);
      cycleRow.set_sensitive(enabled);
      moodRow.set_sensitive(enabled && !cycling);
    };

    devRow.connect('notify::active', syncState);
    cycleRow.connect('notify::active', () => {
      if (this._settings.get_boolean('bambu-dev-cycle')) {
        this._settings.set_string('bambu-dev-mood', 'auto');
        moodRow.set_selected(0);
      };

      syncState();
    });
    syncState();

    return page;
  };

  _buildWidgetsPage() {
    const page = new Adw.PreferencesPage({
      name: 'widgets',
      title: _('Widgets'),
      icon_name: 'view-grid-symbolic',
    });

    const listGroup = new Adw.PreferencesGroup({
      title: _('Individual widgets'),
      description: 'Add, remove, show or hide each widget and fine-tune its position and size.',
    });
    page.add(listGroup);

    const addGroup = new Adw.PreferencesGroup({
      title: _('Add widget'),
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
          title: _('No widgets configured'),
          subtitle: _('Add one from the "Add widget" section below.'),
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

      const resetRow = new Adw.ButtonRow({title: _('Reset to default layout')});
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

    const visibleRow = new Adw.SwitchRow({title: _('Visible')});
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

        if (key === 'x' || key === 'y') {
          delete widget.fx;
          delete widget.fy;
        };

        save();
      });
      row.add_row(spin);
    };

    addSpin('X position', 'x', -10000, 10000);
    addSpin('Y position', 'y', -10000, 10000);
    addSpin('Width', 'width', 80, 10000);
    addSpin('Height', 'height', 80, 10000);

    const removeRow = new Adw.ButtonRow({title: _('Remove widget')});
    removeRow.add_css_class('destructive-action');
    removeRow.connect('activated', () => onRemove());
    row.add_row(removeRow);

    return row;
  };
};
