import assert from 'node:assert/strict';
import test from 'node:test';

import {
	computeLayout,
	mergeDevices,
} from '../lib/batteryDevices.js';

const MOUSE_UPOWER = {
	source: 'upower',
	name: 'MX Master 3S',
	kind: 7,
	percentage: 80,
	powerSupply: false,
	iconName: null,
	nativePath: '',
	path: '/org/freedesktop/UPower/devices/mouse_dev_78_87_11_BC_B9_54',
};

const MOUSE_BLUEZ = {
	source: 'bluez',
	name: 'MX Master 3S',
	kind: 7,
	percentage: 78,
	powerSupply: false,
	iconName: 'input-mouse-symbolic',
	nativePath: '/org/bluez/hci0/dev_78_87_11_BC_B9_54',
	path: '',
};

const OTHER_MOUSE = {
	...MOUSE_BLUEZ,
	path: '',
	nativePath: '/org/bluez/hci0/dev_11_22_33_44_55_66',
};

test('mergeDevices collapses the same mouse seen over UPower and BlueZ', () => {
	const merged = mergeDevices([MOUSE_BLUEZ, MOUSE_UPOWER]);

	assert.equal(merged.length, 1);
	assert.equal(merged[0].source, 'upower');
});

test('mergeDevices keeps two physically different mice apart', () => {
	const merged = mergeDevices([MOUSE_BLUEZ, OTHER_MOUSE, MOUSE_UPOWER]);

	assert.equal(merged.length, 2);
});

test('computeLayout uses two rows once there are more than four devices', () => {
	const availWidth = 454 - 30 - 18 * 2;
	const availHeight = 220 - 30 - 18 * 2;

	for (const count of [5, 6, 7, 8]) {
		const layout = computeLayout(count, availWidth, availHeight, 0.5);

		assert.equal(layout.rows, 2, `count=${count} should use 2 rows`);
	};
});

test('computeLayout keeps a single row for up to four devices', () => {
	const availWidth = 454 - 30 - 18 * 2;
	const availHeight = 220 - 30 - 18 * 2;

	for (const count of [2, 3, 4]) {
		const layout = computeLayout(count, availWidth, availHeight, 0.5);

		assert.equal(layout.rows, 1, `count=${count} should stay on 1 row`);
	};
});
