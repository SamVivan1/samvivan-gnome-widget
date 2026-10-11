import assert from 'node:assert/strict';
import test from 'node:test';

import { statusSignature } from '../lib/bambuStatus.js';

const STATUS = {
	connected: true,
	printer: {name: 'X1C', model: 'X1'},
	job: {
		state: 'RUNNING',
		file: 'benchy.gcode',
		progress: 42,
		remaining_min: 18,
		layer: 84,
		total_layers: 200,
		speed: 'Sport',
		error_code: 0,
	},
	temperatures: {nozzle: 218, nozzle_target: 220, bed: 60, bed_target: 60, chamber: 35},
	filament: {ams: [{type: 'PLA', color: '#ff0000', active: true}]},
};

test('null status has an empty signature', () => {
	assert.equal(statusSignature(null), '');
	assert.equal(statusSignature(undefined), '');
});

test('signature is stable for equal status', () => {
	assert.equal(statusSignature(STATUS), statusSignature(structuredClone(STATUS)));
});

test('signature changes when relevant fields change', () => {
	const changed = structuredClone(STATUS);

	changed.job.progress = 43;

	assert.notEqual(statusSignature(STATUS), statusSignature(changed));
});

test('irrelevant extra fields do not change the signature', () => {
	const noisy = {...structuredClone(STATUS), uptime: 12345, noise: 'x'};

	assert.equal(statusSignature(STATUS), statusSignature(noisy));
});

test('missing nested objects do not throw', () => {
	assert.doesNotThrow(() => statusSignature({connected: false}));
});
