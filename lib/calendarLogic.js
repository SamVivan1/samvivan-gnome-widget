export function dateKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export function daysForRange(startMs, endMs) {
  const days = new Set();
  const start = new Date(startMs);
  const end = new Date(Math.max(startMs, endMs - 1));

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  // Calendar-day stepping (not fixed 86400000ms): days are 23-25h long
  // around DST transitions, and fixed steps skip the trailing day.
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    days.add(dateKey(day));
  };

  return days;
};

export function normalizeEvent(raw) {
  const start = raw.start * 1000;
  const end = Math.max(raw.end * 1000, start + 1000);

  return {
    id: raw.id,
    summary: raw.summary,
    start,
    end,
    allDay: raw.allDay === true,
    holiday: raw.holiday === true,
    sourceUid: raw.sourceUid,
    sourceName: raw.sourceName,
    sourceColor: raw.sourceColor || '',
    startDate: new Date(start),
    endDate: new Date(end),
    days: daysForRange(start, end),
  };
};
