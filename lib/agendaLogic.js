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
	const start = formatTime(startDate);
	const end = formatTime(endDate);
	const meridiem = end.match(/\s*([AP])\.?M\.?$/i);

	if (meridiem && start.toUpperCase().endsWith(meridiem[0].toUpperCase())) {
		return `${start.slice(0, -meridiem[0].length)}–${end}`;
	};

	return `${start}–${end}`;
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

/**
 * Decides which entries fit in `usable` pixels using measured heights
 * instead of guessed constants. Returns {shown, hiddenEvents, moreFits}:
 * hiddenEvents counts only events (never headers), and moreFits tells
 * whether the '+N more' label itself fits in the leftover space.
 */
export function fitEntries(entries, usable, moreCost, measure) {
	const costs = entries.map((entry, index) => measure(entry, index));
	let end = entries.length;

	while (end > 1 && prefixCost(costs, end) + reserveFor(entries, end, moreCost) > usable) {
		end -= 1;
	};

	// A trailing day header whose events are all hidden explains
	// nothing; drop it (and anything stranded behind it is already cut).
	while (end > 1 && entries[end - 1].kind !== 'event' && entries.slice(end).some(entry => entry.kind === 'event')) {
		end -= 1;
	};

	const hiddenEvents = entries.slice(end).filter(entry => entry.kind === 'event').length;

	return {
		shown: entries.slice(0, end),
		hiddenEvents,
		moreFits: hiddenEvents > 0 && prefixCost(costs, end) + moreCost <= usable,
	};
};

function prefixCost(costs, end) {
	let total = 0;

	for (let i = 0; i < end; i++) {
		total += costs[i];
	};

	return total;
};

function reserveFor(entries, end, moreCost) {
	const hiddenEvents = entries.slice(end).filter(entry => entry.kind === 'event').length;

	return hiddenEvents > 0 ? moreCost : 0;
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
