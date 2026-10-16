import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

/**
 * Shared HTTP helper for the shell process.
 *
 * Two guarantees the raw Soup pattern does not give us:
 * - responses are streamed with a hard size cap, so a malicious or broken
 *   server cannot OOM the compositor with one giant body;
 * - redirects are followed manually and only within the same origin, so
 *   Authorization / API-key headers are never delivered to a third party
 *   that the user did not configure.
 */

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const MAX_REDIRECTS = 3;
const CHUNK_BYTES = 64 * 1024;
const REDIRECT_STATUSES = new Set([
	Soup.Status.MOVED_PERMANENTLY,
	Soup.Status.FOUND,
	Soup.Status.SEE_OTHER,
	Soup.Status.TEMPORARY_REDIRECT,
	Soup.Status.PERMANENT_REDIRECT,
]);

function defaultPort(scheme) {
	return String(scheme ?? '').toLowerCase() === 'https' ? 443 : 80;
};

export function sameOrigin(first, second) {
	try {
		const a = GLib.Uri.parse(first, GLib.UriFlags.NONE);
		const b = GLib.Uri.parse(second, GLib.UriFlags.NONE);

		if (!a || !b) {
			return false;
		};

		const portA = a.get_port() === -1 ? defaultPort(a.get_scheme()) : a.get_port();
		const portB = b.get_port() === -1 ? defaultPort(b.get_scheme()) : b.get_port();

		return String(a.get_scheme() ?? '').toLowerCase() === String(b.get_scheme() ?? '').toLowerCase() &&
			String(a.get_host() ?? '').toLowerCase() === String(b.get_host() ?? '').toLowerCase() &&
			portA === portB;
	} catch {
		return false;
	};
};

function sendOnce(session, method, url, {headers, body, cancellable}) {
	return new Promise((resolve, reject) => {
		let message;

		try {
			message = Soup.Message.new(method, url);
		} catch (error) {
			reject(error);
			return;
		};

		if (!message) {
			reject(new Error(`invalid URL: ${url}`));
			return;
		};

		message.set_flags(Soup.MessageFlags.NO_REDIRECT);

		for (const [name, value] of Object.entries(headers ?? {})) {
			message.request_headers.append(name, value);
		};

		if (body) {
			message.set_request_body_from_bytes(body.contentType, new GLib.Bytes(body.bytes));
		};

		session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable ?? null, (sessionSelf, result) => {
			let stream;

			try {
				stream = sessionSelf.send_finish(result);
			} catch (error) {
				reject(error);
				return;
			};

			resolve({message, stream});
		});
	});
};

function readChunk(stream, cancellable) {
	return new Promise((resolve, reject) => {
		stream.read_bytes_async(CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable ?? null, (streamSelf, result) => {
			try {
				resolve(streamSelf.read_bytes_finish(result));
			} catch (error) {
				reject(error);
			};
		});
	});
};

async function readCapped(stream, maxBytes, cancellable) {
	const chunks = [];
	let total = 0;

	try {
		for (;;) {
			const bytes = await readChunk(stream, cancellable);

			if (bytes.get_size() === 0) {
				break;
			};

			total += bytes.get_size();

			if (total > maxBytes) {
				throw new Error(`response exceeds the ${maxBytes} byte size limit`);
			};

			chunks.push(bytes.get_data());
		};
	} finally {
		try {
			stream.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
		} catch {
			// best effort; the stream is garbage collected afterwards
		};
	};

	const merged = new Uint8Array(total);
	let offset = 0;

	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	};

	return new GLib.Bytes(merged);
};

/**
 * GET/POST over an existing Soup.Session with size cap and same-origin
 * redirect policy. Resolves {bytes, status, contentType, url} for any HTTP
 * response (including non-200); rejects on network errors, oversize bodies,
 * cross-origin redirects, or redirect loops.
 */
export async function fetchSameOrigin(session, method, url, options = {}) {
	const {headers, body, maxBytes = DEFAULT_MAX_BYTES, cancellable = null} = options;
	let current = url;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const {message, stream} = await sendOnce(session, method, current, {headers, body, cancellable});
		const bytes = await readCapped(stream, maxBytes, cancellable);
		const status = message.get_status();

		if (!REDIRECT_STATUSES.has(status)) {
			return {
				bytes,
				status,
				contentType: (message.get_response_headers().get_one('content-type') ?? '').split(';')[0].trim().toLowerCase(),
				url: current,
			};
		};

		const location = message.get_response_headers().get_one('location') ?? '';
		let next = '';

		try {
			next = GLib.Uri.resolve_relative(current, location, GLib.UriFlags.NONE);
		} catch {
			next = '';
		};

		if (!next || !sameOrigin(current, next)) {
			throw new Error(`redirect to a different origin was blocked (${status})`);
		};

		current = next;
	};

	throw new Error('too many redirects');
};
