const PROVIDERS = ['calendar', 'weather', 'battery', 'media', 'bambu'];

/**
 * Decide which data providers are worth running for the current layout.
 *
 * A provider is enabled only while at least one of its widgets is actually
 * visible: hidden widgets, and the global hide-all switch, must not keep
 * network requests, subprocesses or D-Bus subscriptions alive.
 */
export function enabledProviders(widgets = [], {hideAll = false} = {}) {
	const enabled = Object.fromEntries(PROVIDERS.map(provider => [provider, false]));

	if (hideAll) {
		return enabled;
	}

	const has = type => widgets.some(widget => widget?.type === type && widget.hidden !== true);

	enabled.calendar = has('calendar') || has('agenda');
	enabled.weather = has('weather');
	enabled.battery = has('battery');
	enabled.media = has('media');
	enabled.bambu = has('bambu');

	return enabled;
}
