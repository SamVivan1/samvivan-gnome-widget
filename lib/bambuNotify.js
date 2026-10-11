const ACTIVE = ['RUNNING', 'PAUSE', 'PREPARE', 'SLICING'];

function normalizeStatus(status) {
	const source = status?.status ?? status;

	if (!source || typeof source !== 'object' || typeof source.connected === 'undefined') {
		return null;
	};

	return {
		connected: source.connected === true,
		state: String(source.state ?? 'IDLE').toUpperCase(),
	};
};

/**
 * Maps a printer status change onto a notification. Returns null when nothing
 * changed, when the first sample arrives, or when the transition is not worth
 * interrupting the user for.
 *
 * @param {object} previous raw status snapshot (may be null)
 * @param {object} next raw status snapshot (may be null)
 * @returns {{id: string, title: string, urgent: boolean}|null}
 */
export function bambuNotification(previous, next) {
	const before = normalizeStatus(previous);
	const after = normalizeStatus(next);

	if (!before || !after) {
		return null;
	};

	if (after.connected !== before.connected) {
		return after.connected
			? {id: 'printer-connected', title: 'Printer connected', urgent: false}
			: {id: 'printer-disconnected', title: 'Printer disconnected', urgent: true};
	};

	if (!after.connected || before.state === after.state) {
		return null;
	};

	const previousActive = ACTIVE.includes(before.state);

	if (after.state === 'RUNNING') {
		return {
			id: 'print-started',
			title: before.state === 'PAUSE' ? 'Print resumed' : 'Print started',
			urgent: false,
		};
	};

	if (after.state === 'PAUSE' && previousActive) {
		return {id: 'print-paused', title: 'Print paused', urgent: false};
	};

	if (after.state === 'FINISH' && previousActive) {
		return {id: 'print-finished', title: 'Print finished', urgent: false};
	};

	if (after.state === 'FAILED') {
		return {id: 'print-failed', title: 'Print failed', urgent: true};
	};

	return null;
};
