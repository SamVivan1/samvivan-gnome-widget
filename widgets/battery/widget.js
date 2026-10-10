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

function addSlotLabels(entry, device, theme, createLabel, size) {
	const {horizontal, showName} = entry;
	const fonts = slotFonts(size, horizontal);
	const parent = entry.textColumn || entry.slot;

	if (showName) {
		const nameLabel = createLabel(device ? device.name : '', 'widget-battery-name', `font-size: ${fonts.name}px; color: ${theme.muted};`);

		nameLabel.x_expand = horizontal ? false : true;
		nameLabel.x_align = Clutter.ActorAlign.CENTER;
		nameLabel.clutter_text.set_line_wrap(false);
		parent.add_child(nameLabel);
		entry.nameLabel = nameLabel;
	};

	const percentLabel = createLabel(device ? `${device.percentage}%` : '', 'widget-battery-percent', `font-size: ${fonts.percent}px; color: ${device ? theme.text : theme.muted};`);

	percentLabel.x_expand = false;
	percentLabel.x_align = Clutter.ActorAlign.CENTER;
	parent.add_child(percentLabel);
	entry.percentLabel = percentLabel;
};

function applyLabelStyles(entry, device, theme, size) {
	const fonts = slotFonts(size, entry.horizontal);

	if (entry.nameLabel) {
		entry.nameLabel.style = `font-size: ${fonts.name}px; color: ${theme.muted};`;
	};

	if (entry.percentLabel) {
		entry.percentLabel.style = `font-size: ${fonts.percent}px; color: ${device ? theme.text : theme.muted};`;
	};
};

function horizontalSlotWidth(size, textRatio) {
	return size + SLOT_SPACING + Math.round(size * textRatio);
};

function buildSlot(device, theme, createLabel, size, layout) {
	const {horizontal, showName, textRatio} = layout;
	const slotWidth = horizontal ? horizontalSlotWidth(size, textRatio) : size;

	const slot = new St.BoxLayout({
		orientation: horizontal ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
		style_class: horizontal ? 'widget-battery-slot widget-battery-slot-horizontal' : 'widget-battery-slot',
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		clip_to_allocation: true,
	});

	if (!horizontal) {
		slot.set_width(size);
	};

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

	const entry = {
		slot,
		gauge,
		ring,
		icon,
		iconSize,
		size,
		slotWidth,
		horizontal,
		showName,
		textRatio,
		textColumn: null,
		nameLabel: null,
		percentLabel: null,
	};

	if (horizontal) {
		const textColumn = new St.BoxLayout({
			orientation: Clutter.Orientation.VERTICAL,
			style_class: 'widget-battery-text',
			x_align: Clutter.ActorAlign.CENTER,
			y_align: Clutter.ActorAlign.CENTER,
		});

		slot.add_child(textColumn);
		entry.textColumn = textColumn;
	};

	addSlotLabels(entry, device, theme, createLabel, size);

	return entry;
};

function resizeSlot(entry, device, theme, size, layout) {
	const iconSize = slotIconSize(size);

	entry.gauge.style = `width: ${size}px; height: ${size}px;`;
	entry.ring.set_size(size, size);
	entry.ring.style = `width: ${size}px; height: ${size}px;`;
	entry.icon.set_size(iconSize, iconSize);
	entry.icon.set_position(Math.round((size - iconSize) / 2), Math.round((size - iconSize) / 2));
	applyLabelStyles(entry, device, theme, size);

	entry.textRatio = layout.textRatio;
	entry.slotWidth = entry.horizontal ? horizontalSlotWidth(size, layout.textRatio) : size;

	if (!entry.exiting && !entry.horizontal) {
		entry.slot.set_width(size);
	};

	entry.iconSize = iconSize;
	entry.size = size;
};

function syncSlot(entry, device, theme, createLabel, size, layout) {
	if (entry.exiting) {
		return;
	};

	entry.slot.remove_all_transitions();
	entry.slot.set_opacity(255);
	entry.slot.set_scale(1, 1);
	entry.slot.set_translation(0, 0, 0);

	if (entry.size !== size || entry.textRatio !== layout.textRatio) {
		resizeSlot(entry, device, theme, size, layout);
	};

	entry.ring.update(device, theme);
	entry.icon.icon_name = iconForDevice(device);
	entry.icon.style = `icon-size: ${entry.iconSize}px; color: ${device ? theme.text : theme.muted};`;

	if (entry.showName === layout.showName) {
		if (entry.nameLabel) {
			entry.nameLabel.text = device ? device.name : '';
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

	addSlotLabels(entry, device, theme, createLabel, size);
};

function enterSlot(entry, animate) {
	const {slot} = entry;

	slot.remove_all_transitions();
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

function offsetWithin(actor, ancestor) {
	let x = 0;
	let y = 0;
	let node = actor;

	while (node && node !== ancestor) {
		const [px, py] = node.get_position();

		if (Number.isFinite(px)) {
			x += px;
		};

		if (Number.isFinite(py)) {
			y += py;
		};

		node = node.get_parent();
	};

	return [x, y];
};

function startExit(entry, key, state, animate) {
	const {slot} = entry;
	let finished = false;

	entry.exiting = true;
	entry.exitStarted = true;

	const finalize = () => {
		if (finished) {
			return;
		};

		finished = true;

		const parent = slot.get_parent();

		if (parent) {
			parent.remove_child(slot);
		};

		slot.destroy();
		state.slots.delete(key);

		if (state.params) {
			GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
				reconcile(state.params);
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

	const lift = Math.min(Math.round(entry.size * 0.45), 30);
	const fall = Math.round(entry.size + lift + SLOT_GAP * 2);

	slot.ease({
		translation_y: -lift,
		duration: 150,
		mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
		onComplete: () => {
			if (finished) {
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

function flipSlots(slots, positionsBefore, stage, animate) {
	if (!animate || !stage) {
		return;
	};

	for (const [key, entry] of slots) {
		const previous = positionsBefore.get(key);
		const slot = entry.slot;

		if (!previous || entry.exiting) {
			continue;
		};

		if (slot._flipId) {
			slot.disconnect(slot._flipId);
			slot._flipId = 0;
		};

		slot._flipId = slot.connect('notify::allocation', () => {
			slot.disconnect(slot._flipId);
			slot._flipId = 0;

			const [nowX, nowY] = offsetWithin(slot, stage);
			const dx = Math.round(previous[0] - nowX);
			const dy = Math.round(previous[1] - nowY);

			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
				return;
			};

			slot.remove_all_transitions();
			slot.set_translation(dx, dy, 0);
			slot.ease({
				translation_x: 0,
				translation_y: 0,
				duration: 300,
				mode: Clutter.AnimationMode.EASE_OUT_BACK,
			});
		});
	};
};

function rowBox() {
	return new St.BoxLayout({
		style_class: 'widget-battery-row',
		x_expand: true,
		y_align: Clutter.ActorAlign.CENTER,
		x_align: Clutter.ActorAlign.CENTER,
	});
};

function trayFor(body) {
	const state = body._batteryState;

	if (state && state.tray.get_parent() === body) {
		return state;
	};

	body.clip_to_allocation = true;
	body.destroy_all_children();

	const tray = new St.BoxLayout({
		style_class: 'widget-battery-tray',
		orientation: Clutter.Orientation.VERTICAL,
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
	});

	body.add_child(tray);
	body._batteryState = {tray, rows: [], slots: new Map()};

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

function computeLayout(count, availWidth, availHeight, textRatio) {
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

function ensureRows(state, count) {
	while (state.rows.length < count) {
		const row = rowBox();

		state.tray.add_child(row);
		state.rows.push(row);
	};
};

function pruneRows(state, keep) {
	let index = state.rows.length - 1;

	while (index >= keep) {
		const row = state.rows[index];

		if (row.get_n_children() > 0) {
			break;
		};

		state.rows.splice(index, 1);
		row.destroy();
		index--;
	};
};

export function reconcile({body, widget, createLabel, theme, sizeForWidget, animate = true}) {
	const state = trayFor(body);
	const {rows, slots} = state;
	const stage = body.get_parent();

	state.params = {body, widget, createLabel, theme, sizeForWidget, animate};

	const liveDevices = readDevices();
	const liveKeys = new Set(liveDevices.map(deviceKey));
	const exitingDevices = [];

	for (const [key, entry] of slots) {
		if (!liveKeys.has(key)) {
			entry.exiting = true;

			if (entry.device) {
				exitingDevices.push(entry.device);
			};
		};
	};

	const devices = orderDevices([...liveDevices, ...exitingDevices]);

	if (devices.length === 0) {
		pruneRows(state, 0);
		return;
	};

	const positionsBefore = new Map();

	for (const [key, entry] of slots) {
		positionsBefore.set(key, offsetWithin(entry.slot, stage));
	};

	const [width, height] = sizeForWidget ? sizeForWidget(widget) : [FALLBACK_WIDGET_WIDTH, FALLBACK_WIDGET_HEIGHT];
	const availWidth = Math.max(MIN_GAUGE_SIZE, width - WIDGET_PADDING - LAYOUT_MARGIN * 2);
	const availHeight = Math.max(MIN_GAUGE_SIZE, height - WIDGET_PADDING - LAYOUT_MARGIN * 2);
	const count = Math.min(devices.length, MAX_SLOTS);
	const targets = devices.slice(0, count);
	const textRatio = targets.reduce((max, device) => Math.max(max, horizontalTextRatio(device)), 0);
	const layout = computeLayout(count, availWidth, availHeight, textRatio);
	const {cols, rows: rowCount, size, horizontal} = layout;

	ensureRows(state, rowCount);

	targets.forEach((device, index) => {
		const key = deviceKey(device);
		const row = rows[Math.floor(index / cols)];
		const column = index % cols;
		let existing = slots.get(key);

		if (existing?.exiting) {
			if (existing.slot.get_parent() !== row) {
				existing.slot.get_parent()?.remove_child(existing.slot);
				row.add_child(existing.slot);
			};

			row.set_child_at_index(existing.slot, Math.min(column, row.get_n_children() - 1));
			return;
		};

		if (existing && existing.horizontal !== horizontal) {
			existing.slot.get_parent()?.remove_child(existing.slot);
			existing.slot.destroy();
			slots.delete(key);
			existing = null;
		};

		if (existing) {
			syncSlot(existing, device, theme, createLabel, size, layout);

			if (existing.slot.get_parent() !== row) {
				existing.slot.get_parent()?.remove_child(existing.slot);
				row.add_child(existing.slot);
			};

			row.set_child_at_index(existing.slot, Math.min(column, row.get_n_children() - 1));
			existing.device = device;
			return;
		};

		const entry = buildSlot(device, theme, createLabel, size, layout);

		entry.device = device;
		slots.set(key, entry);
		row.insert_child_at_index(entry.slot, Math.min(column, row.get_n_children()));
		enterSlot(entry, animate);
	});

	for (const [key, entry] of [...slots]) {
		if (entry.exiting && !entry.exitStarted) {
			startExit(entry, key, state, animate);
		};
	};

	flipSlots(slots, positionsBefore, stage, animate);
	pruneRows(state, rowCount);
};

export function render(params) {
	reconcile({...params, animate: false});
};
