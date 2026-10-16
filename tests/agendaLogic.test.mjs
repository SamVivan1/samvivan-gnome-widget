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
