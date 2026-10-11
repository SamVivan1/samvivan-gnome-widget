import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as AgendaWidget from './widgets/agenda/widget.js';
import * as BambuWidget from './widgets/bambu/widget.js';
import * as BatteryWidget from './widgets/battery/widget.js';
import * as CalendarWidget from './widgets/calendar/widget.js';
import * as ClockWidget from './widgets/clock/widget.js';
import * as PhotosWidget from './widgets/photos/widget.js';
import * as WeatherWidget from './widgets/weather/widget.js';
import { BambuData } from './lib/bambuData.js';
import { CalendarData } from './lib/calendarData.js';
import {
  clamp,
  snap as gridSnap,
  sizeForWidget as widgetSize,
  monitorWorkArea as areaForMonitor,
  widgetFractions as fractionsForWidget,
  positionForFractions as positionFromWidgetFractions,
  rectForWidget as widgetRect,
  rectsOverlap as rectsOverlapWithGap,
} from './lib/geometry.js';
import { configureLogger, resetLogger, warn } from './logger.js';
import { WorkspaceIntegration } from './workspaceIntegration.js';

const EXTENSION_PATH = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const LAYOUT_KEY = 'layout-json';
const GRID_DEFAULT = 20;
const GAP_DEFAULT = 14;
let GRID_SIZE = GRID_DEFAULT;
let WIDGET_GAP = GAP_DEFAULT;
let SNAP_TO_GRID = true;
const SMALL_WIDGET_SIZE = 220;
const MEDIUM_WIDGET_WIDTH = SMALL_WIDGET_SIZE * 2 + GAP_DEFAULT;
const MIN_WIDGET_WIDTH = 180;
const MIN_WIDGET_HEIGHT = 160;
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';

const WIDGET_MODULES = [
  ClockWidget,
  CalendarWidget,
  AgendaWidget,
  WeatherWidget,
  PhotosWidget,
  BatteryWidget,
  BambuWidget,
];
const WIDGETS = new Map(WIDGET_MODULES.map(widgetModule => [widgetModule.type, widgetModule]));
const WIDGET_TYPES = WIDGET_MODULES.map(widgetModule => [widgetModule.type, widgetModule.label]);
const DEFAULT_WIDGETS = WIDGET_MODULES
  .filter(widgetModule => widgetModule.defaultInLayout !== false)
  .map(widgetModule => ({
    id: `${widgetModule.type}-default`,
    type: widgetModule.type,
    size: widgetModule.defaultSize,
  }));
const WIDGET_APP_IDS = Object.fromEntries(WIDGET_MODULES
  .filter(widgetModule => widgetModule.appIds)
  .map(widgetModule => [widgetModule.type, widgetModule.appIds]));
const WIDGET_SIZES = {
  small: [SMALL_WIDGET_SIZE, SMALL_WIDGET_SIZE],
  medium: [MEDIUM_WIDGET_WIDTH, SMALL_WIDGET_SIZE],
  large: [MEDIUM_WIDGET_WIDTH, MEDIUM_WIDGET_WIDTH],
};

const ACCENT_COLORS = {
  blue: '#3584e4',
  teal: '#2190a4',
  green: '#3a944a',
  yellow: '#c88800',
  orange: '#ed5b00',
  red: '#e62d42',
  pink: '#d56199',
  purple: '#9141ac',
  slate: '#6f8396',
};

function defaultWidgetPositions() {
  const monitor = Main.layoutManager.primaryMonitor;

  if (!monitor) {
    return null;
  }

  const rightX = snap(Math.max(WIDGET_GAP, monitor.width - MEDIUM_WIDGET_WIDTH - WIDGET_GAP));
  const middleX = snap(Math.max(WIDGET_GAP, rightX - SMALL_WIDGET_SIZE - WIDGET_GAP));
  const leftX = snap(Math.max(WIDGET_GAP, middleX - SMALL_WIDGET_SIZE - WIDGET_GAP));
  const topY = Main.panel?.height ? Main.panel.height + WIDGET_GAP : WIDGET_GAP;
  const bottomY = snap(topY + SMALL_WIDGET_SIZE + WIDGET_GAP);

  return {
    weather: {x: leftX, y: topY},
    calendar: {x: middleX, y: topY},
    photos: {x: rightX, y: topY},
    clock: {x: middleX, y: bottomY},
    battery: {x: rightX, y: bottomY},
  };
};

function cloneDefaultWidgets() {
  const positions = defaultWidgetPositions();

  return DEFAULT_WIDGETS.map(widget => ({
    id: widget.id,
    type: widget.type,
    size: widget.size,
    width: WIDGET_SIZES[widget.size][0],
    height: WIDGET_SIZES[widget.size][1],
    x: positions?.[widget.type]?.x ?? WIDGET_GAP,
    y: positions?.[widget.type]?.y ?? WIDGET_GAP,
    hidden: false,
    data: {},
  }));
};



function desktopAppExists(appId) {
  const dataDirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];

  for (const dataDir of dataDirs) {
    const file = Gio.File.new_for_path(GLib.build_filenamev([dataDir, 'applications', appId]));

    if (file.query_exists(null)) {
      return true;
    };
  };

  return false;
};


function accentColor(settings) {
  const accent = settings?.get_string('accent-color') ?? 'blue';

  return ACCENT_COLORS[accent] ?? ACCENT_COLORS.blue;
};

function darkStyleEnabled(settings) {
  return settings?.get_string('color-scheme') === 'prefer-dark';
};

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  const normalized = value.length === 3
    ? value.split('').map(part => part + part).join('')
    : value;

  if (normalized.length !== 6) {
    return `rgba(53, 132, 228, ${alpha})`;
  };

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

function snap(value) {
  return gridSnap(value, {gridSize: GRID_SIZE, snapToGrid: SNAP_TO_GRID});
};

function sizeForWidget(widget) {
  return widgetSize(widget, WIDGET_SIZES);
};

function monitorWorkArea(monitor) {
  return areaForMonitor(monitor, {gap: WIDGET_GAP, panelHeight: Main.panel?.height ?? 0});
};

function widgetFractions(widget, monitor) {
  return fractionsForWidget(widget, monitor, {
    gap: WIDGET_GAP,
    panelHeight: Main.panel?.height ?? 0,
    sizes: WIDGET_SIZES,
  });
};

function positionForFractions(widget, monitor) {
  return positionFromWidgetFractions(widget, monitor, {
    gap: WIDGET_GAP,
    panelHeight: Main.panel?.height ?? 0,
    sizes: WIDGET_SIZES,
  });
};

function rectForWidget(widget) {
  return widgetRect(widget, WIDGET_SIZES);
};

function rectsOverlap(a, b) {
  return rectsOverlapWithGap(a, b, WIDGET_GAP);
};

function raiseActor(actor) {
  const parent = actor.get_parent();

  if (parent?.set_child_above_sibling) {
    parent.set_child_above_sibling(actor, null);
  };
};

class WidgetController {
  constructor(extension) {
    this._extension = extension;
    this._widgets = [];
    this._views = new Map();
    this._timeouts = [];
    this._dbusSignalIds = [];
    this._sessionSignalIds = [];
    this._settingsSignals = [];
    this._editMode = false;
    this._dragActor = null;
    this._dragging = false;
    this._lastAppLaunchAt = 0;
    this._lastLayoutJson = null;
    this._syncingMenu = false;
    this._indicator = null;
    this._editItem = null;
    this._hideItem = null;
    this._layoutSettings = extension.getSettings();
    this._workspaceIntegration = new WorkspaceIntegration(() => this._monitorIndex());
    this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});
    this._weatherSettings = new Gio.Settings({schema_id: WeatherWidget.settingsSchema});
    this._weather = null;
    this._weatherLocation = null;
    this._weatherInfo = null;
    this._weatherUpdating = false;
    this._weatherUpdateTime = 0;
    this._batteryRefreshId = 0;
    this._lastBatteryRefreshAt = 0;
    this._batterySignature = undefined;
    this._calendarSignature = undefined;
    this._calendarData = null;
    this._calendarUnsubscribe = null;
  };

  _monitorIndex() {
    const monitors = Main.layoutManager.monitors ?? [];
    const index = this._layoutSettings.get_int('monitor-index');

    if (index >= 0 && index < monitors.length) {
      return index;
    };

    return Main.layoutManager.primaryIndex;
  };

  _monitor() {
    return Main.layoutManager.monitors?.[this._monitorIndex()] ??
      Main.layoutManager.primaryMonitor;
  };

  _widgetOpacity() {
    return clamp(this._layoutSettings.get_int('widget-opacity'), 10, 100);
  };

  _applyGlobalSettings() {
    const settings = this._layoutSettings;

    GRID_SIZE = Math.max(1, settings.get_int('grid-size'));
    WIDGET_GAP = Math.max(0, settings.get_int('widget-gap'));
    SNAP_TO_GRID = settings.get_boolean('snap-to-grid');
    this._editMode = settings.get_boolean('edit-mode');
  };

  _connectSettings() {
    const settings = this._layoutSettings;
    const connect = (key, handler) => {
      this._settingsSignals.push(settings.connect(`changed::${key}`, handler));
    };

    connect(LAYOUT_KEY, () => {
      const current = settings.get_string(LAYOUT_KEY);

      if (current === this._lastLayoutJson) {
        return;
      };

      this._lastLayoutJson = current;
      this._widgets = this._loadWidgets();
      this._rebuildWidgets();
    });

    connect('grid-size', () => this._onGlobalChanged());
    connect('widget-gap', () => this._onGlobalChanged());
    connect('snap-to-grid', () => this._onGlobalChanged());
    connect('monitor-index', () => this._syncLayerGeometry());
    connect('hide-all', () => {
      this._syncMenu();
      this._applyVisibility();
    });
    connect('edit-mode', () => {
      this._syncMenu();
      this.setEditMode(settings.get_boolean('edit-mode'));
    });
    connect('widget-opacity', () => this._applyOpacity());
    connect('show-panel-icon', () => this._syncIndicator());
    connect('calendar-sources', () => this._applyCalendarSources());
    connect('bambu-endpoint-url', () => this._reconfigureBambu());
    connect('bambu-token', () => this._reconfigureBambu());
    connect('bambu-refresh', () => this._reconfigureBambu());
    connect('bambu-offline-fun', () => this._refreshBambuViews(true));
    connect('bambu-offline-always', () => this._refreshBambuViews(true));
    connect('bambu-offline-color', () => this._refreshBambuViews(true));
    connect('bambu-offline-caption', () => this._refreshBambuViews(true));
    connect('bambu-hot-temp', () => this._refreshBambuViews(true));
    connect('bambu-low-battery', () => this._refreshBambuViews(true));
    connect('bambu-high-load', () => this._refreshBambuViews(true));
    connect('bambu-high-ram', () => this._refreshBambuViews(true));
    connect('dev-mode', () => this._refreshBambuViews(true));
    connect('bambu-dev-mood', () => this._refreshBambuViews(true));
    connect('bambu-dev-cycle', () => this._refreshBambuViews(true));
  };

  _reconfigureBambu() {
    this._bambuData?.reconfigure();
  };

  _syncBambuPolling() {
    const active = this._widgets.some(widget => widget.type === 'bambu');

    this._bambuData?.setEnabled(active);
  };

  _applyCalendarSources() {
    if (!this._calendarData) {
      return;
    };

    let sources = [];

    try {
      sources = this._layoutSettings.get_strv('calendar-sources');
    } catch (error) {
      sources = [];
    };

    this._calendarData.setSourcesFilter(sources);
  };

  _onGlobalChanged() {
    this._applyGlobalSettings();
    this._anchorWidgets();
    this._resolveLayout(null, false, true);
  };

  _applyOpacity() {
    const opacity = Math.round(this._widgetOpacity() * 2.55);

    for (const view of this._views.values()) {
      view.actor.set_opacity(opacity);
    };
  };

  _syncMenu() {
    this._syncingMenu = true;

    this._editItem?.setToggleState(this._layoutSettings.get_boolean('edit-mode'));
    this._hideItem?.setToggleState(this._layoutSettings.get_boolean('hide-all'));

    this._syncingMenu = false;
  };

  enable() {
    this._applyGlobalSettings();
    this._widgets = this._loadWidgets();
    this._saveWidgets();
    this._connectSettings();
    this._syncIndicator();

    this._calendarData = new CalendarData(EXTENSION_PATH);
    this._calendarUnsubscribe = this._calendarData.subscribe(() => this._refreshCalendarViews(true));
    this._applyCalendarSources();
    this._calendarData.start();

    this._bambuData = new BambuData(this._layoutSettings);
    this._bambuRenderKey = null;
    this._bambuUnsubscribe = this._bambuData.subscribe(() => this._refreshBambuViews());

    this._createLayer();
    this._rebuildWidgets();
    this._bambuData.start();
    this._refreshWeather(true);
    this._workspaceIntegration.enable(this._layer);

    global.stage.connectObject(
      'button-release-event', (_stage, event) => this._handleAppClickEvent(event),
      this
    );

    this._interfaceSettings.connectObject(
      'changed::color-scheme', () => this._rebuildWidgets(),
      'changed::accent-color', () => this._rebuildWidgets(),
      this
    );

    this._weatherSettings.connectObject('changed::locations', () => {
      this._weather = null;
      this._weatherUpdateTime = 0;
      this._refreshWeather(true);
      this._refreshWeatherViews();
    }, this);

    this._watchBatteryChanges();
    BatteryWidget.setBatterySignatureListener?.(signature => this._applyBatterySignature(signature));

    Main.layoutManager.connectObject(
      'monitors-changed', () => this._syncLayerGeometry(),
      this
    );

    St.Settings.get().connectObject(
      'notify::enable-animations', () => this._refreshBambuViews(true),
      this
    );

    this._timeouts.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
      this._refreshWidgets();
      return GLib.SOURCE_CONTINUE;
    }));
  };

  destroy() {
    this._workspaceIntegration.destroy();
    BatteryWidget.setBatterySignatureListener?.(null);

    for (const timeout of this._timeouts) {
      GLib.source_remove(timeout);
    };

    this._timeouts = [];

    if (this._batteryRefreshId) {
      GLib.source_remove(this._batteryRefreshId);
      this._batteryRefreshId = 0;
    };

    global.stage.disconnectObject(this);
    Main.layoutManager.disconnectObject(this);
    St.Settings.get().disconnectObject(this);
    this._interfaceSettings.disconnectObject(this);
    this._weatherSettings.disconnectObject(this);

    for (const id of this._dbusSignalIds) {
      Gio.DBus.system.signal_unsubscribe(id);
    };
    for (const id of this._sessionSignalIds) {
      Gio.DBus.session.signal_unsubscribe(id);
    };

    this._dbusSignalIds = [];
    this._sessionSignalIds = [];

    this._calendarUnsubscribe?.();
    this._calendarUnsubscribe = null;
    this._calendarData?.stop();
    this._calendarData = null;

    this._bambuUnsubscribe?.();
    this._bambuUnsubscribe = null;
    this._bambuData?.stop();
    this._bambuData = null;

    this._cancelActiveDrag();

    this._destroyIndicator();

    this._clearWeatherInfo();

    for (const id of this._settingsSignals) {
      this._layoutSettings.disconnect(id);
    };

    this._settingsSignals = [];

    this._destroyLayer();
    this._layoutSettings = null;
    this._interfaceSettings = null;
    this._weatherSettings = null;
    this._extension = null;
  };

  _parseWidgets(serialized) {
    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed.widgets)) {
      return cloneDefaultWidgets();
    };

    return parsed.widgets
      .filter(widget => widget.id && widget.type)
      .filter(widget => WIDGET_TYPES.some(([type]) => type === widget.type))
      .map(widget => {
        const size = WIDGET_SIZES[widget.size] ? widget.size : 'small';
        const [defaultWidth, defaultHeight] = WIDGET_SIZES[size];
        const savedWidth = Number.isFinite(widget.width) ? widget.width : defaultWidth;
        const savedHeight = Number.isFinite(widget.height) ? widget.height : defaultHeight;

        const parsed = {
          id: String(widget.id),
          type: String(widget.type),
          size,
          width: size === 'medium' && [440, 460].includes(savedWidth) ? defaultWidth : savedWidth,
          height: [210, 440].includes(savedHeight) ? defaultHeight : savedHeight,
          x: Number.isFinite(widget.x) ? widget.x : 24,
          y: Number.isFinite(widget.y) ? widget.y : 80,
          hidden: widget.hidden === true,
          data: widget.data && typeof widget.data === 'object' ? widget.data : {},
        };

        if (Number.isFinite(widget.fx) && Number.isFinite(widget.fy)) {
          parsed.fx = clamp(widget.fx, 0, 1);
          parsed.fy = clamp(widget.fy, 0, 1);
        };

        const monitor = this._monitor();

        if (monitor) {
          if (!Number.isFinite(parsed.fx) || !Number.isFinite(parsed.fy)) {
            const fractions = widgetFractions(parsed, monitor);
            parsed.fx = fractions.fx;
            parsed.fy = fractions.fy;
          };

          const position = positionForFractions(parsed, monitor);
          parsed.x = position.x;
          parsed.y = position.y;
        };

        return parsed;
      });
  };

  _loadWidgets() {
    const serialized = this._layoutSettings.get_string(LAYOUT_KEY);

    return serialized ? this._parseWidgets(serialized) : cloneDefaultWidgets();
  };

  _saveWidgets() {
    const monitor = this._monitor();

    if (monitor) {
      for (const widget of this._widgets) {
        const fractions = widgetFractions(widget, monitor);

        widget.fx = fractions.fx;
        widget.fy = fractions.fy;
      };
    };

    const serialized = JSON.stringify({widgets: this._widgets});

    this._lastLayoutJson = serialized;
    this._layoutSettings.set_string(LAYOUT_KEY, serialized);
  };

  _clearViews() {
    for (const view of this._views.values()) {
      view.actor.disconnectObject(this);
    };

    this._views.clear();
  };

  _destroyLayer() {
    this._workspaceIntegration.setSource(null);
    this._cancelActiveDrag();
    this._clearViews();
    this._layer?.destroy();
    this._layer = null;
  };

  _createLayer() {
    const backgroundGroup = Main.layoutManager._backgroundGroup;

    if (!backgroundGroup) {
      warn('background-group-missing', 'Could not find GNOME Shell background group');
      return;
    };

    this._destroyLayer();

    this._layer = new St.Widget({
      style_class: 'widget-layer',
      reactive: true,
      x_expand: true,
      y_expand: true,
    });

    backgroundGroup.add_child(this._layer);
    raiseActor(this._layer);
    this._syncLayerGeometry();
    this._workspaceIntegration.setSource(this._layer);
  };

  _anchorWidgets() {
    const monitor = this._monitor();

    if (!monitor) {
      return;
    };

    for (const widget of this._widgets) {
      const position = positionForFractions(widget, monitor);

      widget.x = position.x;
      widget.y = position.y;
    };
  };

  _syncLayerGeometry() {
    const monitor = this._monitor();

    if (!monitor || !this._layer) {
      return;
    };

    this._layer.set_position(monitor.x, monitor.y);
    this._layer.set_size(monitor.width, monitor.height);
    raiseActor(this._layer);
    this._anchorWidgets();
    this._resolveLayout(null, false, false);

    this._workspaceIntegration.queueSync();
  };

  _gnomeTheme() {
    const dark = darkStyleEnabled(this._interfaceSettings);

    return {
      dark,
      accent: accentColor(this._interfaceSettings),
      background: dark ? '#242424' : '#ffffff',
      border: dark ? '#3d3d3d' : '#deddda',
      text: dark ? '#ffffff' : '#241f31',
      muted: dark ? '#c0bfbc' : '#5e5c64',
      glassStart: dark ? 'rgba(48, 50, 62, 0.55)' : 'rgba(255, 255, 255, 0.50)',
      glassEnd: dark ? 'rgba(22, 23, 30, 0.38)' : 'rgba(255, 255, 255, 0.20)',
      glassBorder: dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.70)',
      glassHighlight: dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.90)',
      glassShadow: dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(15, 23, 42, 0.22)',
    };
  };

  _glassStyle(theme) {
    return [
      'background-gradient-direction: vertical;',
      `background-gradient-start: ${theme.glassStart};`,
      `background-gradient-end: ${theme.glassEnd};`,
      `border: 1px solid ${theme.glassBorder};`,
      `box-shadow: 0 12px 32px ${theme.glassShadow}, inset 0 1px 0 ${theme.glassHighlight};`,
    ].join(' ');
  };

  _editBorderStyle() {
    const accent = this._gnomeTheme().accent;

    return `border: 2px solid ${accent}; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16), 0 0 20px ${hexToRgba(accent, 0.55)};`;
  };

  _styleForWidget(widget) {
    const theme = this._gnomeTheme();
    const widgetModule = WIDGETS.get(widget.type);
    const specific = widgetModule?.style ? widgetModule.style(theme) : '';
    const base = `${this._glassStyle(theme)} ${specific}`;

    if (!this._editMode) {
      return base;
    };

    return `${base} ${this._editBorderStyle()}`;
  };

  _clearWeatherInfo() {
    const info = this._weatherInfo;

    this._weatherInfo = null;
    this._weatherUpdating = false;

    if (info) {
      info.disconnectObject(this);
      info.abort();
    };
  };

  _refreshWeather(force = false) {
    const now = Date.now();

    if (this._weatherUpdating && !force) {
      return;
    };

    if (!force && now - this._weatherUpdateTime < WeatherWidget.cacheTtlMs) {
      return;
    };

    const location = WeatherWidget.locationFromSettings(this._weatherSettings);
    const displayName = WeatherWidget.locationNameFromSettings(this._weatherSettings);
    this._weatherLocation = displayName;

    if (!location) {
      this._clearWeatherInfo();
      this._weather = null;
      this._weatherUpdateTime = now;
      return;
    };

    this._clearWeatherInfo();
    const info = WeatherWidget.infoForLocation(location);
    this._weatherInfo = info;
    this._weatherUpdating = true;

    info.connectObject('updated', () => {
      if (info !== this._weatherInfo) {
        return;
      };

      this._weatherUpdating = false;
      this._weatherUpdateTime = Date.now();

      if (info.is_valid()) {
        this._weather = WeatherWidget.weatherFromInfo(info, location, displayName);
      } else {
        this._weather = null;
      };

      this._refreshWeatherViews();
    }, this);

    info.update();
  };

  _refreshWeatherViews() {
    if (this._editMode) {
      return;
    };

    for (const view of this._views.values()) {
      if (view.widget.type === 'weather') {
        this._fillWidgetBody(view.widget, view.body);
      };
    };
  };

  _refreshBambuViews(force = false) {
    if (this._editMode || this._dragging) {
      return;
    };

    const key = this._bambuData?.renderKey?.() ?? null;

    if (!force && key !== null && key === this._bambuRenderKey) {
      return;
    };

    this._bambuRenderKey = key;

    for (const view of this._views.values()) {
      if (view.widget.type === 'bambu') {
        this._fillWidgetBody(view.widget, view.body);
      };
    };
  };

  _refreshBatteryViews() {
    if (this._editMode || this._dragging) {
      return;
    };

    let hasBattery = false;

    for (const view of this._views.values()) {
      if (view.widget.type === 'battery') {
        hasBattery = true;
        break;
      };
    };

    if (!hasBattery) {
      return;
    };

    const signature = BatteryWidget.batterySignature?.();

    if (signature == null) {
      return;
    };

    this._applyBatterySignature(signature);
  };

  _applyBatterySignature(signature) {
    if (this._editMode || this._dragging || signature === this._batterySignature) {
      return;
    };

    this._batterySignature = signature;

    for (const view of this._views.values()) {
      if (view.widget.type === 'battery') {
        this._fillWidgetBody(view.widget, view.body);
      };
    };
  };

  _scheduleBatteryRefresh() {
    if (this._batteryRefreshId) {
      return;
    };

    const elapsed = Date.now() - this._lastBatteryRefreshAt;
    const delay = Math.max(0, 2000 - elapsed);

    this._batteryRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._batteryRefreshId = 0;
      this._lastBatteryRefreshAt = Date.now();
      this._refreshBatteryViews();
      return GLib.SOURCE_REMOVE;
    });
  };

  _watchBatteryChanges() {
    const refresh = () => this._scheduleBatteryRefresh();
    const refreshBlueZ = (_connection, _sender, _objectPath, _interfaceName, _signalName, parameters) => {
      const [changedInterface] = parameters.deep_unpack();

      if (['org.bluez.Device1', 'org.bluez.Battery1'].includes(changedInterface)) {
        refresh();
      };
    };

    this._dbusSignalIds.push(
      Gio.DBus.system.signal_subscribe('org.freedesktop.UPower', 'org.freedesktop.UPower', 'DeviceAdded', '/org/freedesktop/UPower', null, Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.system.signal_subscribe('org.freedesktop.UPower', 'org.freedesktop.UPower', 'DeviceRemoved', '/org/freedesktop/UPower', null, Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.system.signal_subscribe('org.freedesktop.UPower', 'org.freedesktop.DBus.Properties', 'PropertiesChanged', null, 'org.freedesktop.UPower.Device', Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.system.signal_subscribe('org.bluez', 'org.freedesktop.DBus.ObjectManager', 'InterfacesAdded', '/', null, Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.system.signal_subscribe('org.bluez', 'org.freedesktop.DBus.ObjectManager', 'InterfacesRemoved', '/', null, Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.system.signal_subscribe('org.bluez', 'org.freedesktop.DBus.Properties', 'PropertiesChanged', null, null, Gio.DBusSignalFlags.NONE, refreshBlueZ)
    );
    this._sessionSignalIds.push(
      Gio.DBus.session.signal_subscribe('org.gnome.Shell.Extensions.GSConnect', 'org.gtk.Actions', 'Changed', null, null, Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.session.signal_subscribe('org.gnome.Shell.Extensions.GSConnect', 'org.freedesktop.DBus.ObjectManager', 'InterfacesAdded', '/org/gnome/Shell/Extensions/GSConnect', null, Gio.DBusSignalFlags.NONE, refresh),
      Gio.DBus.session.signal_subscribe('org.gnome.Shell.Extensions.GSConnect', 'org.freedesktop.DBus.ObjectManager', 'InterfacesRemoved', '/org/gnome/Shell/Extensions/GSConnect', null, Gio.DBusSignalFlags.NONE, refresh)
    );
  };

  _syncIndicator() {
    const show = this._layoutSettings.get_boolean('show-panel-icon');

    if (show && !this._indicator) {
      this._createIndicator();
    } else if (!show && this._indicator) {
      this._destroyIndicator();
    };
  };

  _destroyIndicator() {
    this._indicator?.destroy();
    this._indicator = null;
    this._editItem = null;
    this._hideItem = null;
  };

  _createIndicator() {
    this._indicator = new PanelMenu.Button(0.0, 'Desktop Widgets');
    this._indicator.add_child(new St.Icon({
      icon_name: 'view-grid-symbolic',
      style_class: 'widget-panel-icon',
    }));

    this._editItem = new PopupMenu.PopupSwitchMenuItem('Edit Widgets', this._editMode);
    this._editItem.connectObject('toggled', (_item, state) => {
      if (this._syncingMenu) {
        return;
      };

      this._layoutSettings.set_boolean('edit-mode', state);
    }, this);
    this._indicator.menu.addMenuItem(this._editItem);

    this._hideItem = new PopupMenu.PopupSwitchMenuItem('Hide All Widgets', this._layoutSettings.get_boolean('hide-all'));
    this._hideItem.connectObject('toggled', (_item, state) => {
      if (this._syncingMenu) {
        return;
      };

      this._layoutSettings.set_boolean('hide-all', state);
    }, this);
    this._indicator.menu.addMenuItem(this._hideItem);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    for (const [type, label] of WIDGET_TYPES) {
      const item = new PopupMenu.PopupMenuItem(`Add ${label}`);
      item.connectObject('activate', () => this.addWidget(type), this);
      this._indicator.menu.addMenuItem(item);
    };

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const resetItem = new PopupMenu.PopupMenuItem('Reset Default Widgets');
    resetItem.connectObject('activate', () => {
      this._widgets = cloneDefaultWidgets();
      this._saveWidgets();
      this._rebuildWidgets();
    }, this);

    this._indicator.menu.addMenuItem(resetItem);
    Main.panel.addToStatusArea(this._extension.uuid, this._indicator);
  };

  setEditMode(enabled) {
    this._cancelActiveDrag();
    this._editMode = enabled;
    this._applyEditMode();

    if (!enabled) {
      this._refreshWidgets();
    };
  };

  _applyEditMode() {
    for (const view of this._views.values()) {
      view.actor.set_style(this._styleForWidget(view.widget));

      if (this._editMode) {
        this._makeDraggable(view);
        this._addEditControls(view);

        if (view.removeButton) {
          view.removeButton.visible = view.actor.visible;
        };
      } else {
        if (view.draggable) {
          view.actor.disconnectObject(this);
          view.draggable = false;
        };

        this._removeEditControls(view);
      };
    };
  };

  _removeEditControls(view) {
    view.removeButton?.destroy();
    view.removeButton = null;
    view.removeButtonWidth = 0;
  };

  _applyVisibility() {
    const hideAll = this._layoutSettings.get_boolean('hide-all');

    for (const widget of this._widgets) {
      const shouldShow = !hideAll && !widget.hidden;
      const view = this._views.get(widget.id);

      if (shouldShow && !view) {
        this._createWidget(widget);
        continue;
      };

      if (!view) {
        continue;
      };

      view.actor.visible = shouldShow;

      if (view.removeButton) {
        view.removeButton.visible = shouldShow && this._editMode;
      };
    };
  };

  addWidget(type) {
    const widgetModule = WIDGETS.get(type);

    if (!widgetModule) {
      return;
    };

    const index = this._widgets.length;
    const size = WIDGET_SIZES[widgetModule.defaultSize] ? widgetModule.defaultSize : 'small';

    const widget = {
      id: `${type}-${Date.now()}`,
      type,
      size,
      x: snap(32 + (index % 4) * 240),
      y: snap(96 + Math.floor(index / 4) * 250),
      data: {},
    };

    const [width, height] = WIDGET_SIZES[widget.size] ?? WIDGET_SIZES.small;

    widget.width = width;
    widget.height = height;

    const position = this._findOpenPosition(widget, this._widgets);
    widget.x = position.x;
    widget.y = position.y;
    this._widgets.push(widget);

    this._saveWidgets();

    const hideAll = this._layoutSettings.get_boolean('hide-all');

    if (!hideAll && !widget.hidden) {
      this._createWidget(widget);
    };
  };

  removeWidget(id) {
    const view = this._views.get(id);

    this._widgets = this._widgets.filter(widget => widget.id !== id);
    this._saveWidgets();

    if (!view) {
      return;
    };

    this._cancelActiveDrag();
    this._removeEditControls(view);
    view.actor.disconnectObject(this);
    view.actor.destroy();
    this._views.delete(id);
  };

  _rebuildWidgets() {
    if (!this._layer) {
      return;
    };

    this._cancelActiveDrag();
    this._clearViews();
    this._layer.destroy_all_children();

    this._resolveLayout(null, false, true);

    const hideAll = this._layoutSettings.get_boolean('hide-all');

    for (const widget of this._widgets) {
      if (hideAll || widget.hidden) {
        continue;
      };

      this._createWidget(widget);
    };

    this._syncBambuPolling();
  };

  _refreshWidgets() {
    if (this._editMode) {
      return;
    };

    this._refreshWeather(false);
    this._refreshCalendarViews();
    this._refreshBatteryViews();
    this._refreshBambuViews();
    this._pruneStaleViews();
  };

  _pruneStaleViews() {
    for (const [id, view] of this._views) {
      try {
        if (view.actor.get_parent() !== this._layer || view.body.get_parent() !== view.actor) {
          view.actor.disconnectObject(this);
          this._views.delete(id);
        };
      } catch (error) {
        warn('stale-widget-view', `Dropping stale widget view: ${error.message}`);
        view.actor.disconnectObject(this);
        this._views.delete(id);
      };
    };
  };

  _refreshCalendarViews(force = false) {
    const now = new Date();
    const signature = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    if (!force && signature === this._calendarSignature) {
      return;
    };

    this._calendarSignature = signature;

    for (const view of this._views.values()) {
      if (view.widget.type === 'calendar' || view.widget.type === 'agenda') {
        this._fillWidgetBody(view.widget, view.body);
      };
    };
  };

  _createWidget(widget) {
    const [width, height] = sizeForWidget(widget);
    const actorParams = {
      orientation: Clutter.Orientation.VERTICAL,
      style_class: `widget widget-${widget.type}`,
      reactive: true,
      can_focus: true,
      track_hover: true,
    };
    const style = this._styleForWidget(widget);

    if (style) {
      actorParams.style = style;
    };

    const actor = new St.BoxLayout(actorParams);

    actor.set_size(width, height);
    actor.set_position(widget.x, widget.y);

    const body = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      style_class: 'widget-body',
      x_expand: true,
      y_expand: true,
    });
    actor.add_child(body);

    actor.set_opacity(Math.round(this._widgetOpacity() * 2.55));

    this._layer.add_child(actor);
    const view = {
      widget,
      actor,
      body,
      removeButton: null,
      removeButtonWidth: 0,
    };
    this._views.set(widget.id, view);

    if (this._editMode) {
      this._makeDraggable(view);
      this._addEditControls(view);
    };

    this._fillWidgetBody(widget, body);
  };

  _removeButtonPosition(widget, view) {
    const [width] = sizeForWidget(widget);
    const buttonWidth = view.removeButtonWidth || 24;

    return {
      x: widget.x + width - buttonWidth - 8,
      y: widget.y + 8,
    };
  };

  _positionRemoveButton(view) {
    if (!view.removeButton) {
      return;
    };

    const button = this._removeButtonPosition(view.widget, view);

    view.removeButton.set_position(button.x, button.y);
  };

  _syncEditControls(widget, animate = false) {
    const view = this._views.get(widget.id);

    if (!view?.removeButton) {
      return;
    };

    const button = this._removeButtonPosition(widget, view);

    if (animate) {
      view.removeButton.ease({
        x: button.x,
        y: button.y,
        duration: 130,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    } else {
      view.removeButton.set_position(button.x, button.y);
    };

    raiseActor(view.removeButton);
  };

  _addEditControls(view) {
    if (view.removeButton) {
      this._syncEditControls(view.widget);
      return;
    };

    const removeButton = new St.Button({
      style_class: 'icon-button',
      icon_name: 'window-close-symbolic',
      reactive: true,
      can_focus: true,
      track_hover: true,
      accessible_name: 'Remove widget',
    });

    this._layer.add_child(removeButton);
    removeButton.ensure_style();
    const [, buttonWidth] = removeButton.get_preferred_width(-1);

    removeButton.connectObject('clicked', () => this.removeWidget(view.widget.id), this);

    view.removeButton = removeButton;
    view.removeButtonWidth = buttonWidth;
    this._syncEditControls(view.widget);
  };

  _openWidgetApp(type) {
    for (const appId of WIDGET_APP_IDS[type] ?? []) {
      if (!desktopAppExists(appId)) {
        continue;
      };

      GLib.spawn_command_line_async(`gtk-launch ${appId}`);
      return;
    };
  };

  _actorIsDescendantOf(actor, ancestor) {
    for (let current = actor; current; current = current.get_parent()) {
      if (current === ancestor) {
        return true;
      };
    }

    return false;
  };

  _viewForPickedActor(actor) {
    if (!actor) {
      return null;
    };

    for (const view of this._views.values()) {
      if (!WIDGET_APP_IDS[view.widget.type]) {
        continue;
      };

      if (this._actorIsDescendantOf(actor, view.actor)) {
        return view;
      };
    };

    return null;
  };

  _viewForStagePoint(stageX, stageY) {
    for (const view of this._views.values()) {
      if (!WIDGET_APP_IDS[view.widget.type]) {
        continue;
      };

      const [actorX, actorY] = view.actor.get_transformed_position();
      const [actorWidth, actorHeight] = view.actor.get_transformed_size();

      if (stageX >= actorX && stageX <= actorX + actorWidth && stageY >= actorY && stageY <= actorY + actorHeight) {
        return view;
      };
    };

    return null;
  };

  _pickedActorIsOnDesktop(actor) {
    const backgroundGroup = Main.layoutManager._backgroundGroup;

    return this._actorIsDescendantOf(actor, this._layer) || this._actorIsDescendantOf(actor, backgroundGroup);
  };

  _handleAppClickEvent(event) {
    if (this._editMode || event.type() !== Clutter.EventType.BUTTON_RELEASE) {
      return Clutter.EVENT_PROPAGATE;
    };

    if ((event.get_button() ?? 1) !== 1) {
      return Clutter.EVENT_PROPAGATE;
    };

    const [stageX, stageY] = event.get_coords();
    const pickedActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, stageX, stageY);
    const view = this._viewForPickedActor(pickedActor) ??
      (this._pickedActorIsOnDesktop(pickedActor) ? this._viewForStagePoint(stageX, stageY) : null);

    if (!view) {
      return Clutter.EVENT_PROPAGATE;
    };

    const now = Date.now();

    if (now - this._lastAppLaunchAt > 500) {
      this._lastAppLaunchAt = now;
      this._openWidgetApp(view.widget.type);
    };

    return Clutter.EVENT_STOP;
  };

  _makeDraggable(view) {
    if (view.draggable) {
      return;
    };

    view.draggable = true;

    const {actor, widget} = view;
    let drag = null;

    const finishDrag = () => {
      if (!drag) {
        return;
      };

      drag = null;
      this._dragging = false;
      this._clampWidget(widget);
      this._resolveLayout(widget, true, false);
      this._animateWidget(widget, true);
      this._cancelActiveDrag();
      this._saveWidgets();
    };

    const moveDrag = event => {
      if (!drag) {
        return;
      };

      const [stageX, stageY] = event.get_coords();
      const [width, height] = sizeForWidget(widget);
      const monitor = this._monitor();

      if (!monitor) {
        return;
      };

      const minY = Main.panel?.height ? Main.panel.height + WIDGET_GAP : WIDGET_GAP;
      const x = clamp(drag.actorX + stageX - drag.stageX, WIDGET_GAP, Math.max(WIDGET_GAP, monitor.width - width - WIDGET_GAP));
      const y = clamp(drag.actorY + stageY - drag.stageY, minY, Math.max(minY, monitor.height - height - WIDGET_GAP));

      if (x === widget.x && y === widget.y) {
        return;
      };

      widget.x = x;
      widget.y = y;
      actor.set_position(x, y);
      this._positionRemoveButton(view);
    };

    actor.connectObject('button-press-event', (_source, event) => {
      if (event.get_button() !== 1) {
        return Clutter.EVENT_PROPAGATE;
      };

      if (!this._editMode) {
        return Clutter.EVENT_PROPAGATE;
      };

      this._cancelActiveDrag();

      const [stageX, stageY] = event.get_coords();
      drag = {
        stageX,
        stageY,
        actorX: widget.x,
        actorY: widget.y,
      };

      raiseActor(actor);
      this._syncEditControls(widget);

      this._dragging = true;
      this._dragActor = actor;
      global.stage.connectObject('captured-event', (_stage, capturedEvent) => {
        if (!drag) {
          return Clutter.EVENT_PROPAGATE;
        };

        const eventType = capturedEvent.type();
        const isMotion = eventType === Clutter.EventType.MOTION || eventType === Clutter.EventType.MOTION_NOTIFY;
        const isRelease = eventType === Clutter.EventType.BUTTON_RELEASE;

        if (isMotion) {
          moveDrag(capturedEvent);
          return Clutter.EVENT_STOP;
        };

        if (isRelease) {
          finishDrag();
          return Clutter.EVENT_STOP;
        };

        return Clutter.EVENT_PROPAGATE;
      }, actor);

      return Clutter.EVENT_STOP;
    }, this);
  };

  _cancelActiveDrag() {
    this._dragging = false;

    if (!this._dragActor) {
      return;
    };

    global.stage.disconnectObject(this._dragActor);
    this._dragActor = null;
  };

  _animationsEnabled() {
    try {
      return St.Settings.get().enable_animations;
    } catch (error) {
      return true;
    };
  };

  _fillWidgetBody(widget, body) {
    const widgetModule = WIDGETS.get(widget.type);

    if (!widgetModule?.render && !widgetModule?.reconcile) {
      body.destroy_all_children();
      body.add_child(this._label('Unknown widget', 'widget-text'));
      return;
    };

    const params = {
      body,
      widget,
      theme: this._gnomeTheme(),
      weather: this._weather,
      weatherLocation: this._weatherLocation,
      calendar: this._calendarData,
      bambu: this._bambuData,
      createLabel: this._label.bind(this),
      sizeForWidget,
      settings: this._layoutSettings,
      animate: this._animationsEnabled(),
    };

    if (widgetModule.reconcile) {
      widgetModule.reconcile(params);
      return;
    };

    body.destroy_all_children();
    widgetModule.render(params);
  };

  _label(text, styleClass, style = null) {
    const params = {
      text,
      style_class: styleClass,
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
    };

    if (style) {
      params.style = style;
    };

    const label = new St.Label(params);

    label.clutter_text.set_line_wrap(true);
    label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

    return label;
  };

  _clampWidget(widget) {
    const monitor = this._monitor();

    if (!monitor) {
      return false;
    };

    let [width, height] = sizeForWidget(widget);
    const oldWidth = width;
    const oldHeight = height;
    const minY = Main.panel?.height ? Main.panel.height + WIDGET_GAP : WIDGET_GAP;
    width = clamp(Math.round(width), MIN_WIDGET_WIDTH, Math.max(MIN_WIDGET_WIDTH, monitor.width - WIDGET_GAP * 2));
    height = clamp(Math.round(height), MIN_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, monitor.height - minY - WIDGET_GAP));
    const x = clamp(snap(widget.x), WIDGET_GAP, Math.max(WIDGET_GAP, monitor.width - width - WIDGET_GAP));
    const y = clamp(snap(widget.y), minY, Math.max(minY, monitor.height - height - WIDGET_GAP));

    if (x === widget.x && y === widget.y && width === oldWidth && height === oldHeight) {
      return false;
    };

    widget.x = x;
    widget.y = y;
    widget.width = width;
    widget.height = height;

    return true;
  };

  _animateWidget(widget, animate) {
    const view = this._views.get(widget.id);

    if (!view) {
      return;
    };

    if (!animate) {
      view.actor.set_position(widget.x, widget.y);
      view.actor.set_size(widget.width, widget.height);
      this._syncEditControls(widget);
      return;
    };

    view.actor.ease({
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      duration: 130,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });

    this._syncEditControls(widget, true);
  };

  _positionIsFreeAgainst(widget, x, y, blockingWidgets) {
    const [width, height] = sizeForWidget(widget);
    const rect = {x, y, width, height};

    return !blockingWidgets.some(other => other !== widget && rectsOverlap(rect, rectForWidget(other)));
  };

  _findOpenPosition(widget, blockingWidgets = []) {
    const monitor = this._monitor();

    if (!monitor) {
      return {x: widget.x, y: widget.y};
    };

    const [width, height] = sizeForWidget(widget);
    const minX = WIDGET_GAP;
    const minY = Main.panel?.height ? Main.panel.height + WIDGET_GAP : WIDGET_GAP;
    const maxX = Math.max(minX, monitor.width - width - WIDGET_GAP);
    const maxY = Math.max(minY, monitor.height - height - WIDGET_GAP);
    const originX = clamp(snap(widget.x), minX, maxX);
    const originY = clamp(snap(widget.y), minY, maxY);
    const candidates = [];

    for (let y = minY; y <= maxY; y += GRID_SIZE) {
      for (let x = minX; x <= maxX; x += GRID_SIZE) {
        const snappedX = clamp(snap(x), minX, maxX);
        const snappedY = clamp(snap(y), minY, maxY);
        const distance = Math.abs(snappedX - originX) + Math.abs(snappedY - originY);
        candidates.push({x: snappedX, y: snappedY, distance});
      };
    };

    candidates.sort((a, b) => a.distance - b.distance);

    for (const candidate of candidates) {
      if (this._positionIsFreeAgainst(widget, candidate.x, candidate.y, blockingWidgets)) {
        return {x: candidate.x, y: candidate.y};
      };
    };

    return {x: originX, y: originY};
  };

  _resolveLayout(anchor = null, animate = false, save = false) {
    const orderedWidgets = anchor
      ? [anchor, ...this._widgets.filter(widget => widget !== anchor)]
      : [...this._widgets];
    const settled = [];
    let changed = false;

    for (const widget of orderedWidgets) {
      const oldX = widget.x;
      const oldY = widget.y;
      const oldWidth = widget.width;
      const oldHeight = widget.height;

      this._clampWidget(widget);

      if (settled.some(other => rectsOverlap(rectForWidget(widget), rectForWidget(other)))) {
        const position = this._findOpenPosition(widget, settled);
        widget.x = position.x;
        widget.y = position.y;
        this._clampWidget(widget);
      };

      settled.push(widget);

      if (widget.x !== oldX || widget.y !== oldY || widget.width !== oldWidth || widget.height !== oldHeight) {
        changed = true;
        this._animateWidget(widget, animate);
      };
    };

    if (changed && save) {
      this._saveWidgets();
    };

    return changed;
  };
};

export default class DesktopWidgetsExtension extends Extension {
  _loadWidgetStylesheets() {
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    this._widgetStylesheets = [];

    for (const widgetModule of WIDGET_MODULES) {
      if (!widgetModule.stylesheet) {
        continue;
      };

      const file = Gio.File.new_for_path(GLib.build_filenamev([EXTENSION_PATH, widgetModule.stylesheet]));

      if (!file.query_exists(null)) {
        continue;
      };

      theme.load_stylesheet(file);
      this._widgetStylesheets.push(file);
    };
  };

  _unloadWidgetStylesheets() {
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();

    for (const file of this._widgetStylesheets ?? []) {
      theme.unload_stylesheet(file);
    };

    this._widgetStylesheets = [];
  };

  enable() {
    configureLogger(this.getLogger());
    this._loadWidgetStylesheets();
    this._controller = new WidgetController(this);
    this._controller.enable();
  };

  disable() {
    this._controller?.destroy();
    this._controller = null;
    PhotosWidget.cleanup();
    this._unloadWidgetStylesheets();
    resetLogger();
  };
};
