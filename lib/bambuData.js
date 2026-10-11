import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { warn } from '../logger.js';
import { statusSignature } from './bambuStatus.js';

const REQUEST_TIMEOUT_SECONDS = 10;
const DEFAULT_REFRESH_SECONDS = 5;
const MIN_REFRESH_SECONDS = 3;
const MAX_REFRESH_SECONDS = 300;

function trimmed(value) {
	return (value ?? '').trim();
};

function clampRefresh(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return DEFAULT_REFRESH_SECONDS;
	};

	return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, Math.round(seconds)));
};

export class BambuData {
	constructor(settings) {
		this._settings = settings;
		this._status = null;
		this._state = 'idle';
		this._error = '';
		this._lastSignature = '';
		this._listeners = new Set();
		this._timeoutId = 0;
		this._started = false;
		this._enabled = true;
		this._session = new Soup.Session({
			timeout: REQUEST_TIMEOUT_SECONDS,
			user_agent: 'desktop-widget',
		});
		this._cancellable = null;
	};

	start() {
		if (this._started) {
			return;
		};

		this._started = true;
		this.refresh();
		this._schedule();
	};

	stop() {
		this._started = false;

		if (this._timeoutId) {
			GLib.source_remove(this._timeoutId);
			this._timeoutId = 0;
		};

		this._cancellable?.cancel();
		this._cancellable = null;
		this._listeners.clear();
	};

	reconfigure() {
		if (!this._started) {
			return;
		};

		if (this._timeoutId) {
			GLib.source_remove(this._timeoutId);
			this._timeoutId = 0;
		};

		if (!this._enabled) {
			return;
		};

		this.refresh();
		this._schedule();
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
			if (this._timeoutId) {
				GLib.source_remove(this._timeoutId);
				this._timeoutId = 0;
			};

			this._cancellable?.cancel();
			this._cancellable = null;
			return;
		};

		this.refresh();
		this._schedule();
	};

	subscribe(callback) {
		this._listeners.add(callback);

		return () => this._listeners.delete(callback);
	};

	get status() {
		return this._status;
	};

	get state() {
		return this._state;
	};

	get error() {
		return this._error;
	};

	renderKey() {
		return `${this._state}|${this._error}|${statusSignature(this._status)}`;
	};

	get available() {
		return this._state === 'ready';
	};

	get configured() {
		const {endpoint, token} = this.config();

		return endpoint.length > 0 && token.length > 0;
	};

	config() {
		let endpoint = trimmed(this._settings.get_string('bambu-endpoint-url')).replace(/\/+$/, '');
		const token = trimmed(this._settings.get_string('bambu-token'));

		if (endpoint && !/^https?:\/\//i.test(endpoint)) {
			endpoint = `https://${endpoint}`;
		};

		return {endpoint, token};
	};

	_intervalSeconds() {
		return clampRefresh(this._settings.get_int('bambu-refresh'));
	};

	_schedule() {
		this._timeoutId = GLib.timeout_add_seconds(
			GLib.PRIORITY_DEFAULT,
			this._intervalSeconds(),
			() => {
				this.refresh();
				return GLib.SOURCE_CONTINUE;
			});
	};

	refresh() {
		if (!this._started) {
			return;
		};

		const {endpoint, token} = this.config();

		if (!endpoint || !token) {
			this._fail('unavailable', 'Set the endpoint URL and token in preferences');
			return;
		};

		let message;

		try {
			message = Soup.Message.new('GET', `${endpoint}/status`);
		} catch (error) {
			this._fail('error', `invalid endpoint URL: ${error.message}`);
			return;
		};

		if (!message) {
			this._fail('error', 'invalid endpoint URL');
			return;
		};

		message.request_headers.append('Authorization', `Bearer ${token}`);
		message.request_headers.append('accept', 'application/json');

		this._cancellable?.cancel();
		this._cancellable = new Gio.Cancellable();

		const cancellable = this._cancellable;

		this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
			if (this._cancellable !== cancellable || cancellable.is_cancelled()) {
				return;
			};

			this._onResponse(message, result);
		});
	};

	_onResponse(message, result) {
		let bytes;

		try {
			bytes = this._session.send_and_read_finish(result);
		} catch (error) {
			this._fail('error', `request failed: ${error.message}`);
			return;
		};

		const status = message.get_status();

		if (status !== Soup.Status.OK) {
			this._fail('error', `server responded with status ${status}`);
			return;
		}

		let payload;

		try {
			payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));
		} catch (error) {
			this._fail('error', `could not parse response: ${error.message}`);
			return;
		}

		if (!payload || payload.ok !== true) {
			this._fail('unavailable', payload?.error || 'bridge reported an error');
			return;
		};

		this._status = payload;
		this._state = 'ready';
		this._error = payload.connected === true ? '' : 'printer offline';
		this._emitIfChanged();
	};

	_fail(state, message) {
		const wasReady = this._state === 'ready';

		this._state = state;
		this._error = message;

		if (wasReady || message !== this._lastSignature) {
			this._lastSignature = message;
			this._emit();
		};
	};

	_emitIfChanged() {
		const signature = statusSignature(this._status);

		if (signature === this._lastSignature) {
			return;
		};

		this._lastSignature = signature;
		this._emit();
	};

	_emit() {
		for (const callback of [...this._listeners]) {
			try {
				callback();
			} catch (error) {
				warn('bambu-listener', `Bambu data listener failed: ${error.message}`);
			};
		};
	};
};
