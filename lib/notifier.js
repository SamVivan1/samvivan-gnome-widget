import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { warn } from '../logger.js';

/**
 * Shows notifications through the message tray using a source owned by this
 * extension, so they are grouped under their own name instead of the generic
 * system source.
 */
export class Notifier {
	constructor(title, iconName) {
		this._title = title;
		this._iconName = iconName;
		this._source = null;
	};

	show(summary, body = null, urgent = false) {
		if (!this._title) {
			return;
		};

		try {
			const source = this._source();

			source.addNotification(new MessageTray.Notification({
				source,
				title: summary,
				body: body || null,
				urgency: urgent ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
			}));
		} catch (error) {
			warn('notifier', `could not show notification: ${error.message}`);
		};
	};

	clear() {
		this._source?.destroy();
		this._source = null;
	};

	_source() {
		if (this._source) {
			return this._source;
		};

		const source = new MessageTray.Source({
			title: this._title,
			iconName: this._iconName,
		});

		Main.messageTray.add(source);

		source.connect('destroy', () => {
			this._source = null;
		});

		this._source = source;

		return source;
	};
};
