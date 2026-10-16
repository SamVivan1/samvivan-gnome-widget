import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
	addDays,
	buildDayPlan,
	formatTime,
	formatTimeRange,
	isPastEvent,
	sameDay,
	startOfDay,
} from '../../lib/agendaLogic.js';

export const type = 'agenda';
export function label() { return _('Agenda'); };
export const stylesheet = 'widgets/agenda/stylesheet.css';
export const appIds = ['org.gnome.Calendar.desktop'];
export const defaultSize = 'medium';

const USABLE_PADDING = 30;
const HEADER_HEIGHT = 30;
const SECTION_HEIGHT = 20;
const DAY_HEIGHT = 18;
const ROW_HEIGHT = 24;
const LIST_SPACING = 1;
const UPCOMING_DAYS = 2;

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

function formatDayShort(date) {
	return date.toLocaleDateString(undefined, {weekday: 'short'});
};

function eventTimeText(event, day) {
	if (event.allDay) {
		return _('All day');
	};

	if (!sameDay(event.startDate, day)) {
		// Continues from an earlier day: point at when it ends so the
		// arrow is never a mystery.
		return sameDay(event.endDate, day)
			? `→ ${formatTime(event.endDate)}`
			: `→ ${formatDayShort(event.endDate)}`;
	};

	if (!sameDay(event.endDate, day) && event.end > event.start + 60000) {
		return `${formatTime(event.startDate)} →`;
	};

	if (event.end > event.start + 60000) {
		return formatTimeRange(event.startDate, event.endDate);
	};

	return formatTime(event.startDate);
};

function dayHeaderText(entry) {
	const date = formatDay(entry.date);

	if (entry.kind === 'today') {
		return `${_('Today')} • ${date}`;
	};

	if (entry.isTomorrow) {
		return `${_('Tomorrow')} • ${date}`;
	};

	return date;
};

function eventRow(event, day, createLabel, theme, now) {
	const row = new St.BoxLayout({
		style_class: 'widget-agenda-row',
		x_expand: true,
	});
	const timeClass = event.allDay
		? 'widget-agenda-time widget-agenda-allday'
		: 'widget-agenda-time';
	const time = createLabel(eventTimeText(event, day), timeClass, `color: ${theme.muted};`);
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

	title.clutter_text.set_line_wrap(false);

	row.add_child(time);
	row.add_child(dot);
	row.add_child(title);

	if (isPastEvent(event, now)) {
		row.opacity = 120;
	};

	return row;
};

function renderEntry(entry, createLabel, theme, now) {
	if (entry.kind === 'event') {
		return eventRow(entry.event, entry.day, createLabel, theme, now);
	};

	if (entry.kind === 'day' || entry.kind === 'today') {
		return createLabel(dayHeaderText(entry), 'widget-agenda-day', `color: ${theme.muted}; font-weight: 700;`);
	};

	if (entry.kind === 'empty') {
		return createLabel(_('No events today'), 'widget-agenda-message', `color: ${theme.muted};`);
	};

	if (entry.kind === 'more') {
		return createLabel(_('+%s more').format(entry.count), 'widget-agenda-more', `color: ${theme.muted};`);
	};

	return createLabel(entry.text, 'widget-agenda-section', `color: ${theme.muted}; font-weight: 700; letter-spacing: 1px;`);
};

function entryHeight(entry) {
	// Costs include the list spacing and each class's top margin so the
	// fitted list never overflows the fixed widget box.
	if (entry.kind === 'event') {
		return ROW_HEIGHT + LIST_SPACING;
	};

	if (entry.kind === 'day' || entry.kind === 'empty') {
		return DAY_HEIGHT + 5 + LIST_SPACING;
	};

	return SECTION_HEIGHT + 2 + LIST_SPACING;
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

	const headerLabel = createLabel(formatHeader(now), 'widget-agenda-title-date', `color: ${theme.text};`);

	headerLabel.clutter_text.set_line_wrap(false);
	header.add_child(headerLabel);
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

	const entries = buildDayPlan(calendar, today, UPCOMING_DAYS);
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
			hidden = entries.slice(index).filter(candidate => candidate.kind === 'event').length;
			break;
		};

		used += cost;
		rendered += 1;
		list.add_child(renderEntry(entry, createLabel, theme, now));
	};

	body.add_child(new St.Widget({y_expand: true}));
	body.add_child(list);

	if (hidden > 0) {
		body.add_child(createLabel(_('+%s more').format(hidden), 'widget-agenda-more', `color: ${theme.muted};`));
	};

	body.add_child(new St.Widget({y_expand: true}));
};
