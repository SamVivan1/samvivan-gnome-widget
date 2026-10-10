import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import { warn } from '../../logger.js';

const REQUEST_TIMEOUT_SECONDS = 20;
const CACHE_FOLDER = 'desktop-widget/immich';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 400;
const CONTENT_TYPE_EXTENSIONS = {
	'image/jpeg': '.jpg',
	'image/jpg': '.jpg',
	'image/webp': '.webp',
	'image/png': '.png',
	'image/gif': '.gif',
	'image/avif': '.avif',
	'image/bmp': '.bmp',
};
const CACHE_EXTENSIONS = [...new Set([...Object.values(CONTENT_TYPE_EXTENSIONS), '.img'])];

let session = null;

function soupSession() {
	if (!session) {
		session = new Soup.Session({
			timeout: REQUEST_TIMEOUT_SECONDS,
			user_agent: 'desktop-widget',
		});
	};

	return session;
};

function trimmed(value) {
	return (value ?? '').trim();
};

export function serverConfig(settings) {
	const baseUrl = trimmed(settings.get_string('immich-server-url')).replace(/\/+$/, '');
	const apiKey = trimmed(settings.get_string('immich-api-key'));

	return {
		baseUrl,
		apiKey,
		configured: baseUrl.length > 0 && apiKey.length > 0,
	};
};

function cacheDirectory(settings) {
	const {baseUrl} = serverConfig(settings);
	const digest = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, baseUrl || 'immich', -1);
	const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), CACHE_FOLDER, digest.slice(0, 16)]);

	GLib.mkdir_with_parents(dir, 0o700);
	return dir;
};

function request(method, url, apiKey, bodyText = null, accept = 'application/json') {
	return new Promise((resolve, reject) => {
		const message = Soup.Message.new(method, url);

		message.request_headers.append('x-api-key', apiKey);
		message.request_headers.append('accept', accept);

		if (bodyText !== null) {
			message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(bodyText)));
		};

		soupSession().send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (self, result) => {
			try {
				const bytes = self.send_and_read_finish(result);
				const status = message.get_status();

				if (status !== Soup.Status.OK) {
					reject(new Error(`Immich request failed with status ${status} (${url})`));
					return;
				};

				resolve({
					bytes,
					contentType: (message.get_response_headers().get_one('content-type') ?? '').split(';')[0].trim().toLowerCase(),
				});
			} catch (error) {
				reject(error);
			};
		});
	});
};

function parseJson(bytes) {
	return JSON.parse(new TextDecoder().decode(bytes.get_data()));
};

export async function fetchRandomIds(settings, count) {
	const {baseUrl, apiKey, configured} = serverConfig(settings);

	if (!configured) {
		throw new Error('Immich is not configured');
	};

	const scope = settings.get_string('immich-scope');
	const albumId = trimmed(settings.get_string('immich-album-id'));
	const body = {size: Math.max(1, count), type: 'IMAGE'};

	if (scope === 'favorites') {
		body.isFavorite = true;
	} else if (scope === 'album' && albumId.length > 0) {
		body.albumIds = [albumId];
	};

	const {bytes} = await request('POST', `${baseUrl}/api/search/random`, apiKey, JSON.stringify(body));
	const assets = parseJson(bytes);

	if (!Array.isArray(assets)) {
		return [];
	};

	return assets.map(asset => asset?.id).filter(id => typeof id === 'string' && id.length > 0);
};

export async function fetchAlbumChoices(settings) {
	const {baseUrl, apiKey, configured} = serverConfig(settings);

	if (!configured) {
		return [];
	};

	const {bytes} = await request('GET', `${baseUrl}/api/albums`, apiKey);
	const albums = parseJson(bytes);

	if (!Array.isArray(albums)) {
		return [];
	};

	return albums.map(album => ({
		id: album?.id ?? '',
		name: album?.albumName ?? 'Untitled album',
		count: album?.assetCount ?? 0,
	})).filter(album => album.id.length > 0);
};

function cachedPath(settings, id) {
	const dir = cacheDirectory(settings);

	for (const extension of CACHE_EXTENSIONS) {
		const candidate = GLib.build_filenamev([dir, `${id}${extension}`]);

		if (GLib.file_test(candidate, GLib.FileTest.IS_REGULAR)) {
			return candidate;
		};
	};

	return null;
};

export async function ensureThumbnail(settings, id, size) {
	const existing = cachedPath(settings, id);

	if (existing) {
		return existing;
	};

	const {baseUrl, apiKey} = serverConfig(settings);
	const url = `${baseUrl}/api/assets/${id}/thumbnail?size=${encodeURIComponent(size)}`;
	const {bytes, contentType} = await request('GET', url, apiKey, null, 'image/*');
	const data = bytes.get_data();

	if (!data || data.length === 0) {
		throw new Error(`Immich returned an empty thumbnail for ${id}`);
	};

	const extension = CONTENT_TYPE_EXTENSIONS[contentType] ?? '.img';
	const directory = cacheDirectory(settings);
	const target = GLib.build_filenamev([directory, `${id}${extension}`]);
	const temp = `${target}.${GLib.uuid_string_random()}.tmp`;

	if (!GLib.file_set_contents(temp, data)) {
		throw new Error(`Could not write Immich thumbnail for ${id}`);
	};

	try {
		Gio.File.new_for_path(temp).move(Gio.File.new_for_path(target), Gio.FileCopyFlags.OVERWRITE, null, null);
	} catch (error) {
		warn('photos-immich-cache', `Could not store Immich thumbnail: ${error.message}`);
	};

	return target;
};

export function pruneCache(settings, maxAgeMs = CACHE_MAX_AGE_MS, maxEntries = CACHE_MAX_ENTRIES) {
	const directory = Gio.File.new_for_path(cacheDirectory(settings));
	let enumerator = null;

	try {
		enumerator = directory.enumerate_children('standard::name,standard::type,time::modified', Gio.FileQueryInfoFlags.NONE, null);

		const entries = [];
		let info;

		while ((info = enumerator.next_file(null)) !== null) {
			if (info.get_file_type() !== Gio.FileType.REGULAR) {
				continue;
			};

			const name = info.get_name();

			if (!CACHE_EXTENSIONS.some(extension => name.endsWith(extension))) {
				continue;
			};

			entries.push({
				path: directory.get_child(name).get_path(),
				modified: info.get_attribute_uint64('time::modified') * 1000,
			});
		};

		enumerator.close(null);
		enumerator = null;

		const now = Date.now();

		for (const entry of entries) {
			if (maxAgeMs > 0 && now - entry.modified > maxAgeMs) {
				Gio.File.new_for_path(entry.path).delete(null);
			};
		};

		const remaining = entries
			.filter(entry => !(maxAgeMs > 0 && now - entry.modified > maxAgeMs))
			.sort((a, b) => a.modified - b.modified);

		for (let i = 0; i < remaining.length - maxEntries; i++) {
			Gio.File.new_for_path(remaining[i].path).delete(null);
		};
	} catch (error) {
		warn('photos-immich-cache', `Could not prune Immich cache: ${error.message}`);
	} finally {
		enumerator?.close(null);
	};
};
