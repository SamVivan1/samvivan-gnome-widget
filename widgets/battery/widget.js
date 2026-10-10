import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { warn } from '../../logger.js';

export const type = 'battery';
export const label = 'Battery';
export const stylesheet = 'widgets/battery/stylesheet.css';
export const defaultSize = 'medium';

const MAX_GAUGE_SIZE = 84;
const MIN_GAUGE_SIZE = 40;
const SLOT_GAP = 12;
const MAX_SLOTS = 8;
const TEXT_SLOT_LIMIT = 4;
const MIN_TEXT_GAUGE = 64;
const WIDGET_PADDING = 30;
const FALLBACK_WIDGET_WIDTH = 454;

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

const DEVICE_FALLBACK_NAMES = {
	[DEVICE_TYPE.BATTERY]: 'Battery',
	[DEVICE_TYPE.UPS]: 'UPS',
	[DEVICE_TYPE.MOUSE]: 'Mouse',
	[DEVICE_TYPE.KEYBOARD]: 'Keyboard',
	[DEVICE_TYPE.PDA]: 'PDA',
	[DEVICE_TYPE.PHONE]: 'Phone',
	[DEVICE_TYPE.MEDIA_PLAYER]: 'Media Player',
	[DEVICE_TYPE.TABLET]: 'Tablet',
	[DEVICE_TYPE.COMPUTER]: 'Computer',
	[DEVICE_TYPE.GAMING_INPUT]: 'Gamepad',
	[DEVICE_TYPE.PEN]: 'Stylus',
	[DEVICE_TYPE.TOUCHPAD]: 'Touchpad',
	[DEVICE_TYPE.HEADSET]: 'Headset',
	[DEVICE_TYPE.SPEAKERS]: 'Speakers',
	[DEVICE_TYPE.HEADPHONES]: 'Headphones',
	[DEVICE_TYPE.OTHER_AUDIO]: 'Audio Device',
};

function fallbackNameForKind(kind) {
	return DEVICE_FALLBACK_NAMES[kind] ?? 'Device';
};

function fallbackNameForBluetoothIcon(iconClass) {
	const name = String(iconClass || '').toLowerCase();

	if (!name || name === 'unknown') {
		return null;
	};
	if (name.includes('mouse')) {
		return 'Mouse';
	};
	if (name.includes('keyboard')) {
		return 'Keyboard';
	};
	if (name.includes('tablet') || name.includes('pen')) {
		return 'Tablet';
	};
	if (name.includes('gaming') || name.includes('joystick') || name.includes('gamepad')) {
		return 'Gamepad';
	};
	if (name.includes('headset')) {
		return 'Headset';
	};
	if (name.includes('headphone')) {
		return 'Headphones';
	};
	if (name.includes('speaker') || name.includes('audio-card') || name.includes('audio')) {
		return 'Speakers';
	};
	if (name.includes('phone')) {
		return 'Phone';
	};
	if (name.includes('computer')) {
		return 'Computer';
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

function upowerCall(path, iface, method, params = null) {
	return Gio.DBus.system.call_sync(
		'org.freedesktop.UPower',
		path,
		iface,
		method,
		params,
		null,
		Gio.DBusCallFlags.NONE,
		1000,
		null);
};

function readUPowerDevices() {
	try {
		const [paths] = upowerCall('/org/freedesktop/UPower', 'org.freedesktop.UPower', 'EnumerateDevices').deep_unpack();
		const devices = [];

		for (const path of paths) {
			const [props] = upowerCall(
				path,
				'org.freedesktop.DBus.Properties',
				'GetAll',
				GLib.Variant.new('(s)', ['org.freedesktop.UPower.Device'])).deep_unpack();

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
			});
		};

		return devices;
	} catch (error) {
		warn('upower-read', `Could not read UPower batteries: ${error.message}`);
		return [];
	};
};

function readBlueZDevices() {
	try {
		const [objects] = Gio.DBus.system.call_sync(
			'org.bluez',
			'/',
			'org.freedesktop.DBus.ObjectManager',
			'GetManagedObjects',
			null,
			null,
			Gio.DBusCallFlags.NONE,
			1000,
			null).deep_unpack();
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
				name: alias || fallbackNameForBluetoothIcon(iconClass) || 'Bluetooth Device',
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

function gsconnectBattery(path) {
	try {
		const reply = Gio.DBus.session.call_sync(
			GSCONNECT_BUS_NAME,
			path,
			'org.gtk.Actions',
			'Describe',
			GLib.Variant.new('(s)', ['battery']),
			null,
			Gio.DBusCallFlags.NONE,
			1000,
			null);
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

function readGSConnectDevices() {
	try {
		const [objects] = Gio.DBus.session.call_sync(
			GSCONNECT_BUS_NAME,
			GSCONNECT_ROOT_PATH,
			'org.freedesktop.DBus.ObjectManager',
			'GetManagedObjects',
			null,
			null,
			Gio.DBusCallFlags.NONE,
			1000,
			null).deep_unpack();
		const devices = [];

		for (const [path, interfaces] of Object.entries(objects)) {
			const deviceProps = interfaces[GSCONNECT_DEVICE_IFACE];

			if (!deviceProps || !variantValue(deviceProps, 'Connected', false)) {
				continue;
			};

			const battery = gsconnectBattery(path);

			if (!battery || !Number.isFinite(battery.level) || battery.level < 0) {
				continue;
			};

			const name = String(variantValue(deviceProps, 'Name', '') || '').trim();

			devices.push({
				source: 'gsconnect',
				name: name || 'Phone',
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
	const path = String(device.nativePath || '');
	if (path.startsWith('/org/bluez/')) {
		return path;
	};
	if (path.startsWith('/org/gnome/Shell/Extensions/GSConnect/Device/')) {
		return path;
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
let devicesCache = null;

function readDevices(force = false) {
	const now = Date.now();

	if (!force && devicesCache && now - devicesCache.time < DEVICES_CACHE_MS) {
		return devicesCache.devices;
	};

	const devices = mergeDevices([...readUPowerDevices(), ...readBlueZDevices(), ...readGSConnectDevices()]);

	devicesCache = {time: now, devices};
	return devices;
};

export function batterySignature() {
	return readDevices().map(device => [
		device.name,
		device.kind ?? '',
		device.percentage,
		device.powerSupply ? 1 : 0,
		device.iconName ?? '',
	].join(':')).join('|');
};

const BatteryRing = GObject.registerClass(
	class BatteryRing extends St.DrawingArea {
		_init(device, theme) {
			super._init({style_class: 'widget-battery-ring'});
			this._percentage = device?.percentage ?? null;
			this._ringColor = batteryColor(this._percentage);
			this._trackColor = theme?.dark ? [1, 1, 1, 0.16] : [0, 0, 0, 0.11];
		};

		vfunc_repaint() {
			const cr = this.get_context();
			const [width, height] = this.get_surface_size();

			if (width <= 0 || height <= 0) {
				cr.$dispose();
				return;
			};

			const lineWidth = 7;
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

function createSlot(device, theme, createLabel, size, showText) {
	const slot = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-battery-slot',
		x_expand: true,
		x_align: Clutter.ActorAlign.CENTER,
	});
	const gauge = new St.Widget({
		style_class: 'widget-battery-gauge',
		style: `width: ${size}px; height: ${size}px;`,
		x_align: Clutter.ActorAlign.CENTER,
	});
	const ring = new BatteryRing(device, theme);
	const iconSize = Math.max(16, Math.round(size * 0.36));
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

	if (!showText) {
		return slot;
	};

	const nameLabel = createLabel(device ? device.name : '', 'widget-battery-name', `color: ${theme.muted};`);

	nameLabel.x_expand = true;
	nameLabel.x_align = Clutter.ActorAlign.CENTER;
	nameLabel.clutter_text.set_line_wrap(false);
	slot.add_child(nameLabel);

	const percentLabel = createLabel(device ? `${device.percentage}%` : '', 'widget-battery-percent', `color: ${device ? theme.text : theme.muted};`);

	percentLabel.x_expand = false;
	percentLabel.x_align = Clutter.ActorAlign.CENTER;
	slot.add_child(percentLabel);
	return slot;
};

export function render({body, widget, createLabel, theme, sizeForWidget}) {
	const devices = readDevices();

	if (devices.length === 0) {
		return;
	};

	const width = sizeForWidget ? sizeForWidget(widget)[0] : FALLBACK_WIDGET_WIDTH;
	const available = Math.max(MIN_GAUGE_SIZE, width - WIDGET_PADDING);
	const count = Math.min(devices.length, MAX_SLOTS);

	let size = MAX_GAUGE_SIZE;
	if (count * MAX_GAUGE_SIZE + (count - 1) * SLOT_GAP > available) {
		size = Math.floor((available - (count - 1) * SLOT_GAP) / count);
	};
	size = Math.max(MIN_GAUGE_SIZE, Math.min(MAX_GAUGE_SIZE, size));

	const fitCount = Math.max(1, Math.floor((available + SLOT_GAP) / (size + SLOT_GAP)));
	const shown = Math.min(count, fitCount);
	const showText = shown <= TEXT_SLOT_LIMIT && size >= MIN_TEXT_GAUGE;
	const tray = new St.BoxLayout({
		style_class: 'widget-battery-tray',
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
	});

	for (let index = 0; index < shown; index++) {
		tray.add_child(createSlot(devices[index], theme, createLabel, size, showText));
	};

	body.add_child(tray);
};
