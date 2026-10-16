import assert from 'node:assert/strict';
import test from 'node:test';

import { activeLyricIndex, cacheKey, parseSyncedLyrics } from '../lib/lyrics.js';

test('parseSyncedLyrics reads timestamps and text', () => {
	const lines = parseSyncedLyrics('[00:12.50] Hello\n[01:05] World');

	assert.deepEqual(lines, [
		{time: 12.5, text: 'Hello'},
		{time: 65, text: 'World'},
	]);
});

test('parseSyncedLyrics supports centiseconds, milliseconds and hours', () => {
	assert.deepEqual(parseSyncedLyrics('[00:01.5] a'), [{time: 1.5, text: 'a'}]);
	assert.deepEqual(parseSyncedLyrics('[00:01.005] b'), [{time: 1.005, text: 'b'}]);
	assert.deepEqual(parseSyncedLyrics('[60:00] c'), [{time: 3600, text: 'c'}]);
});

test('parseSyncedLyrics repeats text for multiple stamps on one line', () => {
	const lines = parseSyncedLyrics('[00:10][00:20] la');

	assert.deepEqual(lines, [
		{time: 10, text: 'la'},
		{time: 20, text: 'la'},
	]);
});

test('parseSyncedLyrics ignores blank, metadata and untimed lines', () => {
	assert.deepEqual(parseSyncedLyrics(''), []);
	assert.deepEqual(parseSyncedLyrics(null), []);
	assert.deepEqual(parseSyncedLyrics('[ar:Someone]\n[00:00.00]'), [{time: 0, text: ''}]);
	assert.deepEqual(parseSyncedLyrics('just a plain line'), []);
});

test('parseSyncedLyrics sorts by time', () => {
	const lines = parseSyncedLyrics('[00:30] b\n[00:10] a');

	assert.deepEqual(lines.map(line => line.text), ['a', 'b']);
});

test('activeLyricIndex finds the current line', () => {
	const lines = parseSyncedLyrics('[00:10] a\n[00:20] b\n[00:30] c');

	assert.equal(activeLyricIndex(lines, 5), -1);
	assert.equal(activeLyricIndex(lines, 10), 0);
	assert.equal(activeLyricIndex(lines, 19.9), 0);
	assert.equal(activeLyricIndex(lines, 25), 1);
	assert.equal(activeLyricIndex(lines, 100), 2);
	assert.equal(activeLyricIndex([], 5), -1);
});

test('cacheKey normalises case and duration', () => {
	assert.equal(
		cacheKey({artist: ' A ', title: 'B', album: 'C', duration: 12.4}),
		cacheKey({artist: 'a', title: 'b', album: 'c', duration: 12})
	);
	assert.notEqual(cacheKey({title: 'a'}), cacheKey({title: 'b'}));
});

test('parseSyncedLyrics tolerates single-digit seconds and long fractions', () => {
	assert.deepEqual(parseSyncedLyrics('[0:5] a'), [{time: 5, text: 'a'}]);
	assert.deepEqual(parseSyncedLyrics('[00:01.0059] b'), [{time: 1.005, text: 'b'}]);
});
