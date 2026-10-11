import Clutter from 'gi://Clutter';
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

export function render({body, widget, createLabel, theme, sizeForWidget, bambu}) {
	if (!bambu) {
		addCenteredHint(body, createLabel, theme, 'Bambu Lab is unavailable');
		return;
	};

	if (bambu.state === 'unavailable') {
		addCenteredHint(body, createLabel, theme, 'Configure the Bambu bridge endpoint and token in Settings');
		return;
	};

	if (bambu.state === 'error' || bambu.state === 'idle') {
		addCenteredHint(body, createLabel, theme, bambu.error || 'Connecting to the Bambu bridge…');
		return;
	};

	const status = bambu.status;

	if (!status) {
		addCenteredHint(body, createLabel, theme, 'Waiting for the Bambu bridge…');
		return;
	};

	if (status.connected !== true) {
		addCenteredHint(body, createLabel, theme, 'Printer offline');
		return;
	};

	buildJobView({body, widget, createLabel, theme, sizeForWidget, status});
};
