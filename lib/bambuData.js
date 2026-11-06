import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { EventEmitter } from './emitter.js';
import { clampRefresh, isConfigured, normalizeEndpoint } from './bambuRules.js';
import { fetchSameOrigin } from './http.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import { statusSignature } from './bambuStatus.js';

const REQUEST_TIMEOUT_SECONDS = 10;

function trimmed(value) {
	return (value ?? '').trim();
};

export class BambuData extends EventEmitter {
	constructor(settings) {
		super('bambu');
		this._settings = settings;
		this._status = null;
		this._state = 'idle';
		this._error = '';
		this._lastSignature = '';
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

		if (!this._enabled) {
			return;
		};

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
		this._clearListeners();
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
			this._cancellable?.cancel();
			this._cancellable = null;
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

		return isConfigured(endpoint, token);
	};

	config() {
		const endpoint = normalizeEndpoint(this._settings.get_string('bambu-endpoint-url'));
		const token = trimmed(this._settings.get_string('bambu-token'));

		return {endpoint, token};
	};

	_intervalSeconds() {
		return clampRefresh(this._settings.get_int('bambu-refresh'));
	};

	_schedule() {
		if (this._timeoutId || !this._enabled || !this.configured) {
			return;
		};

		this._timeoutId = GLib.timeout_add_seconds(
			GLib.PRIORITY_DEFAULT,
			this._intervalSeconds(),
			() => {
				if (!this._enabled) {
					this._timeoutId = 0;
					return GLib.SOURCE_REMOVE;
				};

				this.refresh();
				return GLib.SOURCE_CONTINUE;
			});
	};

	refresh() {
		if (!this._started || !this._enabled) {
			return;
		};

		const {endpoint, token} = this.config();

		if (!endpoint || !token) {
			this._fail('unavailable', _('Set the endpoint URL and token in preferences'));
			return;
		};

		this._cancellable?.cancel();
		this._cancellable = new Gio.Cancellable();

		const cancellable = this._cancellable;

		fetchSameOrigin(this._session, 'GET', `${endpoint}/status`, {
			headers: {'Authorization': `Bearer ${token}`, 'accept': 'application/json'},
			cancellable,
		}).then(({bytes, status}) => {
			if (this._cancellable !== cancellable || cancellable.is_cancelled()) {
				return;
			};

			this._onResponseBody(bytes, status);
		}).catch(error => {
			if (this._cancellable !== cancellable || cancellable.is_cancelled()) {
				return;
			};

			if (String(error.message ?? '').startsWith('invalid URL')) {
				this._fail('error', _('invalid endpoint URL: %s').format(endpoint));
				return;
			};

			this._fail('error', _('request failed: %s').format(error.message));
		});
	};

	_onResponseBody(bytes, status) {
		if (status !== Soup.Status.OK) {
			this._fail('error', _('server responded with status %s').format(status));
			return;
		}

		let payload;

		try {
			payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));
		} catch (error) {
			this._fail('error', _('could not parse response: %s').format(error.message));
			return;
		}

		if (!payload || payload.ok !== true) {
			this._fail('unavailable', payload?.error || _('bridge reported an error'));
			return;
		};

		this._status = payload;
		this._state = 'ready';
		this._error = payload.connected === true ? '' : _('printer offline');
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

};
