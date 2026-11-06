export const WIDGET_TYPES = [
	'clock',
	'calendar',
	'agenda',
	'weather',
	'photos',
	'battery',
	'bambu',
	'media',
];

export const WIDGET_DEFAULT_SIZES = {
	clock: 'small',
	calendar: 'small',
	agenda: 'medium',
	weather: 'small',
	photos: 'medium',
	battery: 'medium',
	bambu: 'medium',
	media: 'medium',
};

export const WIDGET_DIMENSIONS = {
	small: [220, 220],
	medium: [454, 220],
	large: [454, 454],
};

export function widgetLabels(gettext) {
	const _ = gettext;

	return {
		clock: _('Clock'),
		calendar: _('Calendar'),
		agenda: _('Agenda'),
		weather: _('Weather'),
		photos: _('Photos'),
		battery: _('Battery'),
		bambu: _('Bambu Lab'),
		media: _('Music'),
	};
}