import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export const type = 'calendar';
export function label() { return _('Calendar'); };
export const stylesheet = 'widgets/calendar/stylesheet.css';
export const appIds = ['org.gnome.Calendar.desktop'];
export const defaultSize = 'small';

const CALENDAR_CELL_WIDTH = 24;
const CALENDAR_CELL_HEIGHT = 24;
const COMPACT_CALENDAR_CELL_HEIGHT = 23;
const TODAY_CIRCLE_SIZE = 18;

function linearChannel(value) {
	const scaled = value / 255;

	return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
};

function accentLuminance(hex) {
	const cleaned = String(hex || '').replace('#', '').trim();
	const full = cleaned.length === 3
		? cleaned.split('').map(part => part + part).join('')
		: cleaned.padEnd(6, '0').slice(0, 6);
	const value = Number.parseInt(full, 16);

	if (!Number.isFinite(value)) {
		return 0;
	};

	return 0.2126 * linearChannel((value >> 16) & 0xff) +
		0.7152 * linearChannel((value >> 8) & 0xff) +
		0.0722 * linearChannel(value & 0xff);
};

function todayInk(accent) {
	// Dark ink above this threshold reads better than white on light accents
	// (e.g. yellow), while blue and other dark accents keep white text.
	return accentLuminance(accent) > 0.25 ? '#111111' : '#ffffff';
};
const DOTS_HEIGHT = 5;
const DOT_SIZE = 4;
const MAX_DOTS = 3;

function formatMonth(date) {
	return date.toLocaleDateString(undefined, {
		month: 'long',
		year: 'numeric',
	});
};

function dateKey(year, month, day) {
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

function dotsGroup(count, color) {
	const row = new St.BoxLayout({
		style_class: 'widget-calendar-dots',
		x_align: Clutter.ActorAlign.CENTER,
		x_expand: false,
	});

	row.set_height(DOTS_HEIGHT);

	if (!count) {
		return row;
	};

	if (count > MAX_DOTS) {
		const bar = new St.Widget({
			style_class: 'widget-calendar-bar',
			style: `background-color: ${color};`,
		});

		bar.set_size(10, 3);
		row.add_child(bar);
		return row;
	};

	for (let i = 0; i < count; i++) {
		const dot = new St.Widget({
			style_class: 'widget-calendar-dot',
			style: `background-color: ${color};`,
		});

		dot.set_size(DOT_SIZE, DOT_SIZE);
		row.add_child(dot);
	};

	return row;
};

function calendarCell(text, labelStyle, highlightColor, createLabel, cellHeight, dots = null) {
	const bin = new St.Bin({
		style_class: 'widget-calendar-cell',
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		x_expand: false,
		y_expand: false,
	});
	const content = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-calendar-cell-content',
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
	});
	const labelActor = createLabel(text, 'widget-calendar-day', labelStyle);
	const numberBox = new St.Bin({
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		x_expand: false,
		y_expand: false,
	});

	labelActor.x_expand = false;
	labelActor.x_align = Clutter.ActorAlign.CENTER;
	labelActor.y_align = Clutter.ActorAlign.CENTER;

	numberBox.set_size(TODAY_CIRCLE_SIZE, TODAY_CIRCLE_SIZE);

	if (highlightColor) {
		numberBox.style_class = 'widget-calendar-today';
		numberBox.style = `background-color: ${highlightColor};`;
	};

	numberBox.set_child(labelActor);
	content.add_child(new St.Widget({y_expand: true}));
	content.add_child(numberBox);
	content.add_child(dots ?? dotsGroup(0, null));
	content.add_child(new St.Widget({y_expand: true}));
	bin.set_size(CALENDAR_CELL_WIDTH, cellHeight);
	bin.set_child(content);
	return bin;
};

export function style(theme) {
	return `color: ${theme.text}; padding: 12px 15px;`;
};

export function render({body, createLabel, theme, calendar}) {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth();
	const today = now.getDate();
	const first = new Date(year, month, 1);
	const days = new Date(year, month + 1, 0).getDate();
	const start = first.getDay();
	const weekCount = Math.ceil((start + days) / 7);
	const compact = weekCount === 6;
	const cellHeight = compact ? COMPACT_CALENDAR_CELL_HEIGHT : CALENDAR_CELL_HEIGHT;
	const counts = calendar ? calendar.eventCountsForMonth(year, month) : null;
	const monthLabel = createLabel(
		formatMonth(now),
		'widget-calendar-month',
		`color: ${theme.text};`);
	const grid = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: compact ? 'widget-calendar-grid widget-calendar-grid-compact' : 'widget-calendar-grid',
		x_align: Clutter.ActorAlign.CENTER,
	});
	const content = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-calendar-content',
		x_align: Clutter.ActorAlign.CENTER,
	});
	const weekdays = [_('S'), _('M'), _('T'), _('W'), _('T'), _('F'), _('S')];
	const weekdayRow = new St.BoxLayout({style_class: 'widget-calendar-row'});
	let day = 1;

	monthLabel.x_expand = false;
	content.add_child(monthLabel);
	for (const [column, weekday] of weekdays.entries()) {
		const color = column === 0 || column === 6 ? theme.muted : theme.text;

		weekdayRow.add_child(calendarCell(weekday, `color: ${color}; font-weight: 700;`, null, createLabel, cellHeight));
	};
	grid.add_child(weekdayRow);

	for (let rowIndex = 0; rowIndex < weekCount; rowIndex++) {
		const row = new St.BoxLayout({style_class: 'widget-calendar-row'});

		for (let column = 0; column < 7; column++) {
			if ((rowIndex === 0 && column < start) || day > days) {
				row.add_child(calendarCell('', '', null, createLabel, cellHeight));
				continue;
			};

			const isToday = day === today;
			const isWeekend = column === 0 || column === 6;
			const count = counts ? counts.get(dateKey(year, month, day)) ?? 0 : 0;
			const labelStyle = isToday
				? `color: ${todayInk(theme.accent)}; font-weight: 800;`
				: `color: ${isWeekend ? theme.muted : theme.text};`;
			const highlightColor = isToday ? theme.accent : null;
			const dotColor = isToday ? todayInk(theme.accent) : theme.accent;

			row.add_child(calendarCell(
				`${day}`,
				labelStyle,
				highlightColor,
				createLabel,
				cellHeight,
				dotsGroup(count, dotColor)));
			day += 1;
		};

		grid.add_child(row);
	};

	content.add_child(grid);
	body.add_child(new St.Widget({y_expand: true}));
	body.add_child(content);
	body.add_child(new St.Widget({y_expand: true}));
};
