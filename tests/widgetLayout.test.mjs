import assert from 'node:assert/strict';
import test from 'node:test';

import {
	stripTransientWidgetFields,
} from '../lib/geometry.js';

test('stripTransientWidgetFields drops underscore-prefixed runtime keys', () => {
	const clean = stripTransientWidgetFields({
		id: 'bambu-test',
		type: 'bambu',
		width: 454,
		_bambuFaceRef: {state: 'RUNNING'},
		data: {},
	});

	assert.deepEqual(clean, {
		id: 'bambu-test',
		type: 'bambu',
		width: 454,
		data: {},
	});
});

test('stripTransientWidgetFields keeps nested data untouched', () => {
	const data = {album: 'x'};
	const clean = stripTransientWidgetFields({id: 'a', data, _tmp: 1});

	assert.equal(clean.data, data);
	assert.ok(!('_tmp' in clean));
});
