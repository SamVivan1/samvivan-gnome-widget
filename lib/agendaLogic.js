export function startOfDay(date) {
	const day = new Date(date);

	day.setHours(0, 0, 0, 0);
	return day;
};

export function addDays(date, amount) {
	const next = new Date(date);

	next.setDate(next.getDate() + amount);
	return next;
};

export function sameDay(a, b) {
	return a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
};

export function formatTime(date) {
	return date.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
	});
};

export function formatTimeRange(startDate, endDate) {
	return `${formatTime(startDate)}–${formatTime(endDate)}`;
};

export function formatCountdown(milliseconds) {
	const totalMinutes = Math.max(0, Math.round(milliseconds / 60000));

	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	};

	const hours = Math.floor(totalMinutes / 60);

	if (hours < 24) {
		return `${hours}h ${totalMinutes % 60}m`;
	};

	return `${Math.floor(hours / 24)}d`;
};

export function isPastEvent(event, now = new Date()) {
	return Number(event.end) <= now.getTime();
};

/**
 * Daily-briefing plan: every event of today first, then the next
 * `upcomingDays` days that actually have events. Entry shapes:
 * {kind: 'today'} | {kind: 'day', date, isTomorrow} |
 * {kind: 'event', event, day} | {kind: 'empty'}
 */
export function nextUp(events, now = new Date()) {
	const at = now.getTime();
	let ongoing = null;
	let upcoming = null;

	for (const event of events) {
		if (Number(event.end) <= at) {
			continue;
		};

		if (Number(event.start) <= at) {
			if (!ongoing || Number(event.end) < Number(ongoing.end)) {
				ongoing = event;
			};

			continue;
		};

		if (!upcoming || Number(event.start) < Number(upcoming.start)) {
			upcoming = event;
		};
	};

	if (ongoing) {
		return {kind: 'ongoing', event: ongoing};
	};

	if (upcoming) {
		return {kind: 'upcoming', event: upcoming};
	};

	return null;
};

export function buildDayPlan(calendar, today, upcomingDays, options = {}) {
	const {extraDays = 0} = options;
	const entries = [];
	const todayEvents = calendar.eventsOnDay(today);

	if (todayEvents.length > 0) {
		entries.push({kind: 'today', date: today, isTomorrow: false});

		for (const event of todayEvents) {
			entries.push({kind: 'event', event, day: today});
		};
	} else {
		entries.push({kind: 'empty'});
	};

	for (let offset = 1; offset <= upcomingDays + extraDays; offset++) {
		const day = addDays(today, offset);
		const dayEvents = calendar.eventsOnDay(day);

		if (dayEvents.length === 0) {
			continue;
		};

		entries.push({kind: 'day', date: day, isTomorrow: offset === 1});

		for (const event of dayEvents) {
			entries.push({kind: 'event', event, day});
		};
	};

	return entries;
};
