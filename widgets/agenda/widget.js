import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export const type = 'agenda';
export function label() { return _('Agenda'); };
export const stylesheet = 'widgets/agenda/stylesheet.css';
export const appIds = ['org.gnome.Calendar.desktop'];
export const defaultSize = 'medium';

const USABLE_PADDING = 30;
const HEADER_HEIGHT = 30;
const SECTION_HEIGHT = 22;
const DAY_HEIGHT = 20;
const ROW_HEIGHT = 28;
const UPCOMING_DAYS = 7;

function startOfDay(date) {
	const day = new Date(date);

	day.setHours(0, 0, 0, 0);
	return day;
};

function addDays(date, amount) {
	const next = new Date(date);

	next.setDate(next.getDate() + amount);
	return next;
};

function sameDay(a, b) {
	return a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
};

function formatTime(date) {
	return date.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	});
};

function formatHeader(date) {
	return date.toLocaleDateString(undefined, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
	});
};

function formatDay(date) {
	return date.toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
	});
};

function eventTimeText(event, day) {
	if (event.allDay) {
		return _('All day');
	};

	if (!sameDay(event.startDate, day)) {
		return '→';
	};

	if (!sameDay(event.endDate, day) && event.end > event.start + 60000) {
		return `${formatTime(event.startDate)} →`;
	};

	return formatTime(event.startDate);
};

function buildEntries(calendar, today) {
	const entries = [];
	const todayEvents = calendar.eventsOnDay(today);

	if (todayEvents.length > 0) {
		entries.push({kind: 'section', text: _('Today')});

		for (const event of todayEvents) {
			entries.push({kind: 'event', event, day: today});
		};
	} else {
		entries.push({kind: 'empty', text: _('No events today')});
	};

	for (let offset = 1; offset <= UPCOMING_DAYS; offset++) {
		const day = addDays(today, offset);
		const dayEvents = calendar.eventsOnDay(day);

		if (dayEvents.length === 0) {
			continue;
		};

		entries.push({kind: 'day', date: day});

		for (const event of dayEvents) {
			entries.push({kind: 'event', event, day});
		};
	};

	return entries;
};

function eventRow(event, day, createLabel, theme) {
	const row = new St.BoxLayout({
		style_class: 'widget-agenda-row',
		x_expand: true,
	});
	const time = createLabel(eventTimeText(event, day), 'widget-agenda-time', `color: ${theme.muted};`);
	const dot = new St.Widget({
		style_class: 'widget-agenda-dot',
		style: `background-color: ${event.sourceColor || theme.accent};`,
	});

	dot.set_size(7, 7);

	time.x_expand = false;
	time.x_align = Clutter.ActorAlign.START;

	const titleStyle = event.holiday
		? `color: ${theme.accent}; font-weight: 700;`
		: `color: ${theme.text};`;
	const title = createLabel(event.summary, 'widget-agenda-title', titleStyle);

	row.add_child(time);
	row.add_child(dot);
	row.add_child(title);

	return row;
};

function renderEntry(entry, createLabel, theme) {
	if (entry.kind === 'event') {
		return eventRow(entry.event, entry.day, createLabel, theme);
	};

	if (entry.kind === 'day') {
		return createLabel(formatDay(entry.date), 'widget-agenda-day', `color: ${theme.muted}; font-weight: 700;`);
	};

	if (entry.kind === 'empty') {
		return createLabel(entry.text, 'widget-agenda-message', `color: ${theme.muted};`);
	};

	if (entry.kind === 'more') {
		return createLabel(_('+%s more').format(entry.count), 'widget-agenda-more', `color: ${theme.muted};`);
	};

	return createLabel(entry.text, 'widget-agenda-section', `color: ${theme.muted}; font-weight: 700; letter-spacing: 1px;`);
};

function entryHeight(entry) {
	if (entry.kind === 'event') {
		return ROW_HEIGHT;
	};

	if (entry.kind === 'day' || entry.kind === 'empty') {
		return DAY_HEIGHT;
	};

	return SECTION_HEIGHT;
};

function formatMessage(calendar) {
	if (!calendar) {
		return _('Calendar module unavailable');
	};

	if (calendar.status === 'unavailable') {
		return _('Calendar data unavailable — install python3-gi and Evolution Data Server');
	};

	if (calendar.status === 'error') {
		return calendar.error || _('Could not read calendar data');
	};

	return _('Loading calendar…');
};

export function style(theme) {
	return `color: ${theme.text}; padding: 12px 14px;`;
};

export function render({body, widget, theme, createLabel, calendar, sizeForWidget}) {
	const [, height] = sizeForWidget(widget);
	const usable = height - USABLE_PADDING - HEADER_HEIGHT;
	const now = new Date();
	const today = startOfDay(now);
	const header = new St.BoxLayout({
		style_class: 'widget-agenda-header',
		x_expand: true,
	});

	header.add_child(createLabel(formatHeader(now), 'widget-agenda-title-date', `color: ${theme.text};`));
	body.add_child(header);

	if (!calendar || (calendar.status !== 'ready' && !calendar.available)) {
		body.add_child(new St.Widget({y_expand: true}));
		body.add_child(createLabel(formatMessage(calendar), 'widget-agenda-message', `color: ${theme.muted};`));
		body.add_child(new St.Widget({y_expand: true}));
		return;
	};

	const events = calendar.eventsBetween(today.getTime(), addDays(today, UPCOMING_DAYS + 1).getTime());

	if (events.length === 0) {
		body.add_child(new St.Widget({y_expand: true}));
		body.add_child(createLabel(_('No upcoming events'), 'widget-agenda-message', `color: ${theme.muted};`));
		body.add_child(new St.Widget({y_expand: true}));
		return;
	};

	const entries = buildEntries(calendar, today);
	const list = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-agenda-list',
		x_expand: true,
	});
	let used = 0;
	let rendered = 0;
	let hidden = 0;

	for (const [index, entry] of entries.entries()) {
		const cost = entryHeight(entry);

		if (used + cost > usable && rendered > 0) {
			hidden = entries.length - index;
			break;
		};

		used += cost;
		rendered += 1;
		list.add_child(renderEntry(entry, createLabel, theme));
	};

	body.add_child(new St.Widget({y_expand: true}));
	body.add_child(list);

	if (hidden > 0) {
		body.add_child(createLabel(_('+%s more').format(hidden), 'widget-agenda-more', `color: ${theme.muted};`));
	};

	body.add_child(new St.Widget({y_expand: true}));
};
