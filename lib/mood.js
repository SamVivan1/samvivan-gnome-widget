export const HOT_TEMP_C = 60;
export const LOW_BATTERY = 20;
export const HIGH_LOAD = 85;
export const HIGH_RAM = 90;

export const MOOD_PRIORITY = ['hot', 'overload', 'sleepy', 'charging', 'busy'];

export const DEFAULT_THRESHOLDS = {
	hot: HOT_TEMP_C,
	battery: LOW_BATTERY,
	load: HIGH_LOAD,
	ram: HIGH_RAM,
};

export function normalizeThresholds(thresholds = {}) {
	return {
		hot: thresholds?.hot ?? HOT_TEMP_C,
		battery: thresholds?.battery ?? LOW_BATTERY,
		load: thresholds?.load ?? HIGH_LOAD,
		ram: thresholds?.ram ?? HIGH_RAM,
	};
};

export function conditionsFor({temp = null, load = null, ram = null, battery = null, charging = false}, thresholds = DEFAULT_THRESHOLDS) {
	const active = [];

	if (temp !== null && temp >= thresholds.hot) {
		active.push('hot');
	};

	if (ram !== null && ram >= thresholds.ram) {
		active.push('overload');
	};

	if (battery !== null && battery <= thresholds.battery && !charging) {
		active.push('sleepy');
	};

	if (charging && battery !== null && battery < 100) {
		active.push('charging');
	};

	if (load !== null && load >= thresholds.load) {
		active.push('busy');
	};

	return active;
};

export function dominantMood(active, priority = MOOD_PRIORITY) {
	for (const mood of priority) {
		if (active.includes(mood)) {
			return mood;
		};
	};

	return 'chill';
};
