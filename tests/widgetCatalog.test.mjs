import assert from 'node:assert/strict';
import test from 'node:test';

import {
	WIDGET_DEFAULT_SIZES,
	WIDGET_DIMENSIONS,
	WIDGET_TYPES,
	widgetLabels,
} from '../lib/widgetCatalog.js';

test('catalog lists every widget type', () => {
	assert.ok(WIDGET_TYPES.includes('clock'));
	assert.ok(WIDGET_TYPES.includes('media'));
	assert.equal(WIDGET_TYPES.length, 8);
});

test('every widget type has a default size', () => {
	for (const type of WIDGET_TYPES) {
		assert.ok(WIDGET_DEFAULT_SIZES[type], `${type} missing default size`);
		assert.ok(WIDGET_DIMENSIONS[WIDGET_DEFAULT_SIZES[type]], `${type} missing dimensions`);
	};
});

test('widgetLabels returns a label for every type', () => {
	const labels = widgetLabels(key => key);

	for (const type of WIDGET_TYPES) {
		assert.equal(typeof labels[type], 'string');
		assert.ok(labels[type].length > 0);
	};
});
