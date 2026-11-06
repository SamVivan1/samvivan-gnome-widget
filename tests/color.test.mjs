import assert from 'node:assert/strict';
import test from 'node:test';

import {
	contrastInk,
	hexToCssRgba,
	hexToRgb,
	hexToRgbaArray,
	luminance,
	withAlpha,
} from '../lib/color.js';

test('hexToRgb parses hex colors', () => {
	assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
	assert.deepEqual(hexToRgb('#00ff00'), [0, 1, 0]);
	assert.deepEqual(hexToRgb('#0000ff'), [0, 0, 1]);
});

test('hexToRgb handles shorthand hex', () => {
	assert.deepEqual(hexToRgb('#f00'), [1, 0, 0]);
});

test('hexToRgb falls back for invalid input', () => {
	assert.deepEqual(hexToRgb('not-a-color'), [0.6, 0.6, 0.6]);
});

test('hexToRgbaArray appends alpha', () => {
	assert.deepEqual(hexToRgbaArray('#ff0000', 0.5), [1, 0, 0, 0.5]);
});

test('hexToCssRgba returns a css string', () => {
	assert.equal(hexToCssRgba('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
});

test('luminance and contrastInk follow brightness', () => {
	assert.ok(luminance('#ffffff') > luminance('#000000'));
	assert.equal(contrastInk('#ffffff', '#000000'), '#000000');
	assert.equal(contrastInk('#000000', '#ffffff'), '#ffffff');
});

test('withAlpha returns a css string', () => {
	assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
	assert.equal(withAlpha('not-a-color', 0.5), 'rgba(127, 127, 127, 0.5)');
});