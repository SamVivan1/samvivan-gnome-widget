export const DEFAULT_REFRESH_SECONDS = 5;
export const MIN_REFRESH_SECONDS = 3;
export const MAX_REFRESH_SECONDS = 300;

export function clampRefresh(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return DEFAULT_REFRESH_SECONDS;
	}

	return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, Math.round(seconds)));
}

export function normalizeEndpoint(raw) {
	let endpoint = (raw ?? '').trim().replace(/\/+$/, '');

	if (endpoint && !/^https?:\/\//i.test(endpoint)) {
		endpoint = `https://${endpoint}`;
	}

	return endpoint;
}

export function isConfigured(endpoint, token) {
	return endpoint.length > 0 && token.length > 0;
}
