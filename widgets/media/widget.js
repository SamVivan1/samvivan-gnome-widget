import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';

import { activeLyricIndex } from '../../lib/lyrics.js';
import { warn } from '../../logger.js';

export const type = 'media';
export const label = 'Music';
export const stylesheet = 'widgets/media/stylesheet.css';
export const defaultSize = 'medium';
export const defaultInLayout = false;

const ACTIVE_TICK_MS = 100;
const IDLE_TICK_MS = 500;
const LYRIC_SCROLL_MS = 380;

function hexToRgb(hex) {
	const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());

	if (!match) {
		return [0.21, 0.52, 0.89];
	};

	const value = parseInt(match[1], 16);

	return [
		((value >> 16) & 0xff) / 255,
		((value >> 8) & 0xff) / 255,
		(value & 0xff) / 255,
	];
};

const LineProgress = GObject.registerClass(
	class LineProgress extends St.DrawingArea {
		_init(color) {
			super._init({
				style_class: 'widget-media-progress',
				x_expand: true,
			});

			this._rgb = hexToRgb(color);
			this._ratio = 0;
		};

		setRatio(ratio) {
			const value = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;

			if (Math.abs(value - this._ratio) > 0.001) {
				this._ratio = value;
				this.queue_repaint();
			};
		};

		vfunc_repaint() {
			const cr = this.get_context();
			const [width, height] = this.get_surface_size();

			if (width <= 0 || height <= 0) {
				cr.$dispose();
				return;
			};

			const radius = height / 2;

			cr.setSourceRGBA(1, 1, 1, 0.16);
			cr.newPath();
			cr.arc(radius, radius, radius, 0, Math.PI * 2);
			cr.arc(width - radius, radius, radius, 0, Math.PI * 2);
			cr.rectangle(radius, 0, width - 2 * radius, height);
			cr.fill();

			if (this._ratio > 0) {
				const filled = Math.max(height, width * this._ratio);

				cr.setSourceRGBA(this._rgb[0], this._rgb[1], this._rgb[2], 1);
				cr.newPath();
				cr.arc(radius, radius, radius, 0, Math.PI * 2);
				cr.arc(Math.max(radius, filled - radius), radius, radius, 0, Math.PI * 2);
				cr.rectangle(radius, 0, Math.max(0, filled - 2 * radius), height);
				cr.fill();
			};

			cr.$dispose();
		};
	});

const LyricView = GObject.registerClass(
	class LyricView extends St.Widget {
		_init() {
			super._init({
				style_class: 'widget-media-lyrics',
				clip_to_allocation: true,
				layout_manager: new Clutter.BinLayout(),
				x_expand: true,
				y_expand: true,
			});

			this._inner = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media-lyric-inner',
				x_expand: true,
				x_align: Clutter.ActorAlign.FILL,
				y_align: Clutter.ActorAlign.START,
			});

			this.add_child(this._inner);

			this._labels = [];
			this._offsets = null;
			this._measureWidth = -1;
			this._active = -1;
			this._signature = null;
			this._mode = 'empty';
			this._animate = true;

			this.connect('notify::height', () => this._reflow());
		};

		setAnimate(animate) {
			this._animate = animate !== false;
		};

		_reset() {
			this._inner.remove_all_transitions();
			this._inner.translation_y = 0;
			this._inner.destroy_all_children();
			this._labels = [];
			this._offsets = null;
			this._measureWidth = -1;
			this._active = -1;
		};

		_label(text, styleClass) {
			const label = new St.Label({
				text,
				style_class: styleClass,
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
			});

			label.clutter_text.line_wrap = true;

			return label;
		};

		setMessage(text) {
			if (this._mode === 'message' && this._message === text) {
				return;
			};

			this._reset();
			this._mode = 'message';
			this._message = text;
			this._inner.y_align = Clutter.ActorAlign.CENTER;

			if (text) {
				this._inner.add_child(this._label(text, 'widget-media-lyric-message'));
			};
		};

		setPlain(text) {
			if (this._mode === 'plain' && this._plain === text) {
				return;
			};

			this._reset();
			this._mode = 'plain';
			this._plain = text;
			this._inner.y_align = Clutter.ActorAlign.START;

			if (text) {
				this._inner.add_child(this._label(text, 'widget-media-lyric-plain'));
			};
		};

		setSynced(lines, signature) {
			if (this._mode === 'synced' && this._signature === signature) {
				return;
			};

			this._reset();
			this._mode = 'synced';
			this._signature = signature;
			this._inner.y_align = Clutter.ActorAlign.START;

			for (const line of lines) {
				this._inner.add_child(this._label(line?.text ?? '', 'widget-media-lyric-line'));
			};

			this._labels = this._inner.get_children();
		};

		setActive(index) {
			if (this._mode !== 'synced' || index === this._active) {
				return;
			};

			this._active = index;
			this._apply(index, true);
		};

		_ensureOffsets() {
			const width = this._measureWidth > 0 ? this._measureWidth : 300;

			if (this._offsets) {
				return;
			};

			let acc = 0;

			this._offsets = this._labels.map(label => {
				const offset = acc;
				acc += label.get_preferred_height(width)[1];
				return offset;
			});

			this._total = acc;
		};

		_apply(index, animate) {
			const viewHeight = this.height;

			if (viewHeight <= 0 || this._labels.length === 0) {
				return;
			};

			this._measureWidth = this.width || this._measureWidth;
			this._offsets = null;
			this._ensureOffsets();

			const start = this._offsets[index] ?? 0;
			const height = this._labels[index]?.get_preferred_height(this._measureWidth)[1] ?? 0;
			const target = Math.round(viewHeight / 2 - (start + height / 2));

			this._inner.remove_all_transitions();

			if (animate && this._animate) {
				this._inner.ease({
					translation_y: target,
					duration: LYRIC_SCROLL_MS,
					mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
				});
			} else {
				this._inner.translation_y = target;
			};

			this._labels.forEach((label, i) => {
				const isActive = i === index;

				label.opacity = isActive ? 255 : 110;

				if (isActive) {
					label.add_style_class_name('widget-media-lyric-line-active');
				} else {
					label.remove_style_class_name('widget-media-lyric-line-active');
				};
			});
		};

		_reflow() {
			if (this._mode === 'synced' && this._active >= 0) {
				this._apply(this._active, false);
			};
		};

		vfunc_get_preferred_height(forWidth) {
			return [0, 0];
		};
	});

const MediaView = GObject.registerClass(
	class MediaView extends St.BoxLayout {
		_init({createLabel, theme, settings, media, animate}) {
			super._init({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media',
				x_expand: true,
				y_expand: true,
			});

			this._createLabel = createLabel;
			this._theme = theme;
			this._settings = settings;
			this._media = media;
			this._animate = animate !== false;
			this._timerId = 0;
			this._artKey = null;
			this._artSeq = 0;
			this._artSession = null;
			this._playing = false;

			const accent = theme?.accent || '#3584e4';

			const main = new St.BoxLayout({
				orientation: Clutter.Orientation.HORIZONTAL,
				style_class: 'widget-media-main',
				x_expand: true,
				y_expand: true,
			});

			const left = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media-left',
				y_align: Clutter.ActorAlign.CENTER,
			});

			this._artWrap = new St.Bin({
				style_class: 'widget-media-art',
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.CENTER,
			});
			this._artIcon = new St.Icon({
				icon_name: 'audio-x-generic-symbolic',
				style_class: 'widget-media-art-icon',
			});
			this._artWrap.set_child(this._artIcon);
			left.add_child(this._artWrap);

			this._title = createLabel('', 'widget-media-title', `color: ${theme.text};`);
			this._artist = createLabel('', 'widget-media-artist', `color: ${theme.muted};`);
			this._title.x_align = Clutter.ActorAlign.CENTER;
			this._artist.x_align = Clutter.ActorAlign.CENTER;

			left.add_child(this._title);
			left.add_child(this._artist);

			this._progress = new LineProgress(accent);
			left.add_child(this._progress);

			this._lyricView = new LyricView();
			this._lyricView.setAnimate(this._animate);

			main.add_child(left);
			main.add_child(this._lyricView);
			this.add_child(main);

			this.update();
			this._scheduleTick();

			this.connect('destroy', () => {
				if (this._timerId) {
					GLib.source_remove(this._timerId);
					this._timerId = 0;
				};
			});
		};

		_showLyrics() {
			try {
				return this._settings?.get_boolean('media-show-lyrics') !== false;
			} catch {
				return true;
			};
		};

		_offsetSeconds() {
			try {
				return (this._settings?.get_int('media-lyrics-offset-ms') ?? 0) / 1000;
			} catch {
				return 0;
			};
		};

		_scheduleTick() {
			const delay = (this._playing && this._animate) ? ACTIVE_TICK_MS : IDLE_TICK_MS;

			this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
				this._timerId = 0;

				if (!this.get_parent()) {
					return GLib.SOURCE_REMOVE;
				};

				try {
					this.update();
					this._scheduleTick();
				} catch (error) {
					warn('media-tick', `Media update failed: ${error.message}`);
					this._scheduleTick();
				};

				return GLib.SOURCE_REMOVE;
			});
		};

		update() {
			const view = this._media?.view;

			if (!view) {
				this._title.text = 'Music';
				this._artist.text = 'No media player detected';
				this._lyricView.setMessage('No media player detected');
				this._progress.hide();
				return;
			};

			this._playing = view.playback === 'Playing';

			this._title.text = view.title || (view.available ? 'Unknown track' : 'Nothing playing');
			this._artist.text = view.artist || 'Unknown artist';
			this._updateArt(view.artUrl);

			this._progress.show();

			if (view.lengthUs > 0) {
				this._progress.setRatio(view.positionUs / view.lengthUs);
			} else {
				this._progress.setRatio(0);
			};

			this._updateLyrics(view);
		};

		_updateLyrics(view) {
			if (!this._showLyrics()) {
				this._lyricView.setMessage('');
				return;
			};

			const lyrics = view.lyrics ?? {};

			if (!view.available) {
				this._lyricView.setMessage('No media player detected');
				return;
			};

			if (!view.title) {
				this._lyricView.setMessage('Nothing playing');
				return;
			};

			if (lyrics.status === 'loading') {
				this._lyricView.setMessage('…');
				return;
			};

			if (lyrics.status === 'instrumental') {
				this._lyricView.setMessage('♪ Instrumental');
				return;
			};

			const lines = lyrics.synced ?? [];

			if (lines.length > 0) {
				const signature = `${view.title}|${view.artist}|${lines.length}`;

				this._lyricView.setSynced(lines, signature);

				const position = view.positionUs / 1000000 + this._offsetSeconds();
				const index = activeLyricIndex(lines, Math.max(0, position));

				this._lyricView.setActive(Math.max(0, index));
				return;
			};

			const plain = String(lyrics.plainText ?? '').trim();

			if (plain) {
				const preview = plain.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12).join('\n');
				this._lyricView.setPlain(preview);
				return;
			};

			this._lyricView.setMessage('No lyrics found');
		};

		_updateArt(artUrl) {
			const key = artUrl || '';

			if (key === this._artKey) {
				return;
			};

			this._artKey = key;

			if (!key) {
				this._clearArt();
				return;
			};

			if (key.startsWith('file://')) {
				this._setArt(GLib.filename_from_uri(key)[0]);
				return;
			};

			if (key.startsWith('/')) {
				this._setArt(key);
				return;
			};

			if (key.startsWith('http://') || key.startsWith('https://')) {
				this._loadRemoteArt(key);
				return;
			};

			this._clearArt();
		};

		_setArt(path) {
			if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
				this._clearArt();
				return;
			};

			const uri = GLib.filename_to_uri(path, null);
			const file = Gio.File.new_for_path(path);

			this._artIcon.gicon = new Gio.FileIcon({file});
			this._artIcon.icon_name = null;
			this._artIcon.visible = true;
			this._artWrap.style = `background-image: url(${JSON.stringify(uri)});`;
		};

		_clearArt() {
			this._artIcon.gicon = null;
			this._artIcon.icon_name = 'audio-x-generic-symbolic';
			this._artIcon.visible = true;
			this._artWrap.style = '';
		};

		_artCachePath(uri) {
			const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'desktop-widget', 'art']);
			const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, uri, -1);

			return GLib.build_filenamev([dir, name]);
		};

		_loadRemoteArt(uri) {
			const seq = ++this._artSeq;
			const path = this._artCachePath(uri);

			if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
				this._setArt(path);
				return;
			};

			this._artSession = this._artSession ?? new Soup.Session({timeout: 20});

			let message;

			try {
				message = Soup.Message.new('GET', uri);
			} catch {
				return;
			};

			if (!message) {
				return;
			};

			this._artSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
				if (seq !== this._artSeq || !message || message.is_finalized?.()) {
					return;
				};

				if (message.get_status() !== Soup.Status.OK) {
					return;
				};

				let bytes;

				try {
					bytes = session.send_and_read_finish(result);
				} catch {
					return;
				};

				try {
					GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);

					if (!GLib.file_set_contents(path, bytes.get_data())) {
						return;
					};

					this._setArt(path);
				} catch (error) {
					warn('media-art-cache', `Could not cache cover art: ${error.message}`);
				};
			});
		};
	});

function buildView(params) {
	const view = new MediaView(params);

	params.body.add_child(view);

	return view;
};

export function render(params) {
	params.body._mediaView = buildView(params);
};

export function reconcile(params) {
	if (params.body._mediaView) {
		params.body._mediaView.update();
		return;
	};

	params.body.destroy_all_children();
	render(params);
};
