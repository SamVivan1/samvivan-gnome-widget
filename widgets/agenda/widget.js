import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
	addDays,
	buildDayPlan,
	fitEntries,
	formatCountdown,
	formatTime,
	formatTimeRange,
	isPastEvent,
	nextUp,
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
const UPCOMING_DAYS = 2;
const FILL_EXTRA_DAYS = 11;

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

function measureWidth(body, widget, sizeForWidget) {
	if (body.width > 0) {
		return body.width;
	};

	const [width] = sizeForWidget(widget);

	return Math.max(50, width - 28);
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

	const entries = buildDayPlan(calendar, today, UPCOMING_DAYS, {extraDays: FILL_EXTRA_DAYS});
	const upcoming = nextUp(entries.filter(entry => entry.kind === 'event').map(entry => entry.event), now);
	let nextCost = 0;

	if (upcoming) {
		const text = upcoming.kind === 'ongoing'
			? _('Happening now: %s until %s').format(upcoming.event.summary, formatTime(upcoming.event.endDate))
			: _('Next up: %s in %s').format(upcoming.event.summary, formatCountdown(upcoming.event.start - now.getTime()));
		const nextLabel = createLabel(text, 'widget-agenda-nextup', `color: ${theme.text}; font-weight: 800;`);

		nextLabel.clutter_text.set_line_wrap(false);
		body.add_child(nextLabel);
		nextCost = nextLabel.get_preferred_height(measureWidth(body, widget, sizeForWidget))[1];
	};
	const list = new St.BoxLayout({
		orientation: Clutter.Orientation.VERTICAL,
		style_class: 'widget-agenda-list',
		x_expand: true,
	});
	// Measure every entry actor and fit exactly what the box holds instead
	// of guessing from font sizes; guesses drift with locale, theme, and
	// text-scaling and end up clipping real content.
	const width = measureWidth(body, widget, sizeForWidget);
	const measured = entries.map(entry => {
		const actor = renderEntry(entry, createLabel, theme, now);

		return {entry, height: actor.get_preferred_height(width)[1], actor};
	});
	const probe = createLabel(_('+%s more').format(0), 'widget-agenda-more', `color: ${theme.muted};`);
	const moreCost = probe.get_preferred_height(width)[1];
	const fit = fitEntries(
		measured.map(item => item.entry),
		Math.max(0, usable - nextCost),
		moreCost,
		(_entry, index) => measured[index].height);

	for (const item of measured.slice(0, fit.shown.length)) {
		list.add_child(item.actor);
	};

	body.add_child(new St.Widget({y_expand: true}));
	body.add_child(list);

	if (fit.hiddenEvents > 0 && fit.moreFits) {
		body.add_child(createLabel(
			_('+%s more').format(fit.hiddenEvents),
			'widget-agenda-more',
			`color: ${theme.muted};`));
	};

	body.add_child(new St.Widget({y_expand: true}));
};
