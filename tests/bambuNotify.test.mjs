import assert from 'node:assert/strict';
import test from 'node:test';

import { bambuNotification } from '../lib/bambuNotify.js';

function status(connected, state) {
	return {connected, state};
}

test('ignores the first sample', () => {
	assert.equal(bambuNotification(null, status(true, 'RUNNING')), null);
});

test('ignores unchanged state', () => {
	assert.equal(bambuNotification(status(true, 'RUNNING'), status(true, 'RUNNING')), null);
});

test('notifies when the printer connects', () => {
	const event = bambuNotification(status(false, 'IDLE'), status(true, 'IDLE'));

	assert.equal(event.id, 'printer-connected');
});

test('notifies when the printer disconnects', () => {
	const event = bambuNotification(status(true, 'RUNNING'), status(false, 'RUNNING'));

	assert.equal(event.id, 'printer-disconnected');
	assert.equal(event.urgent, true);
});

test('notifies on print start and finish', () => {
	const start = bambuNotification(status(true, 'IDLE'), status(true, 'RUNNING'));
	const finish = bambuNotification(status(true, 'RUNNING'), status(true, 'FINISH'));

	assert.equal(start.title, 'Print started');
	assert.equal(finish.title, 'Print finished');
});

test('distinguishes resume from start', () => {
	const resume = bambuNotification(status(true, 'PAUSE'), status(true, 'RUNNING'));

	assert.equal(resume.title, 'Print resumed');
});

test('notifies on pause and failure', () => {
	const paused = bambuNotification(status(true, 'RUNNING'), status(true, 'PAUSE'));
	const failed = bambuNotification(status(true, 'RUNNING'), status(true, 'FAILED'));

	assert.equal(paused.title, 'Print paused');
	assert.equal(failed.title, 'Print failed');
	assert.equal(failed.urgent, true);
});

test('ignores unrelated state changes', () => {
	assert.equal(bambuNotification(status(true, 'PREPARE'), status(true, 'SLICING')), null);
});
