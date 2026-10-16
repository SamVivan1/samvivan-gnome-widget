import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { warn } from '../../logger.js';

export const type = 'battery';
export function label() { return _('Battery'); };
export const stylesheet = 'widgets/battery/stylesheet.css';
export const defaultSize = 'medium';

const MAX_GAUGE_SIZE = 320;
const MIN_GAUGE_SIZE = 36;
const SLOT_GAP = 12;
const MAX_SLOTS = 8;
const TEXT_SLOT_LIMIT = 4;
const MIN_TEXT_GAUGE = 52;
const WIDGET_PADDING = 30;
const LAYOUT_MARGIN = 18;
const FALLBACK_WIDGET_WIDTH = 454;
const FALLBACK_WIDGET_HEIGHT = 190;
const SLOT_SPACING = 6;
const PERCENT_TEXT_RATIO = 0.4;
const NAME_TEXT_RATIO = 0.2;
const PERCENT_FONT_RATIO = 0.29;
const NAME_FONT_RATIO = 0.15;
const HORIZONTAL_PERCENT_RATIO = 0.27;
const HORIZONTAL_NAME_RATIO = 0.15;
const HORIZONTAL_TEXT_SAFETY = 1.15;
const HORIZONTAL_CHAR_WIDTH = 0.64;
const HORIZONTAL_GAP = 16;
const MIN_TEXT_WIDTH = 56;
const NAME_MIN_FONT = 10;

const DEVICE_TYPE = {
	BATTERY: 2,
	UPS: 3,
	MOUSE: 5,
	KEYBOARD: 6,
	PDA: 7,
	PHONE: 8,
	MEDIA_PLAYER: 9,
	TABLET: 10,
	COMPUTER: 11,
	GAMING_INPUT: 12,
	PEN: 13,
	TOUCHPAD: 14,
	HEADSET: 17,
	SPEAKERS: 18,
	HEADPHONES: 19,
	OTHER_AUDIO: 21,
};

function fallbackNameForKind(kind) {
	switch (kind) {
		case DEVICE_TYPE.BATTERY: return _('Battery');
		case DEVICE_TYPE.UPS: return _('UPS');
		case DEVICE_TYPE.MOUSE: return _('Mouse');
		case DEVICE_TYPE.KEYBOARD: return _('Keyboard');
		case DEVICE_TYPE.PDA: return _('PDA');
		case DEVICE_TYPE.PHONE: return _('Phone');
		case DEVICE_TYPE.MEDIA_PLAYER: return _('Media Player');
		case DEVICE_TYPE.TABLET: return _('Tablet');
		case DEVICE_TYPE.COMPUTER: return _('Computer');
		case DEVICE_TYPE.GAMING_INPUT: return _('Gamepad');
		case DEVICE_TYPE.PEN: return _('Stylus');
		case DEVICE_TYPE.TOUCHPAD: return _('Touchpad');
		case DEVICE_TYPE.HEADSET: return _('Headset');
		case DEVICE_TYPE.SPEAKERS: return _('Speakers');
		case DEVICE_TYPE.HEADPHONES: return _('Headphones');
		case DEVICE_TYPE.OTHER_AUDIO: return _('Audio Device');
		default: return _('Device');
	};
};

function fallbackNameForBluetoothIcon(iconClass) {
	const name = String(iconClass || '').toLowerCase();

	if (!name || name === 'unknown') {
		return null;
	};
	if (name.includes('mouse')) {
		return _('Mouse');
	};
	if (name.includes('keyboard')) {
		return _('Keyboard');
	};
	if (name.includes('tablet') || name.includes('pen')) {
		return _('Tablet');
	};
	if (name.includes('gaming') || name.includes('joystick') || name.includes('gamepad')) {
		return _('Gamepad');
	};
	if (name.includes('headset')) {
		return _('Headset');
	};
	if (name.includes('headphone')) {
		return _('Headphones');
	};
	if (name.includes('speaker') || name.includes('audio-card') || name.includes('audio')) {
		return _('Speakers');
	};
	if (name.includes('phone')) {
		return _('Phone');
	};
	if (name.includes('computer')) {
		return _('Computer');
	};

	return null;
};

function variantValue(props, name, fallback = null) {
	return props[name] ? props[name].deep_unpack() : fallback;
};

function batteryColor(percentage) {
	if (percentage <= 20) {
		return [0.93, 0.21, 0.25];
	};
	if (percentage <= 40) {
		return [0.95, 0.68, 0.19];
	};

	return [0.34, 0.89, 0.54];
};

function normalizeName(name) {
	return String(name || '').trim().toLowerCase();
};

function bluezIconName(iconName) {
	if (!iconName) {
		return 'bluetooth-symbolic';
	};

	return iconName.endsWith('-symbolic') ? iconName : `${iconName}-symbolic`;
};

function iconForDevice(device) {
	if (!device) {
		return 'battery-missing-symbolic';
	};

	if (device.iconName && ['bluez', 'gsconnect'].includes(device.source)) {
		return device.iconName;
	};

	switch (device.kind) {
		case DEVICE_TYPE.BATTERY:
		case DEVICE_TYPE.COMPUTER:
			return device.powerSupply ? 'computer-symbolic' : 'battery-symbolic';
		case DEVICE_TYPE.MOUSE:
		case DEVICE_TYPE.GAMING_INPUT:
			return 'input-mouse-symbolic';
		case DEVICE_TYPE.KEYBOARD:
			return 'input-keyboard-symbolic';
		case DEVICE_TYPE.PHONE:
		case DEVICE_TYPE.PDA:
			return 'phone-symbolic';
		case DEVICE_TYPE.TABLET:
		case DEVICE_TYPE.PEN:
		case DEVICE_TYPE.TOUCHPAD:
			return 'input-tablet-symbolic';
		case DEVICE_TYPE.HEADSET:
			return 'audio-headset-symbolic';
		case DEVICE_TYPE.HEADPHONES:
		case DEVICE_TYPE.OTHER_AUDIO:
			return 'audio-headphones-symbolic';
		case DEVICE_TYPE.SPEAKERS:
			return 'audio-speakers-symbolic';
		case DEVICE_TYPE.UPS:
			return 'battery-symbolic';
		default:
			return device.iconName || 'battery-symbolic';
	};
};

function deviceName(props, kind) {
	const model = String(variantValue(props, 'Model', '')).trim();
	const vendor = String(variantValue(props, 'Vendor', '')).trim();

	if (model) {
		return model;
	};
	if (vendor) {
		return vendor;
	};

	return fallbackNameForKind(kind);
};

function isBatteryLike(props) {
	const kind = variantValue(props, 'Type', 0);
	const percentage = Number(variantValue(props, 'Percentage', Number.NaN));
	const rechargeable = variantValue(props, 'IsRechargeable', false);
	const present = variantValue(props, 'IsPresent', true);

	if (!present || !Number.isFinite(percentage)) {
		return false;
	};

	return rechargeable || [
		DEVICE_TYPE.BATTERY,
		DEVICE_TYPE.UPS,
		DEVICE_TYPE.MOUSE,
		DEVICE_TYPE.KEYBOARD,
		DEVICE_TYPE.PDA,
		DEVICE_TYPE.PHONE,
		DEVICE_TYPE.MEDIA_PLAYER,
		DEVICE_TYPE.TABLET,
		DEVICE_TYPE.COMPUTER,
		DEVICE_TYPE.GAMING_INPUT,
		DEVICE_TYPE.PEN,
		DEVICE_TYPE.TOUCHPAD,
		DEVICE_TYPE.HEADSET,
		DEVICE_TYPE.SPEAKERS,
		DEVICE_TYPE.HEADPHONES,
		DEVICE_TYPE.OTHER_AUDIO,
	].includes(kind);
};

const DBUS_TIMEOUT_MS = 1000;

function dbusCall(bus, busName, objectPath, interfaceName, method, params = null, timeout = DBUS_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		bus.call(
			busName,
			objectPath,
			interfaceName,
			method,
			params,
			null,
			Gio.DBusCallFlags.NONE,
			timeout,
			null,
			(source, result) => {
				try {
					resolve(source.call_finish(result));
				} catch (error) {
					reject(error);
				};
			});
	});
};

async function readUPowerDevices() {
	try {
		const reply = await dbusCall(
			Gio.DBus.system,
			'org.freedesktop.UPower',
			'/org/freedesktop/UPower',
			'org.freedesktop.UPower',
			'EnumerateDevices');
		const [paths] = reply.deep_unpack();
		const devices = [];

		for (const path of paths) {
			let props;

			try {
				const deviceReply = await dbusCall(
					Gio.DBus.system,
					'org.freedesktop.UPower',
					path,
					'org.freedesktop.DBus.Properties',
					'GetAll',
					GLib.Variant.new('(s)', ['org.freedesktop.UPower.Device']));
				[props] = deviceReply.deep_unpack();
			} catch (error) {
				continue;
			};

			if (!isBatteryLike(props)) {
				continue;
			};

			const kind = variantValue(props, 'Type', 0);
			const percentage = Math.round(Math.max(0, Math.min(100, Number(variantValue(props, 'Percentage', 0)))));

			devices.push({
				source: 'upower',
				name: deviceName(props, kind),
				kind,
				percentage,
				powerSupply: variantValue(props, 'PowerSupply', false),
				iconName: variantValue(props, 'IconName', null),
				nativePath: variantValue(props, 'NativePath', null),
				path,
			});
		};

		return devices;
	} catch (error) {
		warn('upower-read', `Could not read UPower batteries: ${error.message}`);
		return [];
	};
};

async function readBlueZDevices() {
	try {
		const reply = await dbusCall(
			Gio.DBus.system,
			'org.bluez',
			'/',
			'org.freedesktop.DBus.ObjectManager',
			'GetManagedObjects');
		const [objects] = reply.deep_unpack();
		const devices = [];

		for (const [path, interfaces] of Object.entries(objects)) {
			const deviceProps = interfaces['org.bluez.Device1'];
			const batteryProps = interfaces['org.bluez.Battery1'];

			if (!deviceProps || !batteryProps || !variantValue(deviceProps, 'Connected', false)) {
				continue;
			};

			const percentage = Number(variantValue(batteryProps, 'Percentage', Number.NaN));

			if (!Number.isFinite(percentage)) {
				continue;
			};

			const iconClass = variantValue(deviceProps, 'Icon', null);
			const iconName = bluezIconName(iconClass);
			const alias = String(variantValue(deviceProps, 'Alias', '') || variantValue(deviceProps, 'Name', '') || '').trim();

			devices.push({
				source: 'bluez',
				name: alias || fallbackNameForBluetoothIcon(iconClass) || _('Bluetooth Device'),
				percentage: Math.round(Math.max(0, Math.min(100, percentage))),
				powerSupply: false,
				iconName,
				nativePath: path,
			});
		};

		return devices;
	} catch (error) {
		warn('bluez-read', `Could not read Bluetooth batteries: ${error.message}`);
		return [];
	};
};

const GSCONNECT_BUS_NAME = 'org.gnome.Shell.Extensions.GSConnect';
const GSCONNECT_ROOT_PATH = '/org/gnome/Shell/Extensions/GSConnect';
const GSCONNECT_DEVICE_IFACE = 'org.gnome.Shell.Extensions.GSConnect.Device';

async function gsconnectBattery(path) {
	try {
		const reply = await dbusCall(
			Gio.DBus.session,
			GSCONNECT_BUS_NAME,
			path,
			'org.gtk.Actions',
			'Describe',
			GLib.Variant.new('(s)', ['battery']));
		const [[enabled, , states]] = reply.recursiveUnpack();
		const state = Array.isArray(states) ? states[0] : null;

		if (!enabled || !Array.isArray(state)) {
			return null;
		};

		return {
			level: Number(state[2]),
			charging: Boolean(state[0]),
		};
	} catch (error) {
		return null;
	};
};

async function readGSConnectDevices() {
	try {
		const reply = await dbusCall(
			Gio.DBus.session,
			GSCONNECT_BUS_NAME,
			GSCONNECT_ROOT_PATH,
			'org.freedesktop.DBus.ObjectManager',
			'GetManagedObjects');
		const [objects] = reply.deep_unpack();
		const devices = [];

		for (const [path, interfaces] of Object.entries(objects)) {
			const deviceProps = interfaces[GSCONNECT_DEVICE_IFACE];

			if (!deviceProps || !variantValue(deviceProps, 'Connected', false)) {
				continue;
			};

			const battery = await gsconnectBattery(path);

			if (!battery || !Number.isFinite(battery.level) || battery.level < 0) {
				continue;
			};

			const name = String(variantValue(deviceProps, 'Name', '') || '').trim();

			devices.push({
				source: 'gsconnect',
				name: name || _('Phone'),
				kind: DEVICE_TYPE.PHONE,
				percentage: Math.round(Math.max(0, Math.min(100, battery.level))),
				powerSupply: false,
				iconName: variantValue(deviceProps, 'IconName', null) || 'phone-symbolic',
				nativePath: path,
			});
		};

		return devices;
	} catch (error) {
		warn('gsconnect-read', `Could not read GSConnect batteries: ${error.message}`);
		return [];
	};
};

function deviceKey(device) {
	// Prefer the D-Bus object path: two identical mice report the same
	// name but live at different paths, and collapsing them hides one.
	const id = String(device.path || device.nativePath || '');

	if (id.startsWith('/')) {
		return id;
	};

	return normalizeName(device.name);
};

function mergeDevices(devices) {
	const merged = new Map();

	for (const device of devices) {
		const key = deviceKey(device);
		const existing = merged.get(key);

		if (!existing || (existing.source !== 'upower' && device.source === 'upower')) {
			merged.set(key, device);
		};
	};

	return [...merged.values()].sort((a, b) => Number(b.powerSupply) - Number(a.powerSupply) || a.name.localeCompare(b.name));
};

const DEVICES_CACHE_MS = 2000;
const DBUS_REFRESH_MIN_MS = 750;
let devicesCache = null;
let devicesFetch = null;
let devicesFetchStarted = 0;

function cachedDevices() {
	return devicesCache ? devicesCache.devices : [];
};

function devicesAreStale() {
	return !devicesCache || Date.now() - devicesCache.time >= DEVICES_CACHE_MS;
};

function devicesSignature(devices) {
	return devices.map(device => [
		device.name,
		device.kind ?? '',
		device.percentage,
		device.powerSupply ? 1 : 0,
		device.iconName ?? '',
	].join(':')).join('|');
};

let devicesSignatureListener = null;

export function setBatterySignatureListener(listener) {
	devicesSignatureListener = listener;
};

function refreshDevices() {
	const now = Date.now();

	if (devicesFetch) {
		return devicesFetch;
	};

	if (devicesCache && now - devicesFetchStarted < DBUS_REFRESH_MIN_MS) {
		return Promise.resolve(devicesCache.devices);
	};

	devicesFetchStarted = now;
	devicesFetch = (async () => {
		try {
			const devices = mergeDevices([
				...(await readUPowerDevices()),
				...(await readBlueZDevices()),
				...(await readGSConnectDevices()),
			]);

			devicesCache = {time: Date.now(), devices};

			if (devicesSignatureListener) {
				devicesSignatureListener(devicesSignature(devices));
			};

			return devices;
		} catch (error) {
			warn('devices-read', `Could not read device batteries: ${error.message}`);
			return cachedDevices();
		} finally {
			devicesFetch = null;
		};
	})();

	return devicesFetch;
};

let deviceOrder = [];

function orderDevices(devices) {
	const present = new Set(devices.map(deviceKey));

	for (const device of devices) {
		const key = deviceKey(device);

		if (!deviceOrder.includes(key)) {
			deviceOrder.push(key);
		};
	};

	deviceOrder = deviceOrder.filter(key => present.has(key));

	const index = new Map(deviceOrder.map((key, order) => [key, order]));

	return [...devices].sort((a, b) => index.get(deviceKey(a)) - index.get(deviceKey(b)));
};

export function batterySignature() {
	refreshDevices();
	return devicesSignature(cachedDevices());
};

const BatteryRing = GObject.registerClass(
	class BatteryRing extends St.DrawingArea {
		_init(device, theme) {
			super._init({style_class: 'widget-battery-ring'});
			this._percentage = device?.percentage ?? null;
			this._ringColor = batteryColor(this._percentage);
			this._trackColor = theme?.dark ? [1, 1, 1, 0.16] : [0, 0, 0, 0.11];
		};

		update(device, theme) {
			this._percentage = device?.percentage ?? null;
			this._ringColor = batteryColor(this._percentage);
			this._trackColor = theme?.dark ? [1, 1, 1, 0.16] : [0, 0, 0, 0.11];
			this.queue_repaint();
		};

		vfunc_repaint() {
			const cr = this.get_context();
			const [width, height] = this.get_surface_size();

			if (width <= 0 || height <= 0) {
				cr.$dispose();
				return;
			};

			const lineWidth = Math.max(5, Math.round(Math.min(width, height) * 0.08));
			const radius = Math.min(width, height) / 2 - lineWidth / 2 - 1;
			const centerX = width / 2;
			const centerY = height / 2;

			cr.setLineCap(1);
			cr.setLineWidth(lineWidth);
			cr.arc(centerX, centerY, radius, 0, Math.PI * 2);
			cr.setSourceRGBA(...this._trackColor);
			cr.stroke();

			if (Number.isFinite(this._percentage)) {
				cr.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this._percentage / 100));
				cr.setSourceRGBA(...this._ringColor, 1);
				cr.stroke();
			};

			cr.$dispose();
		};
	});

export function style(theme) {
	return `color: ${theme.text};`;
};

function slotIconSize(size) {
	return Math.max(16, Math.round(size * 0.4));
};

function slotFonts(size, horizontal) {
	return {
		percent: Math.max(12, Math.round(size * (horizontal ? HORIZONTAL_PERCENT_RATIO : PERCENT_FONT_RATIO))),
		name: Math.max(11, Math.round(size * (horizontal ? HORIZONTAL_NAME_RATIO : NAME_FONT_RATIO))),
	};
};

function horizontalTextRatio(device) {
	const nameLength = device?.name ? device.name.length : 0;
	const percentLength = device ? `${device.percentage}%`.length : 0;
	const nameWidth = nameLength * HORIZONTAL_CHAR_WIDTH * HORIZONTAL_NAME_RATIO;
	const percentWidth = percentLength * HORIZONTAL_CHAR_WIDTH * HORIZONTAL_PERCENT_RATIO;

	return Math.max(nameWidth, percentWidth) * HORIZONTAL_TEXT_SAFETY;
};

function nameLabelSpec(entry, device, size) {
	const name = String(device ? device.name : '');
	const fonts = slotFonts(size, entry.horizontal);
	const font = entry.textWidth > 0 ? fitNameFont(name, entry.textWidth, fonts.name) : fonts.name;
	const limit = entry.textWidth > 0
		? Math.max(1, Math.floor(entry.textWidth / (HORIZONTAL_CHAR_WIDTH * font)))
		: entry.nameLimit;

	return {text: fitName(name, limit), font};
};

function addSlotLabels(entry, device, theme, createLabel, size) {
	const {horizontal, showName, textWidth} = entry;
	const fonts = slotFonts(size, horizontal);
	const parent = entry.textColumn || entry.slot;

	if (showName) {
		const {text, font} = nameLabelSpec(entry, device, size);
		const nameLabel = createLabel(text, 'widget-battery-name', `font-size: ${font}px; color: ${theme.muted};`);

		nameLabel.x_expand = textWidth > 0 ? true : !horizontal;
		nameLabel.x_align = Clutter.ActorAlign.CENTER;
		nameLabel.clutter_text.set_line_wrap(false);
		parent.add_child(nameLabel);
		entry.nameLabel = nameLabel;
	};

	const percentLabel = createLabel(device ? `${device.percentage}%` : '', 'widget-battery-percent', `font-size: ${fonts.percent}px; color: ${device ? theme.text : theme.muted};`);

	percentLabel.x_expand = textWidth > 0;
	percentLabel.x_align = Clutter.ActorAlign.CENTER;
	parent.add_child(percentLabel);
	entry.percentLabel = percentLabel;
};

function applyLabelStyles(entry, device, theme, size) {
	const fonts = slotFonts(size, entry.horizontal);
	const {font} = nameLabelSpec(entry, device, size);

	if (entry.nameLabel) {
		entry.nameLabel.style = `font-size: ${font}px; color: ${theme.muted};`;
	};

	if (entry.percentLabel) {
		entry.percentLabel.style = `font-size: ${fonts.percent}px; color: ${device ? theme.text : theme.muted};`;
	};
};

function horizontalSlotWidth(size, textRatio, textWidth = null) {
	if (Number.isFinite(textWidth) && textWidth > 0) {
		return size + HORIZONTAL_GAP + Math.round(textWidth);
	};

	return size + SLOT_SPACING + Math.round(size * textRatio);
};

function fitNameFont(name, maxWidth, baseFont) {
	const length = String(name ?? '').length;

	if (!(maxWidth > 0) || length === 0) {
		return baseFont;
	};

	const estimate = maxWidth / (length * HORIZONTAL_CHAR_WIDTH);

	return Math.max(NAME_MIN_FONT, Math.min(baseFont, Math.floor(estimate)));
};

function buildSlot(device, theme, createLabel, size, layout) {
	const {horizontal, showName, textRatio} = layout;
	const textWidth = layout.textWidth ?? null;
	const slotWidth = horizontal ? horizontalSlotWidth(size, textRatio, textWidth) : size;

	const slot = new St.BoxLayout({
		style_class: horizontal ? 'widget-battery-slot widget-battery-slot-horizontal' : 'widget-battery-slot',
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		clip_to_allocation: true,
	});

	const entry = {
		slot,
		gauge: null,
		ring: null,
		icon: null,
		iconSize: 0,
		size,
		slotWidth,
		horizontal,
		showName,
		textRatio,
		textColumn: null,
		nameLabel: null,
		percentLabel: null,
		nameLimit: null,
		textWidth: null,
	};

	populateSlot(entry, device, theme, createLabel, size, layout);

	return entry;
};

function populateSlot(entry, device, theme, createLabel, size, layout) {
	const {slot} = entry;
	const {horizontal, showName, textRatio} = layout;

	slot.set_orientation(horizontal ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL);
	slot.style_class = horizontal ? 'widget-battery-slot widget-battery-slot-horizontal' : 'widget-battery-slot';
	slot.destroy_all_children();

	entry.horizontal = horizontal;
	entry.showName = showName;
	entry.textRatio = textRatio;
	entry.size = size;
	entry.textWidth = layout.textWidth ?? null;
	entry.slotWidth = horizontal ? horizontalSlotWidth(size, textRatio, entry.textWidth) : size;
	entry.nameLimit = layout.nameLimit ?? null;
	entry.textColumn = null;
	entry.nameLabel = null;
	entry.percentLabel = null;
	entry.gauge = null;
	entry.ring = null;
	entry.icon = null;

	const gauge = new St.Widget({
		style_class: 'widget-battery-gauge',
		style: `width: ${size}px; height: ${size}px;`,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
	});
	const ring = new BatteryRing(device, theme);
	const iconSize = slotIconSize(size);
	const icon = new St.Icon({
		icon_name: iconForDevice(device),
		style_class: 'widget-battery-icon',
		style: `icon-size: ${iconSize}px; color: ${device ? theme.text : theme.muted};`,
	});

	ring.set_size(size, size);
	ring.style = `width: ${size}px; height: ${size}px;`;
	icon.set_size(iconSize, iconSize);
	icon.set_position(Math.round((size - iconSize) / 2), Math.round((size - iconSize) / 2));
	gauge.add_child(ring);
	gauge.add_child(icon);
	slot.add_child(gauge);

	entry.gauge = gauge;
	entry.ring = ring;
	entry.icon = icon;
	entry.iconSize = iconSize;

	if (horizontal) {
		const textColumn = new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			style_class: 'widget-battery-text',
			x_align: Clutter.ActorAlign.CENTER,
			y_align: Clutter.ActorAlign.CENTER,
		});

		if (Number.isFinite(entry.textWidth) && entry.textWidth > 0) {
			textColumn.set_width(Math.round(entry.textWidth));
		};

		slot.add_child(textColumn);
		entry.textColumn = textColumn;
	};

	addSlotLabels(entry, device, theme, createLabel, size);
};

function resizeSlot(entry, device, theme, size, layout) {
	const iconSize = slotIconSize(size);

	entry.gauge.style = `width: ${size}px; height: ${size}px;`;
	entry.ring.set_size(size, size);
	entry.ring.style = `width: ${size}px; height: ${size}px;`;
	entry.icon.set_size(iconSize, iconSize);
	entry.icon.set_position(Math.round((size - iconSize) / 2), Math.round((size - iconSize) / 2));

	entry.textRatio = layout.textRatio;
	entry.textWidth = layout.textWidth ?? null;
	entry.slotWidth = entry.horizontal ? horizontalSlotWidth(size, layout.textRatio, entry.textWidth) : size;
	entry.nameLimit = layout.nameLimit ?? null;

	applyLabelStyles(entry, device, theme, size);

	if (entry.textColumn && Number.isFinite(entry.textWidth) && entry.textWidth > 0) {
		entry.textColumn.set_width(Math.round(entry.textWidth));
	};

	if (!entry.exiting) {
		if (entry.horizontal) {
			entry.slot.set_width(-1);
		} else {
			entry.slot.set_width(size);
		};
	};

	entry.iconSize = iconSize;
	entry.size = size;
};

function syncSlot(entry, device, theme, createLabel, size, layout) {
	if (entry.exiting) {
		return;
	};

	if (entry.size !== size || entry.textRatio !== layout.textRatio) {
		resizeSlot(entry, device, theme, size, layout);
	};

	if (entry.horizontal !== layout.horizontal || (entry.textWidth ?? null) !== (layout.textWidth ?? null)) {
		populateSlot(entry, device, theme, createLabel, size, layout);
		return;
	};

	entry.ring.update(device, theme);
	entry.icon.icon_name = iconForDevice(device);
	entry.icon.style = `icon-size: ${entry.iconSize}px; color: ${device ? theme.text : theme.muted};`;

	if (entry.showName === layout.showName) {
		if (entry.nameLabel) {
			entry.nameLabel.text = nameLabelSpec(entry, device, size).text;
		};

		if (entry.percentLabel) {
			entry.percentLabel.text = device ? `${device.percentage}%` : '';
		};

		applyLabelStyles(entry, device, theme, size);
		return;
	};

	entry.nameLabel?.destroy();
	entry.percentLabel?.destroy();
	entry.nameLabel = null;
	entry.percentLabel = null;
	entry.showName = layout.showName;
	entry.nameLimit = layout.nameLimit ?? null;

	addSlotLabels(entry, device, theme, createLabel, size);
};

function measureSlot(entry) {
	let width = entry.slotWidth || entry.size || MIN_GAUGE_SIZE;
	let height = entry.size || MIN_GAUGE_SIZE;

	try {
		const [, naturalWidth] = entry.slot.get_preferred_width(-1);
		const [, naturalHeight] = entry.slot.get_preferred_height(-1);

		if (Number.isFinite(naturalWidth) && naturalWidth > 0) {
			width = naturalWidth;
		};

		if (Number.isFinite(naturalHeight) && naturalHeight > 0) {
			height = naturalHeight;
		};
	} catch (error) {
	};

	return {width, height};
};

function moveSlot(entry, targetX, targetY, animate, duration = 340) {
	const {slot} = entry;
	const [tx, ty] = slot.get_translation();
	const fromX = (entry.x ?? targetX) + tx;
	const fromY = (entry.y ?? targetY) + ty;
	const toX = Math.round(targetX);
	const toY = Math.round(targetY);

	slot.remove_all_transitions();
	slot.set_position(toX, toY);
	entry.x = toX;
	entry.y = toY;

	if (!animate) {
		slot.set_translation(0, 0, 0);
		slot.set_opacity(255);
		return;
	};

	const dx = Math.round(fromX) - toX;
	const dy = Math.round(fromY) - toY;

	if (slot.get_opacity() < 255) {
		slot.ease_property('opacity', 255, {
			duration: 220,
			mode: Clutter.AnimationMode.EASE_OUT_QUAD,
		});
	};

	if (dx === 0 && dy === 0) {
		slot.set_translation(0, 0, 0);
		return;
	};

	slot.set_translation(dx, dy, 0);
	slot.ease({
		translation_x: 0,
		translation_y: 0,
		duration,
		mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
	});
};

function enterSlot(entry, animate) {
	const {slot} = entry;

	slot.set_translation(0, 0, 0);

	if (!animate) {
		slot.set_opacity(255);
		return;
	};

	slot.set_opacity(0);
	slot.set_translation(Math.min(entry.slotWidth + SLOT_GAP, 140), 0, 0);
	slot.ease_property('translation-x', 0, {
		duration: 380,
		mode: Clutter.AnimationMode.EASE_OUT_BACK,
	});
	slot.ease_property('opacity', 255, {
		duration: 260,
		mode: Clutter.AnimationMode.EASE_OUT_QUAD,
	});
};

function startExit(entry, key, state, animate) {
	const {slot} = entry;
	let finished = false;

	entry.exiting = true;
	entry.exitStarted = true;

	const finalize = () => {
		if (finished || entry.cancelled || state.slots.get(key) !== entry) {
			return;
		};

		finished = true;

		const parent = slot.get_parent();

		if (parent) {
			parent.remove_child(slot);
		};

		slot.destroy();
		state.slots.delete(key);

		if (state.params && !state.reflowPending) {
			state.reflowPending = true;

			GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
				state.reflowPending = false;

				if (state.params) {
					reconcile(state.params);
				};

				return GLib.SOURCE_REMOVE;
			});
		};
	};

	if (!animate) {
		finalize();
		return;
	};

	slot.remove_all_transitions();
	slot.set_translation(0, 0, 0);

	const lift = Math.min(12, Math.round(entry.size * 0.18));
	const fall = Math.round(entry.size + lift + SLOT_GAP * 2);

	slot.ease({
		translation_y: -lift,
		duration: 150,
		mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
		onComplete: () => {
			if (finished || entry.cancelled) {
				return;
			};

			slot.ease_property('translation-y', fall, {
				duration: 340,
				mode: Clutter.AnimationMode.EASE_IN_QUAD,
			});
			slot.ease_property('opacity', 0, {
				duration: 360,
				mode: Clutter.AnimationMode.EASE_IN_QUAD,
				onComplete: finalize,
			});
		},
	});
};

function trayFor(body) {
	const state = body._batteryState;

	if (state && state.tray.get_parent() === body) {
		return state;
	};

	body.clip_to_allocation = true;
	body.destroy_all_children();

	const tray = new St.Widget({
		style_class: 'widget-battery-tray',
		x_expand: true,
		y_expand: true,
		layout_manager: new Clutter.FixedLayout(),
	});

	body.add_child(tray);
	body._batteryState = {tray, slots: new Map()};

	return body._batteryState;
};

function bestGrid(count, availWidth, availHeight, style) {
	const maxCols = Math.max(1, Math.min(count, MAX_SLOTS));
	let best = null;

	for (let cols = 1; cols <= maxCols; cols++) {
		const rows = Math.ceil(count / cols);
		const cellWidth = (availWidth - (cols - 1) * SLOT_GAP) / cols;
		const cellHeight = (availHeight - (rows - 1) * SLOT_GAP) / rows;

		if (cellWidth <= 0 || cellHeight <= 0) {
			continue;
		};

		let size;

		if (style.horizontal) {
			size = Math.min(cellHeight, (cellWidth - SLOT_SPACING) / (1 + (style.textRatio ?? 0)));
		} else {
			const denom = 1 + PERCENT_TEXT_RATIO + (style.showName ? NAME_TEXT_RATIO : 0);
			const gaps = (style.showName ? 2 : 1) * SLOT_SPACING;

			size = Math.min(cellWidth, (cellHeight - gaps) / denom);
		};

		if (!Number.isFinite(size) || size < MIN_GAUGE_SIZE) {
			continue;
		};

		size = Math.min(size, MAX_GAUGE_SIZE);

		if (!best || size > best.size) {
			best = {cols, rows, size};
		};
	};

	return best;
};

function bestLayout(count, availWidth, availHeight, showName, textRatio) {
	let best = null;

	for (const horizontal of [false, true]) {
		const grid = bestGrid(count, availWidth, availHeight, {horizontal, showName, textRatio});

		if (!grid || (showName && grid.size < MIN_TEXT_GAUGE)) {
			continue;
		};

		const score = grid.size + (horizontal ? 1 : 0);

		if (!best || score > best.score) {
			best = {...grid, horizontal, showName, textRatio, score};
		};
	};

	return best;
};

function fitName(name, limit) {
	const value = String(name ?? '');

	if (!Number.isFinite(limit) || value.length <= limit) {
		return value;
	};

	if (limit <= 1) {
		return value.slice(0, 1);
	};

	return `${value.slice(0, limit - 1)}\u2026`;
};

function singleDeviceLayout(availWidth, availHeight) {
	const cap = Math.max(MIN_GAUGE_SIZE, availWidth - HORIZONTAL_GAP - MIN_TEXT_WIDTH);
	const size = Math.max(MIN_GAUGE_SIZE, Math.min(availHeight, availWidth * 0.5, cap));
	const textWidth = Math.max(MIN_TEXT_WIDTH, availWidth - size - HORIZONTAL_GAP);

	return {
		cols: 1,
		rows: 1,
		size,
		horizontal: true,
		showName: true,
		textRatio: textWidth / size,
		textWidth,
		score: 1,
	};
};

function computeLayout(count, availWidth, availHeight, textRatio) {
	if (count === 1) {
		return singleDeviceLayout(availWidth, availHeight);
	};

	if (count <= TEXT_SLOT_LIMIT) {
		const named = bestLayout(count, availWidth, availHeight, true, textRatio);

		if (named) {
			return named;
		};
	};

	const plain = bestLayout(count, availWidth, availHeight, false, textRatio);

	if (plain) {
		return plain;
	};

	return {cols: count, rows: 1, size: MIN_GAUGE_SIZE, horizontal: false, showName: false, textRatio, score: 0};
};

export function reconcile({body, widget, createLabel, theme, sizeForWidget, animate = true}) {
	const state = trayFor(body);
	const {slots} = state;

	state.params = {body, widget, createLabel, theme, sizeForWidget, animate};

	const liveDevices = cachedDevices();

	if (devicesAreStale()) {
		const currentSignature = devicesSignature(liveDevices);

		refreshDevices().then(devices => {
			if (devicesSignature(devices) === currentSignature || !state.params) {
				return;
			};

			if (!devicesSignatureListener) {
				reconcile(state.params);
			};
		}).catch(() => {});
	};

	const liveKeys = new Set(liveDevices.map(deviceKey));
	const departing = [];

	for (const [key, entry] of slots) {
		if (liveKeys.has(key)) {
			if (entry.exiting && !entry.exitStarted) {
				entry.exiting = false;
				entry.cancelled = true;
				entry.exitStarted = false;
			};
		} else if (!entry.exiting) {
			entry.exiting = true;
			entry.cancelled = false;
		};

		if (entry.exiting && entry.device) {
			departing.push(entry.device);
		};
	};

	const ordered = orderDevices([...liveDevices, ...departing]);
	const count = Math.min(ordered.length, MAX_SLOTS);
	const targets = ordered.slice(0, count);

	if (count === 0) {
		for (const [key, entry] of [...slots]) {
			if (entry.exiting && !entry.exitStarted) {
				startExit(entry, key, state, animate);
			};
		};

		if (!state.emptyHint) {
			state.emptyHint = createLabel(_('No batteries found'), 'widget-battery-empty', `color: ${theme.muted};`);
			// The tray uses a fixed layout, so center the hint manually
			// whenever the tray is (re)allocated.
			state.emptyHintPlace = () => {
				if (!state.emptyHint) {
					return;
				};

				const [, , naturalWidth, naturalHeight] = state.emptyHint.get_preferred_size();

				state.emptyHint.set_position(
					Math.max(0, (state.tray.width - naturalWidth) / 2),
					Math.max(0, (state.tray.height - naturalHeight) / 2));
			};
			state.emptyHintAllocId = state.tray.connect('notify::allocation', state.emptyHintPlace);
			state.emptyHintPlace();
			state.tray.add_child(state.emptyHint);
		};

		return;
	};

	if (state.emptyHint) {
		if (state.emptyHintAllocId) {
			state.tray.disconnect(state.emptyHintAllocId);
			state.emptyHintAllocId = 0;
		};

		state.emptyHintPlace = null;
		state.emptyHint.destroy();
		state.emptyHint = null;
	};

	const [width, height] = sizeForWidget ? sizeForWidget(widget) : [FALLBACK_WIDGET_WIDTH, FALLBACK_WIDGET_HEIGHT];
	const availWidth = Math.max(MIN_GAUGE_SIZE, width - WIDGET_PADDING - LAYOUT_MARGIN * 2);
	const availHeight = Math.max(MIN_GAUGE_SIZE, height - WIDGET_PADDING - LAYOUT_MARGIN * 2);
	const textRatio = targets.reduce((max, device) => Math.max(max, horizontalTextRatio(device)), 0);
	const layout = computeLayout(count, availWidth, availHeight, textRatio);
	const {cols, rows: rowCount, size, horizontal} = layout;

	const cellWidth = (availWidth - (cols - 1) * SLOT_GAP) / cols;
	const cellHeight = (availHeight - (rowCount - 1) * SLOT_GAP) / rowCount;
	const pitchX = cellWidth + SLOT_GAP;
	const pitchY = cellHeight + SLOT_GAP;
	const trayWidth = width - WIDGET_PADDING;
	const trayHeight = height - WIDGET_PADDING;

	const cellCenter = index => {
		const row = Math.floor(index / cols);
		const column = index % cols;
		const rowSlots = Math.min(cols, count - row * cols);
		const rowBlockWidth = rowSlots * cellWidth + Math.max(0, rowSlots - 1) * SLOT_GAP;
		const rowStartX = LAYOUT_MARGIN + (availWidth - rowBlockWidth) / 2;

		return [
			rowStartX + column * pitchX + cellWidth / 2,
			LAYOUT_MARGIN + row * pitchY + cellHeight / 2,
		];
	};

	const centers = targets.map((device, index) => cellCenter(index));
	const departingCenters = [];

	targets.forEach((device, index) => {
		const entry = slots.get(deviceKey(device));

		if (entry?.exiting) {
			departingCenters.push(centers[index]);
		};
	});

	targets.forEach((device, index) => {
		const key = deviceKey(device);
		const [centerX, centerY] = centers[index];
		let entry = slots.get(key);

		if (entry?.exiting) {
			if (entry.exitStarted) {
				return;
			};

			const measured = measureSlot(entry);

			entry.x = Math.round(centerX - measured.width / 2);
			entry.y = Math.round(centerY - measured.height / 2);
			entry.slot.set_position(entry.x, entry.y);
			return;
		};

		if (entry) {
			syncSlot(entry, device, theme, createLabel, size, layout);
		} else {
			entry = buildSlot(device, theme, createLabel, size, layout);
			entry.x = null;
			entry.y = null;
			entry.cancelled = false;
			entry.exiting = false;
			entry.exitStarted = false;
			state.tray.add_child(entry.slot);
			slots.set(key, entry);
		};

		entry.device = device;

		const measured = measureSlot(entry);
		const clampX = x => Math.min(Math.max(x, 0), Math.max(0, trayWidth - measured.width));
		const clampY = y => Math.min(Math.max(y, 0), Math.max(0, trayHeight - measured.height));

		let targetX = clampX(centerX - measured.width / 2);
		let targetY = clampY(centerY - measured.height / 2);

		if (entry.x === null) {
			entry.x = Math.round(targetX);
			entry.y = Math.round(targetY);
			entry.slot.set_position(entry.x, entry.y);
			enterSlot(entry, animate);
			return;
		};

		for (const [departX, departY] of departingCenters) {
			const dx = centerX - departX;
			const dy = centerY - departY;
			const dist = Math.hypot(dx, dy);

			if (dist < 1) {
				continue;
			};

			const strength = 10 / (1 + dist / 140);

			targetX += (dx / dist) * strength;
			targetY += (dy / dist) * strength;
		};

		moveSlot(entry, clampX(targetX), clampY(targetY), animate);
	});

	for (const [key, entry] of [...slots]) {
		if (entry.exiting && !entry.exitStarted) {
			startExit(entry, key, state, animate);
		};
	};
};

export function render(params) {
	reconcile({...params, animate: false});
};
