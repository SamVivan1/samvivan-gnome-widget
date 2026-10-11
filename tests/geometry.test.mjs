import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clamp,
	snap,
	sizeForWidget,
	monitorWorkArea,
	widgetFractions,
	positionForFractions,
	rectForWidget,
	rectsOverlap,
} from '../lib/geometry.js';

const SIZES = {
	small: [220, 220],
	medium: [454, 220],
	large: [454, 454],
};

const MONITOR = {width: 1920, height: 1080};
const OPTS = {gap: 14, panelHeight: 32, sizes: SIZES};

test('clamp bounds the value', () => {
	assert.equal(clamp(5, 0, 10), 5);
	assert.equal(clamp(-1, 0, 10), 0);
	assert.equal(clamp(11, 0, 10), 10);
});

test('snap rounds to the grid when enabled', () => {
	assert.equal(snap(26, {gridSize: 20, snapToGrid: true}), 20);
	assert.equal(snap(31, {gridSize: 20, snapToGrid: true}), 40);
	assert.equal(snap(27.4, {gridSize: 20, snapToGrid: false}), 27);
});

test('sizeForWidget falls back to the named size and honours explicit size', () => {
	assert.deepEqual(sizeForWidget({size: 'small'}, SIZES), [220, 220]);
	assert.deepEqual(sizeForWidget({size: 'medium'}, SIZES), [454, 220]);
	assert.deepEqual(sizeForWidget({size: 'large'}, SIZES), [454, 454]);
	assert.deepEqual(sizeForWidget({size: 'bogus'}, SIZES), [220, 220]);
	assert.deepEqual(sizeForWidget({size: 'small', width: 300, height: 120}, SIZES), [300, 120]);
});

test('monitorWorkArea respects gap and panel height', () => {
	assert.deepEqual(monitorWorkArea(MONITOR, OPTS), {
		x: 14,
		y: 46,
		width: 1920 - 28,
		height: 1080 - 46 - 14,
	});
});

test('widgetFractions maps edges to 0 and 1', () => {
	const area = monitorWorkArea(MONITOR, OPTS);
	const small = {size: 'small'};
	const atOrigin = widgetFractions({...small, x: area.x, y: area.y}, MONITOR, OPTS);

	assert.equal(atOrigin.fx, 0);
	assert.equal(atOrigin.fy, 0);

	const atEnd = widgetFractions({
		...small,
		x: area.x + (area.width - 220),
		y: area.y + (area.height - 220),
	}, MONITOR, OPTS);

	assert.equal(atEnd.fx, 1);
	assert.equal(atEnd.fy, 1);
});

test('positionForFractions is the inverse of widgetFractions', () => {
	const area = monitorWorkArea(MONITOR, OPTS);
	const widget = {size: 'small', x: 640, y: 360};
	const fractions = widgetFractions(widget, MONITOR, OPTS);
	const restored = positionForFractions({...widget, ...fractions}, MONITOR, OPTS);

	assert.equal(restored.x, widget.x);
	assert.equal(restored.y, widget.y);
});

test('rectForWidget and rectsOverlap honour the gap', () => {
	const a = rectForWidget({size: 'small', x: 0, y: 0}, SIZES);
	const b = rectForWidget({size: 'small', x: 200, y: 0}, SIZES);

	assert.deepEqual(a, {x: 0, y: 0, width: 220, height: 220});
	assert.equal(rectsOverlap(a, b, 14), true);
	assert.equal(rectsOverlap(a, rectForWidget({size: 'small', x: 300, y: 0}, SIZES), 14), false);
});
