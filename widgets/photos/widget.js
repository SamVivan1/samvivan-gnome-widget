import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import * as Immich from './immich.js';
import { warn } from '../../logger.js';

export const type = 'photos';
export function label() { return _('Photos'); };
export const stylesheet = 'widgets/photos/stylesheet.css';
export const defaultSize = 'medium';

const IMAGE_EXTENSIONS = ['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'];
const PHOTO_CACHE_TTL_MS = 60 * 1000;
const PHOTO_RADIUS = 26;
const DEFAULT_INTERVAL_SECONDS = 1800;
const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
const IMMICH_BATCH_SIZE = 20;
const IMMICH_LOW_WATER = 4;
const IMMICH_SIZES = ['thumbnail', 'preview', 'fullsize'];
const SOURCES = ['local', 'immich', 'mixed'];
const SETTINGS_KEYS = [
	'photos-source',
	'photo-interval',
	'immich-server-url',
	'immich-api-key',
	'immich-scope',
	'immich-album-id',
	'immich-size',
];
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let picturePoolCache = {time: 0, pools: []};
const pictureAssignments = new Map();
let lastPruneTime = 0;

function collectPictures(directory, images, seenDirectories, depth = 0) {
	if (!directory || depth > 4 || images.length >= 300) {
		return;
	};

	const path = directory.get_path();

	if (!path || seenDirectories.has(path)) {
		return;
	};

	seenDirectories.add(path);

	let enumerator = null;

	try {
		enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
		let info;

		while ((info = enumerator.next_file(null)) !== null) {
			if (images.length >= 300) {
				break;
			};

			const child = directory.get_child(info.get_name());

			if (info.get_file_type() === Gio.FileType.DIRECTORY) {
				collectPictures(child, images, seenDirectories, depth + 1);
				continue;
			};

			if (info.get_file_type() !== Gio.FileType.REGULAR) {
				continue;
			};

			const lower = info.get_name().toLowerCase();

			if (IMAGE_EXTENSIONS.some(extension => lower.endsWith(extension))) {
				images.push(child);
			};
		};
	} catch (error) {
		warn('photos-directory-read', `Could not read photos from ${path}: ${error.message}`);
	} finally {
		enumerator?.close(null);
	};
};

function filePath(file) {
	return file?.get_path() ?? null;
};

function invalidatePicturePool() {
	picturePoolCache = {time: 0, pools: []};
};

function picturePools(force = false) {
	const now = Date.now();

	if (!force && now - picturePoolCache.time < PHOTO_CACHE_TTL_MS) {
		return picturePoolCache.pools;
	};

	const homeDir = GLib.get_home_dir();
	const picturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.build_filenamev([homeDir, 'Pictures']);
	const downloadsDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ?? GLib.build_filenamev([homeDir, 'Downloads']);
	const searchRoots = [
		GLib.build_filenamev([picturesDir, 'Camera']),
		GLib.build_filenamev([picturesDir, 'Screenshots']),
		downloadsDir,
	];

	picturePoolCache = {
		time: now,
		pools: searchRoots.map(root => {
			const images = [];

			collectPictures(Gio.File.new_for_path(root), images, new Set());
			images.sort((a, b) => a.get_path().localeCompare(b.get_path()));
			return images;
		}),
	};

	return picturePoolCache.pools;
};

function pickLocalPhotoFile(assignment) {
	const pools = picturePools();
	const currentPath = pictureAssignments.get(assignment) ?? null;
	const poolPaths = new Set(pools.flatMap(pool => pool.map(filePath)));
	const usedPaths = new Set([...pictureAssignments.entries()].filter(([key, path]) => key !== assignment && poolPaths.has(path)).map(([, path]) => path));
	let candidates = pools.flatMap(pool => pool.filter(file => {
		const path = filePath(file);

		return path !== currentPath && !usedPaths.has(path);
	}));

	if (candidates.length === 0) {
		candidates = pools.flatMap(pool => pool.filter(file => filePath(file) !== currentPath));
	};

	if (candidates.length === 0) {
		candidates = pools.flatMap(pool => pool);
	};

	if (candidates.length === 0) {
		pictureAssignments.delete(assignment);
		return null;
	};

	const selected = candidates[Math.floor(Math.random() * candidates.length)];
	pictureAssignments.set(assignment, filePath(selected));

	return selected;
};

function releasePictureFile(assignment, file) {
	if (pictureAssignments.get(assignment) === filePath(file)) {
		pictureAssignments.delete(assignment);
	};
};

function maybePruneCache(settings) {
	const now = Date.now();

	if (now - lastPruneTime < PRUNE_INTERVAL_MS) {
		return;
	};

	lastPruneTime = now;
	Immich.pruneCache(settings);
};

const PhotoFrame = GObject.registerClass(
	class PhotoFrame extends St.Widget {
		_init({assignment, settings = null}) {
			super._init({
				style_class: 'widget-photo',
				x_expand: true,
				y_expand: true,
				x_align: Clutter.ActorAlign.FILL,
				y_align: Clutter.ActorAlign.FILL,
			});

			this._assignment = assignment;
			this._settings = settings;
			this._bgUri = null;
			this._localFile = null;
			this._immichQueue = [];
			this._immichFetch = null;
			this._lastImmichId = null;
			this._generation = 0;
			this._destroyed = false;
			this._refreshTimeoutId = 0;
			this._settingsSignalIds = [];

			if (this._settings) {
				const handler = () => this._onSettingsChanged();

				for (const key of SETTINGS_KEYS) {
					this._settingsSignalIds.push(this._settings.connect(`changed::${key}`, handler));
				};
			};

			this._schedule();
			this._rotate();

			this.connect('destroy', this._onDestroy.bind(this));
		};

		_intervalSeconds() {
			if (!this._settings) {
				return DEFAULT_INTERVAL_SECONDS;
			};

			const value = this._settings.get_int('photo-interval');

			return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, value || DEFAULT_INTERVAL_SECONDS));
		};

		_source() {
			const value = this._settings?.get_string('photos-source') ?? 'local';

			return SOURCES.includes(value) ? value : 'mixed';
		};

		_immichSize() {
			const value = this._settings?.get_string('immich-size') ?? 'preview';

			return IMMICH_SIZES.includes(value) ? value : 'preview';
		};

		_schedule() {
			this._clearTimer();

			this._refreshTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._intervalSeconds(), () => {
				if (this._destroyed || !this.get_parent()) {
					this._refreshTimeoutId = 0;
					return GLib.SOURCE_REMOVE;
				};

				this._rotate();
				return GLib.SOURCE_CONTINUE;
			});
		};

		_clearTimer() {
			if (this._refreshTimeoutId) {
				GLib.Source.remove(this._refreshTimeoutId);
				this._refreshTimeoutId = 0;
			};
		};

		_setUri(uri) {
			if (!uri || uri === this._bgUri) {
				return;
			};

			this._bgUri = uri;
			this.set_style(`background-image: url(${JSON.stringify(uri)});`);
		};

		_rotate() {
			const source = this._source();

			if (source === 'local') {
				this._rotateLocal();
				return;
			};

			const generation = this._generation;

			this._showNextImmich(generation).then(shown => {
				if (this._destroyed || generation !== this._generation) {
					return;
				};

				if (!shown && (source === 'mixed' || !this._bgUri)) {
					this._rotateLocal();
				};
			});
		};

		_rotateLocal() {
			const file = pickLocalPhotoFile(this._assignment);

			if (!file) {
				return;
			};

			this._localFile = file;
			this._setUri(file.get_uri());
		};

		async _fetchImmichBatch(generation) {
			if (this._immichFetch) {
				return this._immichFetch;
			};

			maybePruneCache(this._settings);

			this._immichFetch = (async () => {
				try {
					const ids = await Immich.fetchRandomIds(this._settings, IMMICH_BATCH_SIZE);

					if (this._destroyed || generation !== this._generation) {
						return false;
					};

					const seen = new Set(this._immichQueue);

					for (const id of ids) {
						if (!seen.has(id) && id !== this._lastImmichId) {
							this._immichQueue.push(id);
							seen.add(id);
						};
					};

					return this._immichQueue.length > 0;
				} catch (error) {
					warn('photos-immich', `Could not fetch Immich photos: ${error.message}`);
					return false;
				} finally {
					this._immichFetch = null;
				};
			})();

			return this._immichFetch;
		};

		async _showNextImmich(generation) {
			for (let attempt = 0; attempt <= this._immichQueue.length; attempt++) {
				if (this._destroyed || generation !== this._generation) {
					return false;
				};

				if (this._immichQueue.length === 0) {
					const filled = await this._fetchImmichBatch(generation);

					if (this._destroyed || generation !== this._generation) {
						return false;
					};

					if (!filled || this._immichQueue.length === 0) {
						return false;
					};
				};

				const id = this._immichQueue.shift();

				try {
					const path = await Immich.ensureThumbnail(this._settings, id, this._immichSize());

					if (this._destroyed || generation !== this._generation) {
						return false;
					};

					this._lastImmichId = id;
					this._setUri(Gio.File.new_for_path(path).get_uri());

					if (this._immichQueue.length <= IMMICH_LOW_WATER) {
						this._fetchImmichBatch(generation);
					};

					return true;
				} catch (error) {
					warn('photos-immich', `Could not load Immich thumbnail: ${error.message}`);
				};
			};

			return false;
		};

		_onSettingsChanged() {
			this._generation += 1;
			this._immichQueue = [];
			this._immichFetch = null;
			this._schedule();
			this._rotate();
		};

		_onDestroy() {
			this._destroyed = true;
			this._generation += 1;
			releasePictureFile(this._assignment, this._localFile);

			for (const id of this._settingsSignalIds) {
				this._settings?.disconnect(id);
			};

			this._settingsSignalIds = [];
			this._clearTimer();
			this._localFile = null;
			this._bgUri = null;
			this.set_style(null);
		};
	}
);

export function style(theme) {
  return `border-radius: ${PHOTO_RADIUS}px; padding: 0px;`;
};

export function render({body, widget, settings = null}) {
	const assignment = {seed: widget.id};
	const frame = new PhotoFrame({assignment, settings});

	frame.set_x_expand(true);
	frame.set_y_expand(true);
	body.add_child(frame);
};

export function cleanup() {
	invalidatePicturePool();
	pictureAssignments.clear();
};
