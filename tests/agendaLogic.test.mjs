import assert from 'node:assert/strict';
import test from 'node:test';

// NOTE: widget-facing strings stay in widgets/agenda/widget.js;
// this module is pure scheduling logic.
import {
	addDays,
	buildDayPlan,
	formatTimeRange,
	isPastEvent,
	sameDay,
	startOfDay,
} from '../lib/agendaLogic.js';

function calendarFor(eventsByDay) {
	return {
		eventsOnDay: date => {
			const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

			return eventsByDay[key] ?? [];
		},
	};
};

function event(id, start, end, summary = id) {
	return {
		id,
		summary,
		startDate: start,
		endDate: end,
		start: start.getTime(),
		end: end.getTime(),
		allDay: false,
	};
}

test('buildDayPlan covers today plus two upcoming days only', () => {
	const today = startOfDay(new Date(2026, 9, 19, 12));
	const calendar = calendarFor({
		'2026-9-19': [event('a', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10))],
		'2026-9-20': [event('b', new Date(2026, 9, 20, 9), new Date(2026, 9, 20, 10))],
		'2026-9-21': [event('c', new Date(2026, 9, 21, 9), new Date(2026, 9, 21, 10))],
		'2026-9-24': [event('far', new Date(2026, 9, 24, 9), new Date(2026, 9, 24, 10))],
	});
	const entries = buildDayPlan(calendar, today, 2);
	const ids = entries.filter(entry => entry.kind === 'event').map(entry => entry.event.id);

	assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('buildDayPlan keeps every event of today', () => {
	const today = startOfDay(new Date(2026, 9, 19, 12));
	const todays = Array.from({length: 12}, (_, i) =>
		event(`m${i}`, new Date(2026, 9, 19, 8 + i), new Date(2026, 9, 19, 9 + i)));
	const calendar = calendarFor({'2026-9-19': todays});
	const entries = buildDayPlan(calendar, today, 2);
	const ids = entries.filter(entry => entry.kind === 'event').map(entry => entry.event.id);

	assert.equal(ids.length, 12);
	assert.ok(entries.some(entry => entry.kind === 'today'));
});

test('buildDayPlan marks tomorrow distinctly from later days', () => {
	const today = startOfDay(new Date(2026, 9, 19, 12));
	const calendar = calendarFor({
		'2026-9-20': [event('b', new Date(2026, 9, 20, 9), new Date(2026, 9, 20, 10))],
		'2026-9-21': [event('c', new Date(2026, 9, 21, 9), new Date(2026, 9, 21, 10))],
	});
	const entries = buildDayPlan(calendar, today, 2);
	const headers = entries.filter(entry => entry.kind === 'day');

	assert.equal(headers.length, 2);
	assert.equal(headers[0].isTomorrow, true);
	assert.equal(headers[1].isTomorrow, false);
	assert.ok(sameDay(headers[0].date, addDays(today, 1)));
});

test('isPastEvent is true only once the event has fully ended', () => {
	const now = new Date(2026, 9, 19, 12);

	assert.equal(isPastEvent(event('a', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10)), now), true);
	assert.equal(isPastEvent(event('b', new Date(2026, 9, 19, 11), new Date(2026, 9, 19, 13)), now), false);
	assert.equal(isPastEvent(event('c', new Date(2026, 9, 19, 13), new Date(2026, 9, 19, 14)), now), false);
});

test('formatTimeRange spans start and end', () => {
	const start = new Date(2026, 9, 19, 9, 5);
	const end = new Date(2026, 9, 19, 10, 30);
	const text = formatTimeRange(start, end);

	assert.ok(text.includes('9'), text);
	assert.ok(text.includes('10'), text);
	assert.ok(text.includes('–') || text.includes('-'), text);
});

test('buildDayPlan fills forward past the briefing window when asked', async () => {
	const {buildDayPlan} = await import('../lib/agendaLogic.js');
	const today = startOfDay(new Date(2026, 9, 19, 12));
	const calendar = calendarFor({
		'2026-9-19': [event('a', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10))],
		'2026-9-24': [event('far', new Date(2026, 9, 24, 9), new Date(2026, 9, 24, 10))],
	});
	const entries = buildDayPlan(calendar, today, 2, {extraDays: 11});
	const ids = entries.filter(entry => entry.kind === 'event').map(entry => entry.event.id);

	assert.deepEqual(ids, ['a', 'far']);
});

test('buildDayPlan caps the fill-forward window', async () => {
	const {buildDayPlan} = await import('../lib/agendaLogic.js');
	const today = startOfDay(new Date(2026, 9, 19, 12));
	const calendar = calendarFor({
		'2026-10-9': [event('too-far', new Date(2026, 10, 9, 9), new Date(2026, 10, 9, 10))],
	});
	const entries = buildDayPlan(calendar, today, 2, {extraDays: 11});
	const ids = entries.filter(entry => entry.kind === 'event').map(entry => entry.event.id);

	assert.deepEqual(ids, []);
});

test('nextUp prefers the ongoing event, then the earliest future one', async () => {
	const {nextUp} = await import('../lib/agendaLogic.js');
	const now = new Date(2026, 9, 19, 12);
	const ongoing = event('live', new Date(2026, 9, 19, 11), new Date(2026, 9, 19, 13));
	const later = event('next', new Date(2026, 9, 19, 15), new Date(2026, 9, 19, 16));

	assert.equal(nextUp([later, ongoing], now).event.id, 'live');
	assert.equal(nextUp([later, ongoing], now).kind, 'ongoing');
	assert.equal(nextUp([later], now).kind, 'upcoming');
});

test('nextUp ignores ended events and returns null when empty', async () => {
	const {nextUp} = await import('../lib/agendaLogic.js');
	const now = new Date(2026, 9, 19, 12);
	const done = event('done', new Date(2026, 9, 19, 9), new Date(2026, 9, 19, 10));

	assert.equal(nextUp([done], now), null);
	assert.equal(nextUp([], now), null);
});

test('formatCountdown renders minutes, hours, and days', async () => {
	const {formatCountdown} = await import('../lib/agendaLogic.js');

	assert.equal(formatCountdown(45 * 60000), '45m');
	assert.equal(formatCountdown((2 * 60 + 15) * 60000), '2h 15m');
	assert.equal(formatCountdown(3 * 86400000), '3d');
});

test('fitEntries shows everything that fits and counts only events as hidden', async () => {
	const {fitEntries} = await import('../lib/agendaLogic.js');
	const entries = [
		{kind: 'today'},
		{kind: 'event', id: 'a'},
		{kind: 'event', id: 'b'},
		{kind: 'day'},
		{kind: 'event', id: 'c'},
		{kind: 'event', id: 'd'},
	];
	const heights = {today: 16, event: 20, day: 16};
	const result = fitEntries(entries, 16 + 20 + 20 + 15, 15, entry => heights[entry.kind]);

	assert.deepEqual(result.shown.map(entry => entry.id ?? entry.kind), ['today', 'a', 'b']);
	assert.equal(result.hiddenEvents, 2);
	assert.equal(result.moreFits, true);
});

test('fitEntries drops the more-label reserve when everything fits', async () => {
	const {fitEntries} = await import('../lib/agendaLogic.js');
	const entries = [{kind: 'today'}, {kind: 'event', id: 'a'}];
	const heights = {today: 16, event: 20};
	const result = fitEntries(entries, 200, 15, entry => heights[entry.kind]);

	assert.equal(result.shown.length, 2);
	assert.equal(result.hiddenEvents, 0);
	assert.equal(result.moreFits, false);
});

test('fitEntries never counts headers as hidden', async () => {
	const {fitEntries} = await import('../lib/agendaLogic.js');
	const entries = [
		{kind: 'today'},
		{kind: 'event', id: 'a'},
		{kind: 'day'},
		{kind: 'day'},
		{kind: 'event', id: 'b'},
	];
	const heights = {today: 16, event: 20, day: 16};
	const result = fitEntries(entries, 16 + 20 + 16 + 10, 15, entry => heights[entry.kind]);

	assert.deepEqual(result.shown.map(entry => entry.id ?? entry.kind), ['today', 'a']);
	assert.equal(result.hiddenEvents, 1);
});
