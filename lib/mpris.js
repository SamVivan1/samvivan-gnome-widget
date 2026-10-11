import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { warn } from '../logger.js';
import { LyricsClient } from './lyricsClient.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PLAYER_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const DBUS_NAME = 'org.freedesktop.DBus';
const DBUS_PATH = '/org/freedesktop/DBus';

const EMPTY_FIELDS = {title: '', artist: '', album: '', artUrl: '', lengthUs: 0};
const EMPTY_LYRICS = {status: 'idle', synced: [], syncedText: '', plainText: ''};

function unpack(value) {
	return value instanceof GLib.Variant ? value.recursiveUnpack() : value;
};

function text(value) {
	if (value === null || value === undefined) {
		return '';
	};

	if (Array.isArray(value)) {
		return value.map(item => text(item)).filter(item => item.length > 0).join(', ');
	};

	return String(value);
};

export class MprisData {
	constructor() {
		this._bus = Gio.DBus.session;
		this._players = new Map();
		this._active = null;
		this._fields = {...EMPTY_FIELDS};
		this._playback = 'Stopped';
		this._positionUs = 0;
		this._positionAt = 0;
		this._trackId = '';
		this._lyrics = {...EMPTY_LYRICS};
		this._lyricsClient = new LyricsClient();
		this._listeners = new Set();
		this._started = false;
		this._enabled = true;
		this._nameOwnerId = 0;
		this._propsSignalId = 0;
	};

	start() {
		if (this._started) {
			return;
		};

		this._started = true;

		this._nameOwnerId = this._bus.signal_subscribe(
			DBUS_NAME,
			DBUS_NAME,
			'NameOwnerChanged',
			DBUS_PATH,
			null,
			Gio.DBusSignalFlags.NONE,
			(_connection, _sender, _path, _interface, _signal, params) => {
				const [name, , owner] = params.deep_unpack();

				if (!name.startsWith(PREFIX)) {
					return;
				};

				if (owner) {
					this._players.set(name, true);
				} else {
					this._players.delete(name);
				};

				if (name === this._active && this._propsSignalId) {
					this._unsubscribeProps();
				};

				this._pickActive();
			}
		);

		this._listNames();
	};

	stop() {
		this._started = false;

		if (this._nameOwnerId) {
			this._bus.signal_unsubscribe(this._nameOwnerId);
			this._nameOwnerId = 0;
		};

		this._unsubscribeProps();
		this._lyricsClient.cancel();
		this._players.clear();
		this._active = null;
		this._listeners.clear();
	};

	setEnabled(enabled) {
		enabled = enabled === true;

		if (enabled === this._enabled) {
			return;
		};

		this._enabled = enabled;

		if (!this._started) {
			return;
		};

		if (!enabled) {
			this._unsubscribeProps();
			this._lyricsClient.cancel();
			this._players.clear();
			this._active = null;
			this._fields = {...EMPTY_FIELDS};
			this._playback = 'Stopped';
			this._trackId = '';
			this._lyrics = {...EMPTY_LYRICS};
			this._emit();
			return;
		};

		this._listNames();
	};

	subscribe(callback) {
		this._listeners.add(callback);

		return () => this._listeners.delete(callback);
	};

	get view() {
		return {
			available: this._active !== null,
			playback: this._playback,
			title: this._fields.title,
			artist: this._fields.artist,
			album: this._fields.album,
			artUrl: this._fields.artUrl,
			lengthUs: this._fields.lengthUs,
			positionUs: this.positionUs(),
			lyrics: this._lyrics,
		};
	};

	positionUs() {
		if (this._playback !== 'Playing') {
			return this._positionUs;
		};

		const elapsed = Math.max(0, this._now() - this._positionAt) * 1000000;
		const position = this._positionUs + elapsed;

		return this._fields.lengthUs > 0 ? Math.min(position, this._fields.lengthUs) : position;
	};

	renderKey() {
		return [
			this._active ?? '',
			this._playback,
			this._trackId,
			this._fields.title,
			this._fields.artist,
			this._fields.album,
			this._fields.artUrl,
			this._lyrics.status,
			this._lyrics.synced.length,
		].join('|');
	};

	_now() {
		return GLib.get_monotonic_time() / 1000000;
	};

	_listNames() {
		this._bus.call(
			DBUS_NAME,
			DBUS_PATH,
			DBUS_NAME,
			'ListNames',
			null,
			null,
			Gio.DBusCallFlags.NONE,
			-1,
			null,
			(connection, result) => {
				let reply;

				try {
					reply = connection.call_finish(result);
				} catch (error) {
					warn('mpris', `could not list names: ${error.message}`);
					return;
				};

				const [names] = reply.deep_unpack();

				for (const name of names ?? []) {
					if (name.startsWith(PREFIX)) {
						this._players.set(name, true);
					};
				};

				this._pickActive();
			}
		);
	};

	_pickActive() {
		if (!this._enabled) {
			return;
		};

		const previous = this._active;

		if (this._active && !this._players.has(this._active)) {
			this._active = null;
		};

		if (!this._active) {
			this._active = this._players.keys().next().value ?? null;
		};

		if (this._active === previous && this._propsSignalId) {
			return;
		};

		this._unsubscribeProps();
		this._lyricsClient.cancel();

		if (!this._active) {
			this._fields = {...EMPTY_FIELDS};
			this._playback = 'Stopped';
			this._trackId = '';
			this._lyrics = {...EMPTY_LYRICS};
			this._emit();
			return;
		};

		this._propsSignalId = this._bus.signal_subscribe(
			this._active,
			PROPS_IFACE,
			'PropertiesChanged',
			PLAYER_PATH,
			null,
			Gio.DBusSignalFlags.NONE,
			(_connection, _sender, _path, _interface, _signal, params) => {
				this._onPropertiesChanged(params);
			}
		);

		this._getAll(this._active);
	};

	_unsubscribeProps() {
		if (this._propsSignalId) {
			this._bus.signal_unsubscribe(this._propsSignalId);
			this._propsSignalId = 0;
		};
	};

	_getAll(name) {
		this._bus.call(
			name,
			PLAYER_PATH,
			PROPS_IFACE,
			'GetAll',
			GLib.Variant.new('(s)', [PLAYER_IFACE]),
			null,
			Gio.DBusCallFlags.NONE,
			-1,
			null,
			(connection, result) => {
				let reply;

				try {
					reply = connection.call_finish(result);
				} catch {
					return;
				};

				const [props] = reply.recursiveUnpack();

				if (props) {
					this._applyProperties(props);
				};
			}
		);
	};

	_getPosition(name) {
		this._bus.call(
			name,
			PLAYER_PATH,
			PROPS_IFACE,
			'Get',
			GLib.Variant.new('(ss)', [PLAYER_IFACE, 'Position']),
			null,
			Gio.DBusCallFlags.NONE,
			-1,
			null,
			(connection, result) => {
				let reply;

				try {
					reply = connection.call_finish(result);
				} catch {
					this._positionAt = this._now();
					return;
				};

				const [value] = reply.recursiveUnpack();

				this._samplePosition(Number(value) || 0);
			}
		);
	};

	_onPropertiesChanged(params) {
		const [iface, changed] = params.deep_unpack();

		if (iface !== PLAYER_IFACE) {
			return;
		};

		let trackChanged = false;

		if (changed.PlaybackStatus !== undefined) {
			this._playback = text(unpack(changed.PlaybackStatus)) || 'Stopped';

			if (this._active) {
				this._getPosition(this._active);
			} else {
				this._positionAt = this._now();
			};
		};

		if (changed.Metadata !== undefined) {
			const metadata = unpack(changed.Metadata) ?? {};
			const trackId = text(metadata['mpris:trackid']);

			trackChanged = trackId !== this._trackId;
			this._readMetadata(metadata);
		};

		if (changed.Position !== undefined) {
			this._samplePosition(Number(unpack(changed.Position)) || 0);
		};

		if (trackChanged) {
			this._fetchLyrics();
		};

		this._emit();
	};

	_applyProperties(props) {
		this._playback = text(props.PlaybackStatus) || 'Stopped';
		this._readMetadata(props.Metadata ?? {});
		this._samplePosition(Number(props.Position) || 0);
		this._fetchLyrics();
		this._emit();
	};

	_readMetadata(metadata) {
		this._trackId = text(metadata['mpris:trackid']);
		this._fields = {
			title: text(metadata['xesam:title']),
			artist: text(metadata['xesam:artist']),
			album: text(metadata['xesam:album']),
			artUrl: text(metadata['mpris:artUrl']),
			lengthUs: Number(metadata['mpris:length']) || 0,
		};
	};

	_fetchLyrics() {
		const {title, artist, album, lengthUs} = this._fields;

		this._lyricsClient.cancel();
		this._lyrics = {status: 'loading', synced: [], syncedText: '', plainText: ''};
		this._emit();

		if (!title) {
			this._lyrics = {...EMPTY_LYRICS};
			return;
		};

		this._lyricsClient.fetch(
			{artist, title, album, duration: this._fields.lengthUs / 1000000},
			result => {
				this._lyrics = result;
				this._emit();
			}
		);
	};

	_samplePosition(us) {
		this._positionUs = Math.max(0, Number(us) || 0);
		this._positionAt = this._now();
	};

	_emit() {
		for (const callback of [...this._listeners]) {
			try {
				callback();
			} catch (error) {
				warn('media-listener', `MPRIS data listener failed: ${error.message}`);
			};
		};
	};
};
