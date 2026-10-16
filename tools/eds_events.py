#!/usr/bin/env python3
"""Read calendar events from Evolution Data Server and print JSON.

Usage:
    eds_events.py <start-epoch> <end-epoch> [--sources=uid1,uid2]

Output (stdout, single line JSON):
    {
      "ok": true,
      "events": [
        {"id", "summary", "start", "end", "allDay",
         "sourceUid", "sourceName", "sourceColor", "holiday"}
      ],
      "sources": [
        {"uid", "name", "color", "holiday", "enabled"}
      ]
    }

All times are unix epoch seconds (local wall-clock for floating events).
This runs in a separate process on purpose: importing EDS inside gnome-shell
crashes the shell when the GObject references are finalized.
"""

import json
import re
import sys

HOLIDAY_RE = re.compile(r'holiday|libur|cuti|festiv|feriado|feri', re.IGNORECASE)
RECURRENCE_CAP = 10000

ECal = None
EDataServer = None
ICalGLib = None


def load_eds():
    """Import the EDS introspection bindings, returning an error string or None."""
    global ECal, EDataServer, ICalGLib

    try:
        import gi

        gi.require_version('EDataServer', '1.2')
        gi.require_version('ECal', '2.0')
        gi.require_version('ICalGLib', '3.0')

        from gi.repository import ECal as _ECal
        from gi.repository import EDataServer as _EDataServer
        from gi.repository import ICalGLib as _ICalGLib

        ECal = _ECal
        EDataServer = _EDataServer
        ICalGLib = _ICalGLib
        return None
    except Exception as error:
        return str(error)


def parse_args(argv):
    start = end = None
    sources = None
    list_sources = False

    for arg in argv:
        if arg.startswith('--sources='):
            raw = arg.split('=', 1)[1].strip()
            sources = {uid for uid in raw.split(',') if uid}
        elif arg == '--list-sources':
            list_sources = True
        elif start is None:
            start = int(arg)
        elif end is None:
            end = int(arg)

    if not list_sources:
        if start is None or end is None:
            raise SystemExit('usage: eds_events.py <start-epoch> <end-epoch> [--sources=...]')
    elif start is None:
        start = 0

    return start, end, sources, list_sources


def text_value(component_text):
    if component_text is None:
        return ''

    try:
        return component_text.get_value() or ''
    except Exception:
        return str(component_text)


def component_time(component_date_time):
    if component_date_time is None:
        return None

    try:
        return component_date_time.get_value()
    except Exception:
        return None


def occurrences(component, start_epoch, end_epoch):
    """Yield (start, end, all_day) tuples within [start_epoch, end_epoch]."""
    dtstart = component_time(component.get_dtstart())

    if dtstart is None:
        return []

    start_ts = dtstart.as_timet()
    dtend = component_time(component.get_dtend())
    end_ts = dtend.as_timet() if dtend is not None else start_ts
    all_day = dtstart.is_date()

    if end_ts <= start_ts:
        end_ts = start_ts + (86400 if all_day else 3600)

    duration = end_ts - start_ts
    rules = list(component.get_rrules() or [])
    results = []

    def expand_rule(rule):
        try:
            iterator = ICalGLib.RecurIterator.new(rule, dtstart)
        except Exception:
            return

        seen = 0

        while seen < RECURRENCE_CAP:
            occurrence = iterator.next()

            if occurrence is None:
                break

            ts = occurrence.as_timet()
            seen += 1

            if ts >= end_epoch:
                break

            if ts + duration > start_epoch:
                yield ts

    def entry_moment(entry):
        moment = component_time(entry)

        if moment is not None:
            return moment

        # RDATEs arrive as periods; EXDATEs as datetimes.
        get_start = getattr(entry, 'get_start', None)

        if callable(get_start):
            try:
                return get_start()
            except Exception:
                return None

        return None

    # Deleted and moved-away instances never render, even when the RRULE
    # still generates them.
    excluded = set()

    for entry in component.get_exdates() or []:
        moment = entry_moment(entry)

        if moment is not None:
            excluded.add(moment.as_timet())

    for rule in component.get_exrules() or []:
        excluded.update(expand_rule(rule))

    # RDATEs add standalone occurrences on top of the base instance.
    extra = []

    for entry in component.get_rdates() or []:
        moment = entry_moment(entry)

        if moment is None:
            continue

        ts = moment.as_timet()

        if ts < end_epoch and ts + duration > start_epoch and ts not in excluded:
            extra.append((ts, ts + duration, all_day))

    if not rules:
        if start_ts < end_epoch and end_ts > start_epoch and start_ts not in excluded:
            results.append((start_ts, end_ts, all_day))

        return results + extra

    for rule in rules:
        for ts in expand_rule(rule):
            if ts not in excluded:
                results.append((ts, ts + duration, all_day))

    return results + extra


def source_color(source):
    try:
        extension = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)
    except Exception:
        return ''

    for getter in ('get_color',):
        try:
            value = getattr(extension, getter)()
        except Exception:
            continue

        if value:
            return value

    return ''


def is_holiday(name):
    return bool(name and HOLIDAY_RE.search(name))


def build_payload(start_epoch, end_epoch, only_sources, list_sources=False):
    registry = EDataServer.SourceRegistry.new_sync(None)
    events = []
    sources_meta = []

    for source in registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR):
        uid = source.get_uid()
        name = source.get_display_name() or uid

        if not source.get_enabled():
            continue

        if only_sources is not None and uid not in only_sources:
            continue

        try:
            selected = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR).get_selected()
        except Exception:
            selected = True

        # When the caller is not filtering, respect the calendar's own
        # "selected" flag. When filtering, take exactly what was requested.
        if only_sources is None and selected is False:
            continue

        color = source_color(source)
        holiday = is_holiday(name)

        sources_meta.append({
            'uid': uid,
            'name': name,
            'color': color,
            'holiday': holiday,
            'enabled': True,
        })

        if list_sources:
            continue

        try:
            client = ECal.Client.connect_sync(
                source, ECal.ClientSourceType.EVENTS, 5, None)
            ok, components = client.get_object_list_as_comps_sync('#t', None)
        except Exception:
            continue

        if not ok or not components:
            continue

        for component in components:
            summary = text_value(component.get_summary())

            for occ_start, occ_end, all_day in occurrences(
                    component, start_epoch, end_epoch):
                events.append({
                    'id': f'{uid}:{component.get_uid()}:{occ_start}',
                    'summary': summary or ('All day' if all_day else 'Untitled'),
                    'start': occ_start,
                    'end': occ_end,
                    'allDay': all_day,
                    'sourceUid': uid,
                    'sourceName': name,
                    'sourceColor': color,
                    'holiday': holiday,
                })

    events.sort(key=lambda event: (event['start'], event['end'], event['summary']))

    return {'ok': True, 'events': events, 'sources': sources_meta}


def main():
    try:
        start_epoch, end_epoch, only_sources, list_sources = parse_args(sys.argv[1:])
    except (ValueError, SystemExit) as error:
        print(json.dumps({
            'ok': False,
            'error': f'invalid arguments: {error}',
            'events': [],
            'sources': [],
        }))
        return

    error = load_eds()

    if error is not None:
        print(json.dumps({
            'ok': False,
            'error': f'Evolution Data Server introspection unavailable: {error}',
            'events': [],
            'sources': [],
        }))
        return

    try:
        payload = build_payload(start_epoch, end_epoch, only_sources, list_sources)
    except Exception as error:
        payload = {'ok': False, 'error': str(error), 'events': [], 'sources': []}

    print(json.dumps(payload))


if __name__ == '__main__':
    sys.exit(main())
