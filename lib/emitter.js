import { warn } from '../logger.js';

export class EventEmitter {
	constructor(label = '') {
		this._listeners = new Set();
		this._emitterLabel = label;
	};

	subscribe(callback) {
		this._listeners.add(callback);

		return () => this._listeners.delete(callback);
	};

	_emit() {
		for (const callback of [...this._listeners]) {
			try {
				callback();
			} catch (error) {
				if (this._emitterLabel) {
					warn(this._emitterLabel, `${this._emitterLabel} listener failed: ${error.message}`);
				};
			};
		};
	};

	_clearListeners() {
		this._listeners.clear();
	};
};