export const MAX_GAUGE_SIZE = 320;
export const MIN_GAUGE_SIZE = 36;
export const SLOT_GAP = 12;
export const MAX_SLOTS = 8;
export const TEXT_SLOT_LIMIT = 4;
export const MIN_TEXT_GAUGE = 52;
export const WIDGET_PADDING = 30;
export const LAYOUT_MARGIN = 18;
export const FALLBACK_WIDGET_WIDTH = 454;
export const FALLBACK_WIDGET_HEIGHT = 190;
export const SLOT_SPACING = 6;
export const PERCENT_TEXT_RATIO = 0.4;
export const NAME_TEXT_RATIO = 0.2;
export const HORIZONTAL_GAP = 16;
export const MIN_TEXT_WIDTH = 56;

export function normalizeName(name) {
	return String(name || '').trim().toLowerCase();
};

/**
 * Hardware fingerprint shared across reporting sources: a Bluetooth MAC
 * appears both in UPower object paths (mouse_dev_78_87_11_BC_B9_54) and in
 * BlueZ paths (/org/bluez/hci0/dev_78_87_11_BC_B9_54). Returns null when no
 * MAC-like token is present.
 */
export function hardwareIdForDevice(device) {
	const haystack = `${device.path || ''} ${device.nativePath || ''}`;
	const match = haystack.match(/([0-9A-Fa-f]{2}[:-_]){5}[0-9A-Fa-f]{2}/);

	return match ? match[0].replace(/[:-_]/g, ':').toUpperCase() : null;
};

export function deviceKey(device) {
	// Prefer the D-Bus object path: two identical mice report the same
	// name but live at different paths, and collapsing them hides one.
	const id = String(device.path || device.nativePath || '');

	if (id.startsWith('/')) {
		return id;
	};

	return normalizeName(device.name);
};

export function mergeDevices(devices) {
	const merged = new Map();
	const byHardware = new Map();

	for (const device of devices) {
		const key = deviceKey(device);
		const hardware = hardwareIdForDevice(device);
		const knownKey = (hardware && byHardware.get(hardware)) || (merged.has(key) ? key : null);
		const existing = knownKey ? merged.get(knownKey) : null;

		if (!existing || (existing.source !== 'upower' && device.source === 'upower')) {
			if (existing && knownKey !== key) {
				merged.delete(knownKey);
			};

			merged.set(key, device);

			if (hardware) {
				byHardware.set(hardware, key);
			};
		};
	};

	return [...merged.values()].sort((a, b) => Number(b.powerSupply) - Number(a.powerSupply) || a.name.localeCompare(b.name));
};

export function bestGrid(count, availWidth, availHeight, style) {
	const maxCols = Math.max(1, Math.min(count, MAX_SLOTS));
	let best = null;

	for (let cols = 1; cols <= maxCols; cols++) {
		const rows = Math.ceil(count / cols);

		// Beyond four devices the tray always uses exactly two rows instead
		// of one long row of tiny gauges.
		if (count > 4 && rows !== 2) {
			continue;
		};

		const cellWidth = (availWidth - (cols - 1) * SLOT_GAP) / cols;
		const cellHeight = (availHeight - (rows - 1) * SLOT_GAP) / rows;

		if (cellWidth <= 0 || cellHeight <= 0) {
			continue;
		};

		let size;

		if (style.horizontal) {
			size = Math.min(cellHeight, (cellWidth - SLOT_SPACING) / (1 + (style.textRatio ?? 0)));
		} else {
			const denom = 1 + PERCENT_TEXT_RATIO + (style.showName ? NAME_TEXT_RATIO : 0);
			const gaps = (style.showName ? 2 : 1) * SLOT_SPACING;

			size = Math.min(cellWidth, (cellHeight - gaps) / denom);
		};

		if (!Number.isFinite(size) || size < MIN_GAUGE_SIZE) {
			continue;
		};

		size = Math.min(size, MAX_GAUGE_SIZE);

		if (!best || size > best.size) {
			best = {cols, rows, size};
		};
	};

	return best;
};

export function fitName(name, limit) {
	const value = String(name ?? '');

	if (!Number.isFinite(limit) || value.length <= limit) {
		return value;
	};

	if (limit <= 1) {
		return value.slice(0, 1);
	};

	return `${value.slice(0, limit - 1)}\u2026`;
};

export function bestLayout(count, availWidth, availHeight, showName, textRatio) {
	let best = null;

	for (const horizontal of [false, true]) {
		const grid = bestGrid(count, availWidth, availHeight, {horizontal, showName, textRatio});

		if (!grid || (showName && grid.size < MIN_TEXT_GAUGE)) {
			continue;
		};

		const score = grid.size + (horizontal ? 1 : 0);

		if (!best || score > best.score) {
			best = {...grid, horizontal, showName, textRatio, score};
		};
	};

	return best;
};

export function singleDeviceLayout(availWidth, availHeight) {
	const cap = Math.max(MIN_GAUGE_SIZE, availWidth - HORIZONTAL_GAP - MIN_TEXT_WIDTH);
	const size = Math.max(MIN_GAUGE_SIZE, Math.min(availHeight, availWidth * 0.5, cap));
	const textWidth = Math.max(MIN_TEXT_WIDTH, availWidth - size - HORIZONTAL_GAP);

	return {
		cols: 1,
		rows: 1,
		size,
		horizontal: true,
		showName: true,
		textRatio: textWidth / size,
		textWidth,
		score: 1,
	};
};

export function computeLayout(count, availWidth, availHeight, textRatio) {
	if (count === 1) {
		return singleDeviceLayout(availWidth, availHeight);
	};

	if (count <= TEXT_SLOT_LIMIT) {
		const named = bestLayout(count, availWidth, availHeight, true, textRatio);

		if (named) {
			return named;
		};
	};

	const plain = bestLayout(count, availWidth, availHeight, false, textRatio);

	if (plain) {
		return plain;
	};

	return {cols: count, rows: 1, size: MIN_GAUGE_SIZE, horizontal: false, showName: false, textRatio, score: 0};
};
