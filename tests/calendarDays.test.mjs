import assert from 'node:assert/strict';
import test from 'node:test';

// NOTE: the DST cases only bite in zones that observe daylight saving.
// Run with e.g. TZ=America/New_York node --test tests/calendarDays.test.mjs
// to exercise them; in UTC they pass trivially.
import {
	daysForRange,
} from '../lib/calendarLogic.js';

function has(startMs, endMs, y, m, d) {
	const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

	assert.ok(daysForRange(startMs, endMs).has(key), `missing day ${key}`);
}

test('daysForRange keeps the trailing day across US fall-back', () => {
	const start = new Date(2026, 9, 30, 12).getTime();
	const end = new Date(2026, 10, 3, 12).getTime();

	has(start, end, 2026, 10, 30);
	has(start, end, 2026, 10, 31);
	has(start, end, 2026, 11, 1);
	has(start, end, 2026, 11, 2);
	has(start, end, 2026, 11, 3);
});

test('daysForRange keeps the trailing day across Sydney spring-forward', () => {
	const start = new Date(2026, 9, 1, 12).getTime();
	const end = new Date(2026, 9, 6, 12).getTime();

	has(start, end, 2026, 10, 1);
	has(start, end, 2026, 10, 2);
	has(start, end, 2026, 10, 3);
	has(start, end, 2026, 10, 4);
	has(start, end, 2026, 10, 5);
	has(start, end, 2026, 10, 6);
});

test('daysForRange covers a plain week without gaps', () => {
	const start = new Date(2026, 4, 4, 9).getTime();
	const end = new Date(2026, 4, 10, 18).getTime();
	const days = daysForRange(start, end);

	assert.equal(days.size, 7);
	has(start, end, 2026, 5, 4);
	has(start, end, 2026, 5, 10);
});
