const _cache = new Map();

export function hexToRgb(hex) {
	if (_cache.has(hex)) {
		return _cache.get(hex);
	};

	const cleaned = String(hex || '').replace('#', '').trim();
	const padded = cleaned.length === 3
		? cleaned.split('').map(part => part + part).join('')
		: cleaned.padEnd(6, '0').slice(0, 6);
	const value = Number.parseInt(padded, 16);

	const result = Number.isFinite(value)
		? [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
		: [0.6, 0.6, 0.6];

	_cache.set(hex, result);
	return result;
};

export function hexToRgbaArray(hex, alpha) {
	return [...hexToRgb(hex), alpha];
};

export function hexToCssRgba(hex, alpha) {
	const [r, g, b] = hexToRgb(hex);

	return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
};

export function luminance(hex) {
	const [r, g, b] = hexToRgb(hex);

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function contrastInk(hex, fallback) {
	return luminance(hex) > 0.62 ? (fallback || '#111111') : '#ffffff';
};

export function withAlpha(hex, alpha) {
	const cleaned = String(hex || '').replace('#', '').trim();
	const full = cleaned.length === 3
		? cleaned.split('').map(part => part + part).join('')
		: cleaned.padEnd(6, '0').slice(0, 6);
	const value = Number.parseInt(full, 16);

	if (!Number.isFinite(value)) {
		return `rgba(127, 127, 127, ${alpha})`;
	};

	const r = (value >> 16) & 0xff;
	const g = (value >> 8) & 0xff;
	const b = value & 0xff;

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};