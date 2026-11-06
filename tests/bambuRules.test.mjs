import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_REFRESH_SECONDS,
	MAX_REFRESH_SECONDS,
	MIN_REFRESH_SECONDS,
	clampRefresh,
	isConfigured,
	normalizeEndpoint,
} from '../lib/bambuRules.js';

test('clampRefresh falls back for missing or invalid values', () => {
	assert.equal(clampRefresh(undefined), DEFAULT_REFRESH_SECONDS);
	assert.equal(clampRefresh(Number.NaN), DEFAULT_REFRESH_SECONDS);
	assert.equal(clampRefresh(0), DEFAULT_REFRESH_SECONDS);
	assert.equal(clampRefresh(-10), DEFAULT_REFRESH_SECONDS);
});

test('clampRefresh keeps values inside the supported range', () => {
	assert.equal(clampRefresh(1), MIN_REFRESH_SECONDS);
	assert.equal(clampRefresh(5), 5);
	assert.equal(clampRefresh(10_000), MAX_REFRESH_SECONDS);
	assert.equal(clampRefresh(4.6), 5);
});

test('normalizeEndpoint adds a scheme and strips trailing slashes', () => {
	assert.equal(normalizeEndpoint('printer.local:8083/'), 'https://printer.local:8083');
	assert.equal(normalizeEndpoint('http://printer.local/'), 'http://printer.local');
	assert.equal(normalizeEndpoint('  https://printer.local///  '), 'https://printer.local');
	assert.equal(normalizeEndpoint(''), '');
	assert.equal(normalizeEndpoint(null), '');
});

test('isConfigured requires both an endpoint and a token', () => {
	assert.equal(isConfigured('https://bridge', 'secret'), true);
	assert.equal(isConfigured('', 'secret'), false);
	assert.equal(isConfigured('https://bridge', ''), false);
	assert.equal(isConfigured('', ''), false);
});
