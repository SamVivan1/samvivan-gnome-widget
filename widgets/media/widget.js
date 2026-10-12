import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
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

const LineProgress = GObject.registerClass(
	class LineProgress extends St.Widget {
		_init() {
			super._init({
				style_class: 'widget-media-progress',
				x_expand: true,
				layout_manager: new Clutter.BoxLayout({
					orientation: Clutter.Orientation.HORIZONTAL,
				}),
			});

			this._fill = new St.Widget({
				style_class: 'widget-media-progress-fill',
				y_expand: true,
			});

			this.add_child(this._fill);
			this._ratio = 0;

			this.connect('notify::allocation', () => this._sync());
		};

		setRatio(ratio) {
			const value = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;

			if (Math.abs(value - this._ratio) > 0.0005) {
				this._ratio = value;
				this._sync();
			};
		};

		_sync() {
			if (this.width <= 0) {
				return;
			};

			this._fill.set_width(Math.max(0, Math.round(this.width * this._ratio)));
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
			this._active = -1;
			this._signature = null;
			this._mode = 'empty';
			this._animate = true;

			this.connect('notify::allocation', () => this._reflow());
			this._inner.connect('notify::allocation', () => this._reflow());
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
			this._active = -1;
		};

		_label(text, styleClass) {
			const label = new St.Label({
				text,
				style_class: styleClass,
				x_expand: true,
				x_align: Clutter.ActorAlign.FILL,
			});

			label.clutter_text.line_wrap = true;
			label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
			label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

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
			if (this._offsets) {
				return;
			};

			const last = this._labels[this._labels.length - 1];
			const lastBox = last ? last.get_allocation_box() : null;
			const allocated = lastBox && lastBox.y2 - lastBox.y1 > 0;

			if (allocated) {
				this._offsets = this._labels.map(label => label.get_allocation_box().y1);
				return;
			};

			const width = this._inner.width > 0 ? this._inner.width : (this.width > 0 ? this.width : 300);
			let acc = 0;

			this._offsets = this._labels.map(label => {
				const offset = acc;

				acc += label.get_preferred_height(width)[1];
				return offset;
			});
		};

		_apply(index, animate) {
			const viewHeight = this.height;

			if (viewHeight <= 0 || this._labels.length === 0) {
				return;
			};

			this._offsets = null;
			this._ensureOffsets();

			const label = this._labels[index];
			const box = label ? label.get_allocation_box() : null;
			const height = box && box.y2 - box.y1 > 0
				? box.y2 - box.y1
				: (label?.get_preferred_height(this._inner.width || this.width || 300)[1] ?? 0);
			const start = this._offsets[index] ?? 0;
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

			this._progress = new LineProgress();
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
