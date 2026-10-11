import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_THRESHOLDS,
	PRINT_MOODS,
	conditionsFor,
	dominantMood,
	normalizeThresholds,
	printerMood,
} from '../lib/mood.js';

test('chill when nothing is elevated', () => {
	const active = conditionsFor({temp: 40, load: 10, ram: 30, battery: 80, charging: false});

	assert.deepEqual(active, []);
	assert.equal(dominantMood(active), 'chill');
});

test('each condition triggers at its threshold', () => {
	assert.deepEqual(conditionsFor({temp: 60}, {hot: 60, battery: 20, load: 85, ram: 90}), ['hot']);
	assert.deepEqual(conditionsFor({ram: 90}, {hot: 60, battery: 20, load: 90, ram: 90}), ['overload']);
	assert.deepEqual(conditionsFor({battery: 20, charging: false}, {hot: 60, battery: 20, load: 85, ram: 90}), ['sleepy']);
	assert.deepEqual(conditionsFor({load: 85}, {hot: 60, battery: 20, load: 85, ram: 90}), ['busy']);
});

test('charging suppresses sleepy and adds charging under 100', () => {
	assert.deepEqual(conditionsFor({battery: 20, charging: true}, {hot: 60, battery: 20, load: 85, ram: 90}), ['charging']);
	assert.deepEqual(conditionsFor({battery: 100, charging: true}, {hot: 60, battery: 20, load: 85, ram: 90}), []);
});

test('conditions stack and dominant follows priority', () => {
	const active = conditionsFor({temp: 70, load: 95, ram: 95, battery: 10, charging: false}, {
		hot: 60, battery: 20, load: 85, ram: 90,
	});

	assert.deepEqual(active, ['hot', 'overload', 'sleepy', 'busy']);
	assert.equal(dominantMood(active), 'hot');
});

test('null readings are ignored', () => {
	assert.deepEqual(conditionsFor({}, {hot: 60, battery: 20, load: 85, ram: 90}), []);
});

test('normalizeThresholds fills defaults', () => {
	assert.deepEqual(normalizeThresholds(), {hot: 60, battery: 20, load: 85, ram: 90});
	assert.deepEqual(normalizeThresholds({hot: 45}), {hot: 45, battery: 20, load: 85, ram: 90});
	assert.deepEqual(normalizeThresholds(null), {hot: 60, battery: 20, load: 85, ram: 90});
});

test('printerMood maps job states and ignores the rest', () => {
	assert.equal(printerMood('RUNNING'), 'printing');
	assert.equal(printerMood('runNING'), 'printing');
	assert.equal(printerMood('PAUSE'), 'paused');
	assert.equal(printerMood('FAILED'), 'error');
	assert.equal(printerMood('FINISH'), 'done');
	assert.equal(printerMood('IDLE'), null);
	assert.equal(printerMood('PREPARE'), null);
	assert.equal(printerMood(''), null);
	assert.equal(printerMood(null), null);
	assert.equal(printerMood(undefined), null);
});

test('print moods dominate vitals but keep error on top', () => {
	assert.equal(dominantMood(['busy', 'printing']), 'printing');
	assert.equal(dominantMood(['hot', 'paused']), 'paused');
	assert.equal(dominantMood(['printing', 'error']), 'error');
	assert.deepEqual(PRINT_MOODS, ['printing', 'paused', 'error', 'done']);
});
