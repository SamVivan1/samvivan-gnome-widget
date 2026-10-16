import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { warn } from '../logger.js';
import { fetchSameOrigin } from './http.js';
import { cacheKey, parseSyncedLyrics } from './lyrics.js';

const GET_URL = 'https://lrclib.net/api/get';
const SEARCH_URL = 'https://lrclib.net/api/search';
const REQUEST_TIMEOUT_SECONDS = 12;
const USER_AGENT = 'desktop-widget (https://github.com/SamVivan1/samvivan-gnome-widget)';
const CACHE_DIR = 'lyrics';

function buildResult(payload) {
	if (!payload || typeof payload !== 'object') {
		return null;
	};

	const syncedText = typeof payload.syncedLyrics === 'string' ? payload.syncedLyrics : '';
	const plainText = typeof payload.plainLyrics === 'string' ? payload.plainLyrics : '';

	if (payload.instrumental === true) {
		return {status: 'instrumental', synced: [], syncedText: '', plainText: ''};
	};

	const synced = parseSyncedLyrics(syncedText);

	if (synced.length === 0 && !plainText) {
		return null;
	};

	return {status: 'ok', synced, syncedText, plainText};
};

export class LyricsClient {
	constructor() {
		this._session = new Soup.Session({
			timeout: REQUEST_TIMEOUT_SECONDS,
			user_agent: USER_AGENT,
		});
		this._cancellable = null;
		this._seq = 0;
	};

	cancel() {
		this._seq += 1;
		this._cancellable?.cancel();
		this._cancellable = null;
	};

	fetch({artist = '', title = '', album = '', duration = 0}, callback) {
		const key = cacheKey({artist, title, album, duration});

		if (!String(title).trim()) {
			callback({status: 'none', synced: [], syncedText: '', plainText: ''});
			return;
		};

		const cached = this._readCache(key);

		if (cached) {
			callback(cached);
			return;
		};

		const seq = ++this._seq;

		this._cancellable?.cancel();
		this._cancellable = new Gio.Cancellable();

		this._request(this._getUrl({artist, title, album, duration}), payload => {
			if (seq !== this._seq) {
				return;
			};

			const result = buildResult(payload);

			if (result) {
				this._writeCache(key, result);
				callback(result);
				return;
			};

			this._request(this._searchUrl({artist, title}), fallback => {
				if (seq !== this._seq) {
					return;
				};

				const found = this._pickSearch(fallback);

				if (found) {
					this._writeCache(key, found);
					callback(found);
					return;
				};

				callback({status: 'none', synced: [], syncedText: '', plainText: ''});
			});
		});
	};

	_getUrl({artist, title, album, duration}) {
		const parts = [
			`artist_name=${encodeURIComponent(artist)}`,
			`track_name=${encodeURIComponent(title)}`,
		];

		if (String(album).trim()) {
			parts.push(`album_name=${encodeURIComponent(album)}`);
		};

		const seconds = Math.round(Number(duration) || 0);

		if (seconds > 0) {
			parts.push(`duration=${seconds}`);
		};

		return `${GET_URL}?${parts.join('&')}`;
	};

	_searchUrl({artist, title}) {
		return `${SEARCH_URL}?${[
			`artist_name=${encodeURIComponent(artist)}`,
			`track_name=${encodeURIComponent(title)}`,
		].join('&')}`;
	};

	_pickSearch(payload) {
		if (!Array.isArray(payload)) {
			return null;
		};

		let plain = null;

		for (const entry of payload) {
			const result = buildResult(entry);

			if (!result) {
				continue;
			};

			if (result.synced.length > 0) {
				return result;
			};

			plain = plain ?? result;
		};

		return plain;
	};

	_request(url, callback) {
		fetchSameOrigin(this._session, 'GET', url, {
			headers: {'accept': 'application/json'},
			maxBytes: 1024 * 1024,
			cancellable: this._cancellable,
		}).then(({bytes, status}) => {
			if (status !== Soup.Status.OK) {
				callback(null);
				return;
			};

			try {
				callback(JSON.parse(new TextDecoder().decode(bytes.get_data())));
			} catch (error) {
				warn('lyrics', `could not parse lyrics response: ${error.message}`);
				callback(null);
			};
		}).catch(error => {
			if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
				warn('lyrics', `lyrics request failed: ${error.message}`);
			};

			callback(null);
		});
	};

	_cachePath(key) {
		const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'desktop-widget', CACHE_DIR]);
		const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);

		return GLib.build_filenamev([directory, `${name}.json`]);
	};

	_readCache(key) {
		const path = this._cachePath(key);

		if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
			return null;
		};

		try {
			const [ok, contents] = GLib.file_get_contents(path);

			if (!ok) {
				return null;
			};

			const payload = JSON.parse(new TextDecoder().decode(contents));

			if (payload.instrumental === true) {
				return {status: 'instrumental', synced: [], syncedText: '', plainText: ''};
			};

			const syncedText = typeof payload.syncedLyrics === 'string' ? payload.syncedLyrics : '';

			return {status: 'ok', synced: parseSyncedLyrics(syncedText), syncedText, plainText: payload.plainLyrics ?? ''};
		} catch (error) {
			return null;
		};
	};

	_writeCache(key, result) {
		const path = this._cachePath(key);

		try {
			GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
			GLib.file_set_contents(path, JSON.stringify({
				instrumental: result.status === 'instrumental',
				syncedLyrics: result.syncedText ?? '',
				plainLyrics: result.plainText ?? '',
			}));
		} catch (error) {
			warn('lyrics', `could not write lyrics cache: ${error.message}`);
		};
	};
};
