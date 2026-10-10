import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const REFRESH_SECONDS = 300;
const PAST_DAYS = 45;
const FUTURE_DAYS = 60;

export function dateKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
};

function daysForRange(startMs, endMs) {
  const days = new Set();
  const start = new Date(startMs);
  const end = new Date(Math.max(startMs, endMs - 1));

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  for (let time = start.getTime(); time <= end.getTime(); time += 86400000) {
    days.add(dateKey(new Date(time)));
  };

  return days;
};

function normalizeEvent(raw) {
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

export class CalendarData {
  constructor(extensionPath) {
    this._helper = GLib.build_filenamev([extensionPath, 'tools', 'eds_events.py']);
    this._python = GLib.find_program_in_path('python3');
    this._events = [];
    this._sources = [];
    this._status = 'idle';
    this._error = '';
    this._filter = null;
    this._listeners = new Set();
    this._timeoutId = 0;
    this._proc = null;
    this._cancellable = null;
    this._started = false;
  };

  start() {
    if (this._started) {
      return;
    };

    this._started = true;
    this.refresh();

    this._timeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      REFRESH_SECONDS,
      () => {
        this.refresh();
        return GLib.SOURCE_CONTINUE;
      });
  };

  stop() {
    this._started = false;

    if (this._timeoutId) {
      GLib.source_remove(this._timeoutId);
      this._timeoutId = 0;
    };

    this._cancellable?.cancel();
    this._cancellable = null;

    if (this._proc) {
      try {
        this._proc.force_exit();
      } catch (error) {
        // process already gone
      };

      this._proc = null;
    };

    this._listeners.clear();
  };

  subscribe(callback) {
    this._listeners.add(callback);

    return () => this._listeners.delete(callback);
  };

  get status() {
    return this._status;
  };

  get error() {
    return this._error;
  };

  get events() {
    return this._events;
  };

  get sources() {
    return this._sources;
  };

  get available() {
    return this._status === 'ready';
  };

  setSourcesFilter(uids) {
    const next = Array.isArray(uids) && uids.length > 0 ? [...uids].sort().join(',') : '';
    const current = this._filter ? [...this._filter].sort().join(',') : '';

    if (next === current) {
      return;
    };

    this._filter = next ? new Set(next.split(',')) : null;
    this.refresh();
  };

  eventsBetween(startMs, endMs) {
    return this._events.filter(event => event.end > startMs && event.start < endMs);
  };

  eventsOnDay(date) {
    const key = dateKey(date);

    return this._events.filter(event => event.days.has(key));
  };

  eventCountsForMonth(year, month) {
    const counts = new Map();

    for (const event of this._events) {
      for (const key of event.days) {
        const [keyYear, keyMonth] = key.split('-').map(Number);

        if (keyYear !== year || keyMonth !== month + 1) {
          continue;
        };

        counts.set(key, (counts.get(key) ?? 0) + 1);
      };
    };

    return counts;
  };

  refresh() {
    if (!this._started) {
      return;
    };

    if (!this._python) {
      this._fail('python3 was not found on PATH');
      return;
    };

    if (!Gio.File.new_for_path(this._helper).query_exists(null)) {
      this._fail('calendar helper script is missing');
      return;
    };

    this._cancellable?.cancel();
    this._cancellable = new Gio.Cancellable();

    if (this._proc) {
      try {
        this._proc.force_exit();
      } catch (error) {
        // process already gone
      };

      this._proc = null;
    };

    const now = Math.floor(Date.now() / 1000);
    const args = [
      this._python,
      this._helper,
      `${now - PAST_DAYS * 86400}`,
      `${now + FUTURE_DAYS * 86400}`,
    ];

    if (this._filter) {
      args.push(`--sources=${[...this._filter].join(',')}`);
    };

    let proc;

    try {
      proc = Gio.Subprocess.new(
        args,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (error) {
      this._fail(`could not start the calendar helper: ${error.message}`);
      return;
    };

    this._proc = proc;

    const cancellable = this._cancellable;

    proc.communicate_utf8_async(
      null,
      cancellable,
      (source, result) => this._onOutput(proc, cancellable, result));
  };

  _onOutput(proc, cancellable, result) {
    if (this._cancellable !== cancellable || cancellable.is_cancelled()) {
      return;
    };

    this._proc = null;

    let stdout = '';

    try {
      [, stdout] = proc.communicate_utf8_finish(result);
    } catch (error) {
      this._fail(`calendar helper failed: ${error.message}`);
      return;
    };

    let payload;

    try {
      payload = JSON.parse(stdout || '{}');
    } catch (error) {
      this._fail(`could not parse calendar data: ${error.message}`);
      return;
    };

    if (payload.ok !== true) {
      this._status = 'unavailable';
      this._error = payload.error || 'calendar data is unavailable';
      this._emit();
      return;
    };

    this._events = (payload.events ?? []).map(normalizeEvent);
    this._sources = payload.sources ?? [];
    this._status = 'ready';
    this._error = '';
    this._emit();
  };

  _fail(message) {
    this._status = 'error';
    this._error = message;
    this._emit();
  };

  _emit() {
    for (const callback of [...this._listeners]) {
      try {
        callback();
      } catch (error) {
        // listener errors must not break the refresh loop
      };
    };
  };
};
