import assert from 'node:assert/strict';
import test from 'node:test';

import {
	eventCountsForMonth,
	eventsBetween,
	eventsOnDay,
	normalizeEvent,
} from '../lib/calendarLogic.js';

function seconds(date) {
	return date.getTime() / 1000;
}

function makeEvent({id = 'event', summary = 'Event', start, end, allDay = false}) {
	return normalizeEvent({
		id,
		summary,
		start: seconds(start),
		end: seconds(end),
		allDay,
		sourceUid: 'source',
		sourceName: 'Source',
	});
}

test('normalizeEvent converts seconds, clamps inverted ends and fills defaults', () => {
	const start = new Date(2026, 0, 15, 10, 0, 0);
	const raw = normalizeEvent({
		id: 'a',
		summary: 'Meeting',
		start: seconds(start),
		end: seconds(start) - 60,
		sourceUid: 'uid',
	});

	assert.equal(raw.start, start.getTime());
	assert.equal(raw.end, start.getTime() + 1000);
	assert.equal(raw.allDay, false);
	assert.equal(raw.holiday, false);
	assert.equal(raw.sourceColor, '');
	assert.ok(raw.startDate instanceof Date);
	assert.ok(raw.endDate instanceof Date);
	assert.ok(raw.days.has('2026-01-15'));
});

test('normalizeEvent marks all-day and holiday flags', () => {
	const event = normalizeEvent({
		id: 'b',
		summary: 'Holiday',
		start: seconds(new Date(2026, 4, 1, 0, 0, 0)),
		end: seconds(new Date(2026, 4, 2, 0, 0, 0)),
		allDay: true,
		holiday: true,
	});

	assert.equal(event.allDay, true);
	assert.equal(event.holiday, true);
});

test('normalizeEvent spans every calendar day of a multi-day event', () => {
	const event = makeEvent({
		start: new Date(2026, 2, 1, 20, 0, 0),
		end: new Date(2026, 2, 3, 8, 0, 0),
	});

	assert.deepEqual([...event.days].sort(), ['2026-03-01', '2026-03-02', '2026-03-03']);
});

test('eventsBetween keeps events that overlap the range', () => {
	const early = makeEvent({
		id: 'early',
		start: new Date(2026, 0, 1, 9),
		end: new Date(2026, 0, 1, 10),
	});
	const overlapping = makeEvent({
		id: 'overlap',
		start: new Date(2026, 0, 2, 9),
		end: new Date(2026, 0, 2, 12),
	});
	const later = makeEvent({
		id: 'later',
		start: new Date(2026, 0, 3, 9),
		end: new Date(2026, 0, 3, 10),
	});
	const events = [early, overlapping, later];

	const rangeStart = new Date(2026, 0, 2, 10).getTime();
	const rangeEnd = new Date(2026, 0, 2, 11).getTime();

	assert.deepEqual(eventsBetween(events, rangeStart, rangeEnd).map(event => event.id), ['overlap']);
});

test('eventsOnDay matches the local calendar date', () => {
	const event = makeEvent({
		start: new Date(2026, 0, 15, 23, 30),
		end: new Date(2026, 0, 16, 0, 30),
	});

	assert.deepEqual(eventsOnDay([event], new Date(2026, 0, 15, 12)).map(item => item.id), ['event']);
	assert.deepEqual(eventsOnDay([event], new Date(2026, 0, 16, 12)).map(item => item.id), ['event']);
	assert.deepEqual(eventsOnDay([event], new Date(2026, 0, 17, 12)), []);
});

test('eventCountsForMonth counts every day an event covers', () => {
	const event = makeEvent({
		start: new Date(2026, 0, 31, 23, 0),
		end: new Date(2026, 1, 1, 1, 0),
	});

	const january = eventCountsForMonth([event], 2026, 0);
	const february = eventCountsForMonth([event], 2026, 1);

	assert.equal(january.get('2026-01-31'), 1);
	assert.equal(february.get('2026-02-01'), 1);
	assert.equal(january.has('2026-02-01'), false);
});

test('eventCountsForMonth sums multiple events on the same day', () => {
	const first = makeEvent({
		id: 'first',
		start: new Date(2026, 5, 10, 9),
		end: new Date(2026, 5, 10, 10),
	});
	const second = makeEvent({
		id: 'second',
		start: new Date(2026, 5, 10, 14),
		end: new Date(2026, 5, 10, 15),
	});

	const counts = eventCountsForMonth([first, second], 2026, 5);

	assert.equal(counts.get('2026-06-10'), 2);
});
