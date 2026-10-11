import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const type = 'bambu';
export const label = 'Bambu Lab';
export const stylesheet = 'widgets/bambu/stylesheet.css';
export const defaultSize = 'medium';
export const defaultInLayout = false;

const STATE_LABELS = {
	IDLE: 'Idle',
	RUNNING: 'Printing',
	PAUSE: 'Paused',
	FINISH: 'Finished',
	FAILED: 'Failed',
	PREPARE: 'Preparing',
	SLICING: 'Slicing',
};

const STATE_COLORS = {
	RUNNING: '#3a944a',
	PAUSE: '#c88800',
	FINISH: '#3584e4',
	FAILED: '#e62d42',
	PREPARE: '#9141ac',
	SLICING: '#2190a4',
	IDLE: null,
};

function clampProgress(value) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return null;
	};

	return Math.max(0, Math.min(100, number));
};

function hexToRgb(hex) {
	const cleaned = String(hex || '').replace('#', '').trim();
	const padded = cleaned.length === 3
		? cleaned.split('').map(character => character + character).join('')
		: cleaned.padEnd(6, '0').slice(0, 6);
	const value = Number.parseInt(padded, 16);

	if (!Number.isFinite(value)) {
		return [0.6, 0.6, 0.6];
	};

	return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
};

function hexToRgba(hex, alpha) {
	return [...hexToRgb(hex), alpha];
};

function normalizeColor(color) {
	const value = String(color || '').trim();

	if (!value) {
		return '#8a8a8a';
	};

	return value.startsWith('#') ? value : `#${value}`;
};

function formatRemaining(minutes) {
	const total = Number(minutes);

	if (!Number.isFinite(total) || total <= 0) {
		return null;
	};

	const rounded = Math.round(total);
	const hours = Math.floor(rounded / 60);
	const mins = rounded % 60;

	if (hours <= 0) {
		return `${mins} min left`;
	};
	if (mins === 0) {
		return `${hours} h left`;
	};

	return `${hours} h ${mins} min left`;
};

function temperature(value) {
	const number = Number(value);

	return Number.isFinite(number) ? `${Math.round(number)}°` : '--';
};

const ProgressRing = GObject.registerClass(
	class ProgressRing extends St.DrawingArea {
		_init(progress, color, theme) {
			super._init({style_class: 'widget-bambu-ring'});
			this.setValues(progress, color, theme);
		};

		setValues(progress, color, theme) {
			this._progress = clampProgress(progress);
			this._color = color;
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

			const lineWidth = Math.max(6, Math.round(Math.min(width, height) * 0.09));
			const radius = Math.min(width, height) / 2 - lineWidth / 2 - 1;
			const centerX = width / 2;
			const centerY = height / 2;

			cr.setLineCap(1);
			cr.setLineWidth(lineWidth);
			cr.arc(centerX, centerY, radius, 0, Math.PI * 2);
			cr.setSourceRGBA(...this._trackColor);
			cr.stroke();

			if (this._progress !== null) {
				cr.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this._progress / 100));
				cr.setSourceRGBA(...hexToRgb(this._color), 1);
				cr.stroke();
			};

			cr.$dispose();
		};
	});

const HOT_TEMP_C = 60;
const LOW_BATTERY = 20;
const HIGH_LOAD = 85;
const HIGH_RAM = 90;
const HOT_COLOR = '#ff5b52';
const CRITICAL_COLOR = '#ff4d4d';
const CRITICAL_STRESS = 3;
const DEV_MOODS = ['chill', 'hot', 'sleepy', 'charging', 'busy', 'overload'];
const MOOD_PRIORITY = ['hot', 'overload', 'sleepy', 'charging', 'busy'];
const DEV_CYCLE_SECONDS = 3.5;

function luminance(hex) {
	const [r, g, b] = hexToRgb(hex);

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrastInk(hex, fallback) {
	return luminance(hex) > 0.62 ? (fallback || '#111111') : '#ffffff';
};

function roundedRect(cr, x, y, width, height, radius) {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2));

	cr.moveTo(x + r, y);
	cr.lineTo(x + width - r, y);
	cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
	cr.lineTo(x + width, y + height - r);
	cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
	cr.lineTo(x + r, y + height);
	cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
	cr.lineTo(x, y + r);
	cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
	cr.closePath();
};

function readSysFile(path) {
	try {
		const [ok, bytes] = GLib.file_get_contents(path);

		if (!ok || !bytes) {
			return null;
		};

		return new TextDecoder().decode(bytes).trim();
	} catch (error) {
		return null;
	};
};

function listSysDir(path) {
	const dir = Gio.File.new_for_path(path);

	if (!dir.query_exists(null)) {
		return [];
	};

	const names = [];

	try {
		const iter = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
		let info;

		while ((info = iter.next_file(null)) !== null) {
			names.push(info.get_name());
		};
	} catch (error) {
		return [];
	};

	return names;
};

function readBattery() {
	let percentage = null;
	let charging = false;

	for (const name of listSysDir('/sys/class/power_supply')) {
		const base = `/sys/class/power_supply/${name}`;

		if ((readSysFile(`${base}/type`) || '').toLowerCase() !== 'battery') {
			continue;
		};

		const capacity = Number(readSysFile(`${base}/capacity`));
		const status = (readSysFile(`${base}/status`) || '').toLowerCase();

		if (Number.isFinite(capacity)) {
			percentage = Math.max(0, Math.min(100, Math.round(capacity)));
		};

		charging = status === 'charging' || status === 'full';
		break;
	};

	return {percentage, charging};
};

function readTemperature() {
	let best = null;

	for (const name of listSysDir('/sys/class/thermal')) {
		if (!name.startsWith('thermal_zone')) {
			continue;
		};

		const base = `/sys/class/thermal/${name}`;
		const raw = Number(readSysFile(`${base}/temp`));

		if (!Number.isFinite(raw)) {
			continue;
		};

		const celsius = raw > 1000 ? raw / 1000 : raw;

		if (celsius <= 0 || celsius > 150) {
			continue;
		};

		const preferred = /x86_pkg_temp|cpu|pkg|core|soc|acpitz|k10temp|zenpower/.test((readSysFile(`${base}/type`) || '').toLowerCase());

		if (best === null || (preferred && !best.preferred) || (preferred === best.preferred && celsius > best.temp)) {
			best = {temp: celsius, preferred};
		};
	};

	return best ? best.temp : null;
};

function readLoad() {
	const line = readSysFile('/proc/loadavg');

	if (!line) {
		return null;
	};

	const load = Number(line.split(/\s+/)[0]);
	const cores = Math.max(1, GLib.get_num_processors ? GLib.get_num_processors() : 1);

	if (!Number.isFinite(load)) {
		return null;
	};

	return Math.max(0, Math.min(100, Math.round((load / cores) * 100)));
};

function readMemory() {
	const text = readSysFile('/proc/meminfo');

	if (!text) {
		return null;
	};

	let total = null;
	let available = null;
	let free = null;
	let buffers = null;
	let cached = null;

	for (const line of text.split('\n')) {
		const [key, rawValue] = line.split(':');

		if (!key || !rawValue) {
			continue;
		};

		const value = Number(rawValue.trim().split(/\s+/)[0]);

		if (!Number.isFinite(value)) {
			continue;
		};

		switch (key) {
			case 'MemTotal': total = value; break;
			case 'MemAvailable': available = value; break;
			case 'MemFree': free = value; break;
			case 'Buffers': buffers = value; break;
			case 'Cached': cached = value; break;
			default: break;
		};
	};

	if (!Number.isFinite(total) || total <= 0) {
		return null;
	};

	if (!Number.isFinite(available)) {
		if (!Number.isFinite(free)) {
			return null;
		};

		available = free + (buffers || 0) + (cached || 0);
	};

	return Math.max(0, Math.min(100, Math.round(((total - available) / total) * 100)));
};

// A dasai-mochi style face: two big eyes and a small mouth that reacts to the
// laptop's own vitals (chip temperature, battery, CPU load and RAM usage).
const MochiFace = GObject.registerClass(
	class MochiFace extends St.DrawingArea {
		_init(color, theme, animate, dev, onStatus, thresholds) {
			super._init({
				style_class: 'widget-bambu-mochi',
				x_expand: true,
				y_expand: true,
				x_align: Clutter.ActorAlign.FILL,
				y_align: Clutter.ActorAlign.FILL,
			});

			this._color = color;
			this._theme = theme;
			this._animate = animate;
			this._dev = dev || null;
			this._onStatus = onStatus || null;
			this._thresholds = {
				hot: thresholds?.hot ?? HOT_TEMP_C,
				battery: thresholds?.battery ?? LOW_BATTERY,
				load: thresholds?.load ?? HIGH_LOAD,
				ram: thresholds?.ram ?? HIGH_RAM,
			};
			this._timerId = 0;
			this._frame = 0;
			this._temp = null;
			this._load = null;
			this._ram = null;
			this._battery = null;
			this._charging = false;
			this._mood = 'chill';
			this._active = [];
			this._nextBlink = 0;
			this._blinkUntil = 0;
			this._lookUntil = 0;
			this._smileUntil = 0;
			this._lookX = 0;
			this._lookY = 0;
			this._devIndex = -1;
			this._devSwitchAt = 0;

			this._readStats();
			this._mood = this._resolveMood(this._now());
			this._notifyStatus();

			if (animate) {
				this._scheduleBlink(this._now());
				this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
					if (!this.get_parent()) {
						this._timerId = 0;
						return GLib.SOURCE_REMOVE;
					};

					this._advance();
					this.queue_repaint();
					return GLib.SOURCE_CONTINUE;
				});
			};

			this.connect('destroy', this._onDestroy.bind(this));
		};

		_now() {
			return GLib.get_monotonic_time() / 1000000;
		};

		_readStats() {
			const battery = readBattery();

			this._temp = readTemperature();
			this._load = readLoad();
			this._ram = readMemory();
			this._battery = battery.percentage;
			this._charging = battery.charging;
		};

		devStatus() {
			if (!this._dev) {
				return '';
			};

			const temp = this._temp === null ? '--' : `${Math.round(this._temp)}°C`;
			const battery = this._battery === null ? '--' : `${this._battery}%`;
			const load = this._load === null ? '--' : `load ${this._load}%`;
			const ram = this._ram === null ? '--' : `ram ${this._ram}%`;
			const combo = this._active.length ? this._active.join('+') : 'chill';

			return `${combo} · ${temp} · ${battery} · ${load} · ${ram}`;
		};

		_notifyStatus() {
			this._onStatus?.(this.devStatus());
		};

		_conditions() {
			const active = [];

			if (this._temp !== null && this._temp >= this._thresholds.hot) {
				active.push('hot');
			};

			if (this._ram !== null && this._ram >= this._thresholds.ram) {
				active.push('overload');
			};

			if (this._battery !== null && this._battery <= this._thresholds.battery && !this._charging) {
				active.push('sleepy');
			};

			if (this._charging && this._battery !== null && this._battery < 100) {
				active.push('charging');
			};

			if (this._load !== null && this._load >= this._thresholds.load) {
				active.push('busy');
			};

			return active;
		};

		_dominant(active) {
			for (const mood of MOOD_PRIORITY) {
				if (active.includes(mood)) {
					return mood;
				};
			};

			return 'chill';
		};

		_selectMood() {
			this._active = this._conditions();

			return this._dominant(this._active);
		};

		_resolveMood(now) {
			if (this._dev) {
				if (this._dev.cycle) {
					if (now >= this._devSwitchAt) {
						this._devIndex = (this._devIndex + 1) % DEV_MOODS.length;
						this._devSwitchAt = now + DEV_CYCLE_SECONDS;
					};

					this._active = [DEV_MOODS[Math.max(0, this._devIndex)]];
					return this._active[0];
				};

				if (this._dev.mood && this._dev.mood !== 'auto' && DEV_MOODS.includes(this._dev.mood)) {
					this._active = [this._dev.mood];
					return this._dev.mood;
				};
			};

			return this._selectMood();
		};

		_scheduleBlink(now) {
			this._nextBlink = now + 2 + Math.random() * 3.5;
		};

		_advance() {
			const now = this._now();

			this._frame++;

			if (this._frame % 16 === 0) {
				this._readStats();
				this._notifyStatus();
			};

			this._mood = this._resolveMood(now);

			if (this._mood === 'chill') {
				if (now >= this._nextBlink) {
					this._blinkUntil = now + 0.14;
					this._scheduleBlink(now);
				};

				if (now >= this._lookUntil) {
					this._lookX = Math.random() * 2 - 1;
					this._lookY = Math.random() * 2 - 1;
					this._lookUntil = now + 1 + Math.random() * 2;
				};

				if (now >= this._smileUntil && Math.random() < 0.02) {
					this._smileUntil = now + 1.2;
				};
			} else {
				this._blinkUntil = 0;
				this._lookX = 0;
				this._lookY = 0;
			};
		};

		_onDestroy() {
			if (this._timerId) {
				GLib.Source.remove(this._timerId);
				this._timerId = 0;
			};
		};

		_eye(cr, cx, cy, eyeW, eyeH, mode, rgb, ink, now) {
			if (mode === 'closed') {
				cr.newPath();
				roundedRect(cr, cx - eyeW * 0.62, cy - eyeW * 0.18, eyeW * 1.24, eyeW * 0.36, eyeW * 0.18);
				cr.setSourceRGBA(...rgb, 1);
				cr.fill();
				return;
			};

			if (mode === 'happy') {
				cr.newPath();
				cr.setLineCap(1);
				cr.setLineWidth(eyeW * 0.55);
				cr.arc(cx, cy + eyeH * 0.22, eyeW, Math.PI * 1.12, Math.PI * 1.88);
				cr.setSourceRGBA(...rgb, 1);
				cr.stroke();
				return;
			};

			if (mode === 'strain') {
				const eh = eyeH * 0.64;

				cr.newPath();
				roundedRect(cr, cx - eyeW / 2, cy - eh / 2, eyeW, eh, eyeW / 2);
				cr.setSourceRGBA(...rgb, 1);
				cr.fill();

				cr.newPath();
				cr.arc(cx, cy - eh * 0.1, Math.min(eyeW, eh) * 0.18, 0, Math.PI * 2);
				cr.setSourceRGBA(...hexToRgba(ink, 0.92));
				cr.fill();
				return;
			};

			cr.newPath();
			roundedRect(cr, cx - eyeW / 2, cy - eyeH / 2, eyeW, eyeH, eyeW / 2);
			cr.setSourceRGBA(...rgb, 1);
			cr.fill();

			const dizzy = mode === 'dizzy';
			const hx = dizzy ? Math.cos(now * 9) * eyeW * 0.28 : -eyeW * 0.16;
			const hy = dizzy ? Math.sin(now * 8) * eyeH * 0.26 : -eyeH * 0.24;

			cr.newPath();
			cr.arc(cx + hx, cy + hy, Math.min(eyeW, eyeH) * 0.26, 0, Math.PI * 2);
			cr.setSourceRGBA(...hexToRgba(ink, 0.9));
			cr.fill();
		};

		_mouth(cr, cx, cy, radius, mode, rgb) {
			cr.setLineCap(1);

			if (mode === 'open') {
				cr.newPath();
				cr.arc(cx, cy, radius * 0.8, 0, Math.PI * 2);
				cr.setSourceRGBA(...rgb, 1);
				cr.fill();
				return;
			};

			if (mode === 'smile') {
				cr.newPath();
				cr.setLineWidth(Math.max(2, radius * 0.5));
				cr.arc(cx, cy - radius * 0.3, radius, Math.PI * 0.2, Math.PI * 0.8);
				cr.setSourceRGBA(...rgb, 1);
				cr.stroke();
				return;
			};

			if (mode === 'wave') {
				cr.newPath();
				cr.setLineWidth(Math.max(2, radius * 0.45));
				cr.moveTo(cx - radius, cy);
				cr.curveTo(cx - radius * 0.4, cy - radius, cx + radius * 0.4, cy + radius, cx + radius, cy);
				cr.setSourceRGBA(...rgb, 1);
				cr.stroke();
				return;
			};

			cr.newPath();
			cr.setLineWidth(Math.max(2, radius * 0.5));
			cr.moveTo(cx - radius, cy);
			cr.lineTo(cx + radius, cy);
			cr.setSourceRGBA(...rgb, 1);
			cr.stroke();
		};

		_sweat(cr, w, h, now, rgb) {
			for (let i = 0; i < 2; i++) {
				const phase = (now * 0.7 + i * 0.5) % 1;
				const alpha = Math.sin(phase * Math.PI) * 0.85;
				const dropX = (i === 0 ? 0.18 : 0.82) * w;
				const dropY = (0.34 + phase * 0.3) * h;
				const dropR = 0.035 * h;

				cr.newPath();
				cr.arc(dropX, dropY, dropR, 0, Math.PI * 2);
				cr.setSourceRGBA(...rgb, alpha);
				cr.fill();

				cr.newPath();
				cr.moveTo(dropX - dropR * 0.7, dropY - dropR * 0.3);
				cr.lineTo(dropX, dropY - dropR * 2.1);
				cr.lineTo(dropX + dropR * 0.7, dropY - dropR * 0.3);
				cr.closePath();
				cr.setSourceRGBA(...rgb, alpha);
				cr.fill();
			};
		};

		_steam(cr, w, h, now, rgb) {
			cr.setLineCap(1);
			cr.setLineWidth(Math.max(2, 0.015 * h));

			for (let i = 0; i < 2; i++) {
				const x = (i === 0 ? 0.32 : 0.68) * w;
				const alpha = Math.max(0, 0.35 + 0.25 * Math.sin(now * 4 + i));

				cr.newPath();
				cr.moveTo(x, 0.16 * h);
				cr.curveTo(x - 0.05 * h, 0.1 * h, x + 0.05 * h, 0.06 * h, x, 0.0);
				cr.setSourceRGBA(...rgb, alpha);
				cr.stroke();
			};
		};

		_sparkle(cr, x, y, r, alpha, rgb) {
			cr.newPath();
			cr.moveTo(x, y - r);
			cr.lineTo(x + r * 0.25, y - r * 0.25);
			cr.lineTo(x + r, y);
			cr.lineTo(x + r * 0.25, y + r * 0.25);
			cr.lineTo(x, y + r);
			cr.lineTo(x - r * 0.25, y + r * 0.25);
			cr.lineTo(x - r, y);
			cr.lineTo(x - r * 0.25, y - r * 0.25);
			cr.closePath();
			cr.setSourceRGBA(...rgb, alpha);
			cr.fill();
		};

		_zzz(cr, w, h, now, rgb) {
			cr.setLineCap(1);

			for (let i = 0; i < 3; i++) {
				const phase = (now * 0.35 + i / 3) % 1;
				const alpha = Math.min(1, Math.max(0, Math.sin(phase * Math.PI) * 1.5));
				const x = (0.64 + phase * 0.18) * w;
				const y = (0.34 - phase * 0.3) * h;
				const s = (0.045 + phase * 0.035) * h;

				cr.newPath();
				cr.moveTo(x, y);
				cr.lineTo(x + s, y);
				cr.lineTo(x, y + s);
				cr.lineTo(x + s, y + s);
				cr.setLineWidth(Math.max(1.5, 0.012 * h));
				cr.setSourceRGBA(...rgb, alpha);
				cr.stroke();
			};
		};

		_dizzy(cr, w, h, now, rgb) {
			const cx = 0.5 * w;
			const cy = 0.2 * h;

			for (let i = 0; i < 3; i++) {
				const angle = now * 3 + i * (Math.PI * 2 / 3);
				const x = cx + Math.cos(angle) * 0.13 * w;
				const y = cy + Math.sin(angle) * 0.05 * h;

				this._sparkle(cr, x, y, 0.035 * h, 0.9, rgb);
			};
		};

		_loader(cr, w, h, now, rgb) {
			const cx = 0.5 * w;
			const cy = 0.17 * h;
			const radius = Math.min(0.11 * h, 0.16 * w);

			cr.setLineCap(1);
			cr.setLineWidth(Math.max(2, 0.022 * h));

			cr.newPath();
			cr.arc(cx, cy, radius, 0, Math.PI * 2);
			cr.setSourceRGBA(...rgb, 0.18);
			cr.stroke();

			const start = now * 3.2;

			cr.newPath();
			cr.arc(cx, cy, radius, start, start + Math.PI * 0.75);
			cr.setSourceRGBA(...rgb, 0.9);
			cr.stroke();
		};

		_puffs(cr, w, h, now, rgb) {
			for (let i = 0; i < 2; i++) {
				const dir = i === 0 ? -1 : 1;

				for (let j = 0; j < 2; j++) {
					const phase = (now * 0.55 + j * 0.5 + i * 0.25) % 1;
					const alpha = Math.sin(phase * Math.PI) * 0.6;
					const px = (i === 0 ? 0.14 : 0.86) * w + dir * phase * 0.08 * w;
					const py = (0.58 - phase * 0.3) * h;
					const pr = (0.03 + phase * 0.03) * h;

					for (const [dx, dy, s] of [[-0.8, 0, 0.7], [0, 0, 1], [0.8, 0, 0.7]]) {
						cr.newPath();
						cr.arc(px + dx * pr, py + dy * pr, pr * s, 0, Math.PI * 2);
						cr.setSourceRGBA(...rgb, alpha);
						cr.fill();
					};
				};
			};
		};

		_fan(cr, w, h, now, rgb) {
			const cx = 0.14 * w;
			const cy = 0.16 * h;
			const radius = Math.min(0.1 * h, 0.13 * w);

			cr.save();
			cr.translate(cx, cy);
			cr.rotate(now * 5);

			for (let i = 0; i < 3; i++) {
				cr.save();
				cr.rotate((i * 2 * Math.PI) / 3);
				cr.newPath();
				cr.moveTo(0, 0);
				cr.curveTo(radius * 0.4, -radius * 0.22, radius * 0.9, -radius * 0.26, radius, 0);
				cr.curveTo(radius * 0.9, radius * 0.26, radius * 0.4, radius * 0.22, 0, 0);
				cr.closePath();
				cr.setSourceRGBA(...rgb, 0.7);
				cr.fill();
				cr.restore();
			};

			cr.newPath();
			cr.arc(0, 0, radius * 0.16, 0, Math.PI * 2);
			cr.setSourceRGBA(...rgb, 0.95);
			cr.fill();
			cr.restore();
		};

		_ekg(cr, w, h, now, rgb) {
			const baseY = 0.92 * h;
			const amp = 0.1 * h;
			const steps = 72;
			const sample = p => {
				if (p < 0.08) {
					return Math.sin((p / 0.08) * Math.PI) * 0.35;
				};

				if (p < 0.16) {
					return 0;
				};

				if (p < 0.20) {
					return -((p - 0.16) / 0.04) * 0.25;
				};

				if (p < 0.24) {
					return -0.25 + ((p - 0.20) / 0.04) * 1.45;
				};

				if (p < 0.28) {
					return 1.2 - ((p - 0.24) / 0.04) * 1.7;
				};

				if (p < 0.34) {
					return -0.5 + ((p - 0.28) / 0.06) * 0.5;
				};

				if (p < 0.5) {
					return Math.sin(((p - 0.34) / 0.16) * Math.PI) * 0.4;
				};

				return 0;
			};

			cr.setLineCap(1);
			cr.setLineJoin(1);
			cr.setLineWidth(Math.max(1.4, 0.011 * h));
			cr.newPath();

			for (let i = 0; i <= steps; i++) {
				const x = (i / steps) * w;
				const y = baseY - sample((now * 0.5 + i / steps) % 1) * amp;

				if (i === 0) {
					cr.moveTo(x, y);
				} else {
					cr.lineTo(x, y);
				};
			};

			cr.setSourceRGBA(...rgb, 0.7);
			cr.stroke();
		};

		_alarm(cr, w, h, now, rgb) {
			const cx = 0.5 * w;
			const cy = 0.5 * h;
			const base = Math.min(w, h);

			cr.setLineCap(1);

			for (let i = 0; i < 2; i++) {
				const phase = (now * 1.1 + i * 0.5) % 1;
				const alpha = (1 - phase) * 0.45;

				cr.newPath();
				cr.arc(cx, cy, base * (0.4 + phase * 0.22), 0, Math.PI * 2);
				cr.setLineWidth(Math.max(2, 0.012 * base));
				cr.setSourceRGBA(...rgb, alpha);
				cr.stroke();
			};

			const ax = 0.85 * w;
			const ay = 0.16 * h;
			const s = Math.min(0.1 * h, 0.13 * w);
			const pulse = 0.5 + 0.5 * Math.sin(now * 6);

			cr.setSourceRGBA(...rgb, 0.55 + 0.45 * pulse);
			cr.newPath();
			roundedRect(cr, ax - s * 0.12, ay - s * 0.5, s * 0.24, s * 0.62, s * 0.12);
			cr.fill();
			cr.newPath();
			cr.arc(ax, ay + s * 0.42, s * 0.15, 0, Math.PI * 2);
			cr.fill();
		};

		vfunc_repaint() {
			const cr = this.get_context();
			const [width, height] = this.get_surface_size();

			if (width <= 0 || height <= 0) {
				cr.$dispose();
				return;
			};

			const now = this._now();
			const w = width;
			const h = height;
			const mood = this._mood;
			const active = this._active.length ? this._active : [mood];
			const stress = active.filter(item => item !== 'charging').length;
			const critical = stress >= CRITICAL_STRESS;
			const baseColor = critical ? CRITICAL_COLOR : (active.includes('hot') ? HOT_COLOR : this._color);
			const rgb = hexToRgb(baseColor);
			const catchInk = contrastInk(baseColor, this._theme?.text);
			const bob = active.includes('sleepy') && this._animate ? Math.sin(now * 2) * 0.02 * h : 0;
			const blink = this._animate && now < this._blinkUntil;

			cr.save();
			cr.translate(0, bob);

			if (active.includes('overload') && this._animate) {
				const pulse = 1 + Math.sin(now * 3.2) * 0.035;

				cr.translate(0.5 * w, 0.5 * h);
				cr.scale(pulse, pulse);
				cr.translate(-0.5 * w, -0.5 * h);
			};

			if (this._animate && stress >= 2) {
				const amp = Math.min(0.018, (stress - 1) * 0.006) * w;

				cr.translate(Math.sin(now * 42) * amp, Math.cos(now * 37) * amp * 0.6);
			};

			const eyeH = Math.min(0.42 * h, 0.92 * w);
			const eyeW = eyeH * 0.58;
			const eyeY = 0.45 * h + this._lookY * eyeH * 0.07 - (active.includes('hot') ? 0.02 * h : 0);
			const leftX = 0.32 * w + this._lookX * eyeW * 0.22;
			const rightX = 0.68 * w + this._lookX * eyeW * 0.22;
			const mouthR = Math.min(0.09 * h, 0.11 * w);
			const mouthY = 0.75 * h;

			if (active.includes('hot')) {
				this._steam(cr, w, h, now, rgb);
			};

			if (active.includes('charging') && this._animate) {
				for (let i = 0; i < 3; i++) {
					const phase = (now * 0.6 + i / 3) % 1;
					const alpha = Math.sin(phase * Math.PI);
					const sx = (0.2 + i * 0.3) * w;
					const sy = (0.18 + (i % 2) * 0.12) * h;

					this._sparkle(cr, sx, sy, 0.05 * h, Math.max(0, alpha), rgb);
				};
			};

			if (active.includes('overload') && this._animate) {
				this._loader(cr, w, h, now, rgb);
			};

			if (active.includes('hot') && this._animate) {
				this._fan(cr, w, h, now, rgb);
			};

			if (active.includes('busy') && this._animate) {
				this._ekg(cr, w, h, now, rgb);
			};

			if (critical && this._animate) {
				this._alarm(cr, w, h, now, rgb);
			};

			let eyeMode;

			if (mood === 'sleepy') {
				eyeMode = 'closed';
			} else if (mood === 'charging') {
				eyeMode = 'happy';
			} else if (mood === 'busy') {
				eyeMode = 'dizzy';
			} else if (mood === 'overload') {
				eyeMode = 'strain';
			} else if (blink) {
				eyeMode = 'closed';
			} else {
				eyeMode = 'open';
			};

			this._eye(cr, leftX, eyeY, eyeW, eyeH, eyeMode, rgb, catchInk, now);
			this._eye(cr, rightX, eyeY, eyeW, eyeH, eyeMode, rgb, catchInk, now);

			let mouthMode;

			if (mood === 'hot') {
				mouthMode = 'open';
			} else if (mood === 'sleepy') {
				mouthMode = 'wave';
			} else if (mood === 'charging') {
				mouthMode = 'smile';
			} else if (mood === 'busy') {
				mouthMode = 'open';
			} else if (mood === 'overload') {
				mouthMode = 'open';
			} else {
				mouthMode = now < this._smileUntil ? 'smile' : 'flat';
			};

			this._mouth(cr, 0.5 * w, mouthY, mouthR, mouthMode, rgb);

			if (active.includes('hot')) {
				this._sweat(cr, w, h, now, hexToRgb('#7ec8ff'));
			};

			if (active.includes('sleepy') && this._animate) {
				this._zzz(cr, w, h, now, rgb);
			};

			if (active.includes('busy') && this._animate) {
				this._dizzy(cr, w, h, now, rgb);
			};

			if (active.includes('overload') && this._animate) {
				this._puffs(cr, w, h, now, rgb);
			};

			cr.restore();
			cr.$dispose();
		};
	});

export function style(theme) {
	return `color: ${theme.text};`;
};

function addCenteredHint(body, createLabel, theme, text) {
	body.add_child(new St.Widget({y_expand: true}));
	const hint = createLabel(text, 'widget-bambu-hint', `color: ${theme.muted};`);
	hint.x_align = Clutter.ActorAlign.CENTER;
	hint.clutter_text.set_line_wrap(true);
	body.add_child(hint);
	body.add_child(new St.Widget({y_expand: true}));
};

function buildOfflineScene({body, createLabel, theme, animate, color, caption, dev, thresholds}) {
	let statusLabel = null;
	const face = new MochiFace(color, theme, animate, dev, text => {
		if (statusLabel) {
			statusLabel.text = text;
		};
	}, thresholds);

	body.add_child(face);

	if (caption) {
		const label = createLabel(caption, 'widget-bambu-mochi-caption', `color: ${theme.muted};`);

		label.x_align = Clutter.ActorAlign.CENTER;
		label.clutter_text.set_line_wrap(true);
		body.add_child(label);
	};

	if (dev) {
		statusLabel = createLabel('', 'widget-bambu-dev-status', `color: ${theme.muted};`);
		statusLabel.x_align = Clutter.ActorAlign.CENTER;
		statusLabel.clutter_text.set_line_wrap(true);
		body.add_child(statusLabel);
		statusLabel.text = face.devStatus();
	};
};

function buildRing(progress, color, theme, size, createLabel) {
	const wrap = new St.Widget({
		style_class: 'widget-bambu-ring-wrap',
		style: `width: ${size}px; height: ${size}px;`,
		y_align: Clutter.ActorAlign.CENTER,
	});
	const ring = new ProgressRing(progress, color, theme);

	ring.set_size(size, size);
	wrap.add_child(ring);

	const overlay = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-bambu-ring-overlay',
	});

	overlay.set_size(size, size);
	overlay.set_position(0, 0);
	overlay.add_child(new St.Widget({y_expand: true}));

	const percentText = progress === null ? '--' : `${Math.round(progress)}%`;
	const percent = createLabel(percentText, 'widget-bambu-ring-value', `font-size: ${Math.round(size * 0.3)}px; color: ${theme.text};`);

	percent.x_align = Clutter.ActorAlign.CENTER;
	percent.clutter_text.set_line_wrap(false);
	overlay.add_child(percent);
	overlay.add_child(new St.Widget({y_expand: true}));
	wrap.add_child(overlay);

	return wrap;
};

function buildMetaRow(createLabel, theme, iconName, text) {
	const row = new St.BoxLayout({
		style_class: 'widget-bambu-meta-row',
		x_align: Clutter.ActorAlign.START,
	});
	const icon = new St.Icon({
		icon_name: iconName,
		style_class: 'widget-bambu-meta-icon',
		style: `color: ${theme.muted};`,
		y_align: Clutter.ActorAlign.CENTER,
	});
	const label = createLabel(text, 'widget-bambu-meta-text', `color: ${theme.muted};`);

	label.x_expand = false;
	label.clutter_text.set_line_wrap(false);
	row.add_child(icon);
	row.add_child(label);

	return row;
};

function buildAmsRow(createLabel, theme, filament) {
	const slots = filament?.ams ?? [];

	if (slots.length === 0) {
		return null;
	};

	const row = new St.BoxLayout({
		style_class: 'widget-bambu-ams',
		x_align: Clutter.ActorAlign.START,
	});

	for (const slot of slots) {
		const dot = new St.Widget({
			style_class: slot.active ? 'widget-bambu-ams-dot widget-bambu-ams-dot-active' : 'widget-bambu-ams-dot',
			style: `background-color: ${normalizeColor(slot.color)};`,
			y_align: Clutter.ActorAlign.CENTER,
		});

		dot.set_size(slot.active ? 18 : 14, slot.active ? 18 : 14);
		row.add_child(dot);
	};

	const active = slots.find(slot => slot.active) ?? slots[0];
	const text = active?.type ? `AMS · ${active.type}` : 'AMS';
	const label = createLabel(text, 'widget-bambu-ams-text', `color: ${theme.muted};`);

	label.x_expand = false;
	label.clutter_text.set_line_wrap(false);
	row.add_child(label);

	return row;
};

function buildJobView({body, widget, createLabel, theme, sizeForWidget, status}) {
	const [width, height] = sizeForWidget(widget);
	const job = status.job ?? {};
	const temps = status.temperatures ?? {};
	const printer = status.printer ?? {};
	const progress = clampProgress(job.progress);
	const state = String(job.state || 'IDLE').toUpperCase();
	const color = STATE_COLORS[state] ?? theme.accent;
	const ringSize = Math.round(Math.min(Math.max(96, height - 96), Math.max(96, width * 0.44)));

	const mainRow = new St.BoxLayout({
		style_class: 'widget-bambu-main',
		x_expand: true,
		y_expand: true,
	});

	mainRow.add_child(buildRing(progress, color, theme, ringSize, createLabel));

	const info = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-bambu-info',
		x_expand: true,
		y_expand: true,
	});
	const header = new St.BoxLayout({
		style_class: 'widget-bambu-header',
		x_expand: true,
	});

	const name = createLabel(printer.name || printer.model || 'Bambu Lab', 'widget-bambu-name', `color: ${theme.muted};`);

	name.clutter_text.set_line_wrap(false);
	header.add_child(name);

	const badge = createLabel(STATE_LABELS[state] || state, 'widget-bambu-badge', `color: ${color ?? theme.muted};`);

	badge.x_expand = false;
	badge.clutter_text.set_line_wrap(false);
	header.add_child(badge);
	info.add_child(header);

	const file = createLabel(job.file || job.subtask || 'No active print', 'widget-bambu-file', `color: ${theme.text};`);

	file.clutter_text.set_line_wrap(true);
	info.add_child(file);

	const remaining = formatRemaining(job.remaining_min);

	if (remaining) {
		info.add_child(buildMetaRow(createLabel, theme, 'alarm-symbolic', remaining));
	};

	if (Number.isFinite(job.layer) && Number.isFinite(job.total_layers)) {
		info.add_child(buildMetaRow(createLabel, theme, 'view-grid-symbolic', `Layer ${job.layer} / ${job.total_layers}`));
	};

	info.add_child(new St.Widget({y_expand: true}));
	info.add_child(buildMetaRow(createLabel, theme, 'emblem-system-symbolic', `Nozzle ${temperature(temps.nozzle)} · Bed ${temperature(temps.bed)}`));

	const amsRow = buildAmsRow(createLabel, theme, status.filament);

	if (amsRow) {
		info.add_child(amsRow);
	};

	mainRow.add_child(info);
	body.add_child(mainRow);
};

export function render({body, widget, createLabel, theme, sizeForWidget, bambu, settings, animate}) {
	if (!bambu) {
		addCenteredHint(body, createLabel, theme, 'Bambu Lab is unavailable');
		return;
	};

	const fun = settings?.get_boolean('bambu-offline-fun') ?? false;
	const always = settings?.get_boolean('bambu-offline-always') ?? false;
	const devMode = settings?.get_boolean('dev-mode') ?? false;

	const showScene = () => buildOfflineScene({
		body,
		createLabel,
		theme,
		animate: animate !== false,
		color: settings.get_string('bambu-offline-color') || theme.accent,
		caption: settings.get_string('bambu-offline-caption').trim(),
		dev: devMode
			? {
				mood: settings.get_string('bambu-dev-mood') || 'auto',
				cycle: settings.get_boolean('bambu-dev-cycle'),
			}
			: null,
		thresholds: {
			hot: settings.get_int('bambu-hot-temp'),
			battery: settings.get_int('bambu-low-battery'),
			load: settings.get_int('bambu-high-load'),
			ram: settings.get_int('bambu-high-ram'),
		},
	});

	if (always && fun) {
		showScene();
		return;
	};

	if (bambu.state === 'unavailable') {
		addCenteredHint(body, createLabel, theme, 'Configure the Bambu bridge endpoint and token in Settings');
		return;
	};

	if (bambu.state === 'error') {
		if (fun) {
			showScene();
			return;
		};

		addCenteredHint(body, createLabel, theme, bambu.error || 'Bambu bridge unreachable');
		return;
	};

	if (bambu.state === 'idle') {
		addCenteredHint(body, createLabel, theme, bambu.error || 'Connecting to the Bambu bridge…');
		return;
	};

	const status = bambu.status;

	if (!status) {
		addCenteredHint(body, createLabel, theme, 'Waiting for the Bambu bridge…');
		return;
	};

	if (status.connected !== true) {
		if (fun) {
			showScene();
			return;
		};

		addCenteredHint(body, createLabel, theme, 'Printer offline');
		return;
	};

	buildJobView({body, widget, createLabel, theme, sizeForWidget, status});
};
