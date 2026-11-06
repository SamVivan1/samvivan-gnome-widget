import assert from 'node:assert/strict';
import test from 'node:test';

import { enabledProviders } from '../lib/widgetPresence.js';

function widgets(...types) {
	return types.map(type => ({type}));
}

test('no widgets leaves every provider disabled', () => {
	const enabled = enabledProviders([], {hideAll: false});

	assert.deepEqual(enabled, {
		calendar: false,
		weather: false,
		battery: false,
		media: false,
		bambu: false,
	});
});

test('each widget enables only its own provider', () => {
	assert.equal(enabledProviders(widgets('media')).media, true);
	assert.equal(enabledProviders(widgets('media')).bambu, false);
	assert.equal(enabledProviders(widgets('bambu')).bambu, true);
	assert.equal(enabledProviders(widgets('battery')).battery, true);
	assert.equal(enabledProviders(widgets('weather')).weather, true);
	assert.equal(enabledProviders(widgets('clock', 'photos')).media, false);
});

test('calendar provider stays enabled for either calendar or agenda', () => {
	assert.equal(enabledProviders(widgets('calendar')).calendar, true);
	assert.equal(enabledProviders(widgets('agenda')).calendar, true);
	assert.equal(enabledProviders(widgets('clock')).calendar, false);
});

test('hidden widgets do not keep a provider enabled', () => {
	const enabled = enabledProviders([
		{type: 'media', hidden: true},
		{type: 'bambu', hidden: true},
		{type: 'battery', hidden: false},
	], {hideAll: false});

	assert.equal(enabled.media, false);
	assert.equal(enabled.bambu, false);
	assert.equal(enabled.battery, true);
});

test('hide-all disables every provider', () => {
	const enabled = enabledProviders(
		widgets('calendar', 'agenda', 'weather', 'battery', 'media', 'bambu'),
		{hideAll: true});

	assert.deepEqual(enabled, {
		calendar: false,
		weather: false,
		battery: false,
		media: false,
		bambu: false,
	});
});

test('unknown widget types are ignored', () => {
	const enabled = enabledProviders(widgets('clock', 'photos', 'weather'), {hideAll: false});

	assert.deepEqual(enabled, {
		calendar: false,
		weather: true,
		battery: false,
		media: false,
		bambu: false,
	});
});
