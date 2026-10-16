const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d+))?\]/g;

function fractionToSeconds(fraction) {
	if (!fraction) {
		return 0;
	};

	return Number(fraction.slice(0, 3).padEnd(3, '0')) / 1000;
};

export function cacheKey({artist = '', title = '', album = '', duration = 0}) {
	return JSON.stringify([
		String(artist).trim().toLowerCase(),
		String(title).trim().toLowerCase(),
		String(album).trim().toLowerCase(),
		Math.round(Number(duration) || 0),
	]);
};

export function parseSyncedLyrics(text) {
	if (!text) {
		return [];
	};

	const lines = [];

	for (const raw of String(text).split(/\r?\n/)) {
		const stamps = [];
		let match;

		TIMESTAMP.lastIndex = 0;

		while ((match = TIMESTAMP.exec(raw)) !== null) {
			stamps.push(Number(match[1]) * 60 + Number(match[2]) + fractionToSeconds(match[3]));
		};

		const value = raw.replace(TIMESTAMP, '').trim();

		for (const time of stamps) {
			lines.push({time, text: value});
		};
	};

	lines.sort((a, b) => a.time - b.time);

	return lines;
};

export function activeLyricIndex(lines, position) {
	if (!Array.isArray(lines) || lines.length === 0) {
		return -1;
	};

	let low = 0;
	let high = lines.length - 1;
	let found = -1;

	while (low <= high) {
		const middle = (low + high) >> 1;

		if (lines[middle].time <= position) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		};
	};

	return found;
};
