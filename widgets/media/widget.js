import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { activeLyricIndex } from '../../lib/lyrics.js';

export const type = 'media';
export const label = 'Music';
export const stylesheet = 'widgets/media/stylesheet.css';
export const defaultSize = 'medium';
export const defaultInLayout = false;

const ACTIVE_TICK_MS = 100;
const IDLE_TICK_MS = 500;
const BAR_SEEDS = [0.7, 2.1, 4.3, 1.9, 3.4, 0.4, 2.8, 5.1, 3.7, 1.2, 4.8, 2.4, 0.9, 3.1, 5.5, 1.7];

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

const BarVisualizer = GObject.registerClass(
	class BarVisualizer extends St.DrawingArea {
		_init(color) {
			super._init({
				style_class: 'widget-media-visualizer',
				x_expand: true,
			});

			this._rgb = hexToRgb(color);
			this._playing = false;
			this._animate = true;
		};

		setPlaying(playing) {
			this._playing = playing === true;
		};

		setAnimate(animate) {
			this._animate = animate !== false;
		};

		vfunc_repaint() {
			const cr = this.get_context();
			const [width, height] = this.get_surface_size();

			if (width <= 0 || height <= 0) {
				cr.$dispose();
				return;
			};

			const now = this._animate ? GLib.get_monotonic_time() / 1000000 : 0;
			const count = BAR_SEEDS.length;
			const gap = width / count;
			const barWidth = Math.max(2, gap * 0.45);

			cr.setLineCap(1);

			for (let i = 0; i < count; i++) {
				let level = 0.12;

				if (this._playing && this._animate) {
					const seed = BAR_SEEDS[i];
					const wave = 0.5 + 0.5 * Math.sin(now * (2.6 + seed * 0.4) + seed * 2.3);
					const jitter = 0.5 + 0.5 * Math.sin(now * 7.1 + seed * 5.7);
					level = 0.18 + 0.7 * wave * (0.6 + 0.4 * jitter);
				};

				const barHeight = Math.max(3, level * height);
				const x = gap * i + gap * 0.5 - barWidth * 0.5;
				const y = (height - barHeight) / 2;

				cr.setSourceRGBA(this._rgb[0], this._rgb[1], this._rgb[2], this._playing ? 0.85 : 0.35);
				cr.newPath();
				cr.rectangle(x, y, barWidth, barHeight);
				cr.fill();
			};

			cr.$dispose();
		};
	});

const LineProgress = GObject.registerClass(
	class LineProgress extends St.DrawingArea {
		_init(color, theme) {
			super._init({
				style_class: 'widget-media-progress',
				x_expand: true,
			});

			this._rgb = hexToRgb(color);
			this._theme = theme;
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
			this._playing = false;
			this._line = -1;
			this._lyricTransitioning = false;

			const accent = theme?.accent || '#3584e4';

			const main = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media-main',
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
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
			main.add_child(this._artWrap);

			const info = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media-info',
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
			});

			this._title = createLabel('', 'widget-media-title', `color: ${theme.text};`);
			this._artist = createLabel('', 'widget-media-artist', `color: ${theme.muted};`);
			this._title.x_align = Clutter.ActorAlign.CENTER;
			this._artist.x_align = Clutter.ActorAlign.CENTER;

			info.add_child(this._title);
			info.add_child(this._artist);
			main.add_child(info);

			const lyricArea = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media-lyric-area',
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
				y_expand: true,
				y_align: Clutter.ActorAlign.CENTER,
			});

			this._visualizer = new BarVisualizer(accent);
			this._visualizer.setAnimate(this._animate);
			this._visualizer.style_class = 'widget-media-visualizer-bg';
			lyricArea.add_child(this._visualizer);

			this._lyricOverlay = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				style_class: 'widget-media-lyric-overlay',
				x_expand: true,
				y_align: Clutter.ActorAlign.CENTER,
			});

			this._lyric = createLabel('', 'widget-media-lyric', `color: ${theme.text};`);
			this._lyricNext = createLabel('', 'widget-media-lyric-next', `color: ${theme.muted};`);
			this._lyric.x_align = Clutter.ActorAlign.CENTER;
			this._lyricNext.x_align = Clutter.ActorAlign.CENTER;
			this._lyric.style_class = 'widget-media-lyric-main';
			this._lyricNext.style_class = 'widget-media-lyric-sub';

			this._lyricOverlay.add_child(this._lyric);
			this._lyricOverlay.add_child(this._lyricNext);
			lyricArea.add_child(this._lyricOverlay);

			this._progress = new LineProgress(accent, theme);
			this._progress.style_class = 'widget-media-progress';
			lyricArea.add_child(this._progress);

			main.add_child(lyricArea);
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

				this.update();
				this._visualizer?.queue_repaint();
				this._scheduleTick();
				return GLib.SOURCE_REMOVE;
			});
		};

		_crossfadeLyric(newText, isNext = false) {
			if (this._lyricTransitioning) return;

			const target = isNext ? this._lyricNext : this._lyric;
			const other = isNext ? this._lyric : this._lyricNext;

			if (target.text === newText) return;

			this._lyricTransitioning = true;

			const fadeOut = new Clutter.Animation({
				duration: 200,
				easing: Clutter.AnimationMode.EASE_OUT_QUAD,
				target: target,
				from_alpha: 255,
				to_alpha: 0,
			});

			fadeOut.connect('completed', () => {
				target.text = newText;
				const fadeIn = new Clutter.Animation({
					duration: 250,
					easing: Clutter.AnimationMode.EASE_OUT_QUAD,
					target: target,
					from_alpha: 0,
					to_alpha: 255,
				});
				fadeIn.connect('completed', () => {
					this._lyricTransitioning = false;
				});
				fadeIn.start();
			});
			fadeOut.start();
		};

		update() {
			const view = this._media?.view;

			if (!view) {
				this._title.text = 'Music';
				this._artist.text = 'No media player detected';
				this._setLyrics('', '');
				this._hint.hide();
				this._progress.hide();
				return;
			};

			this._playing = view.playback === 'Playing';
			this._visualizer.setPlaying(this._playing);

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
				this._lyricOverlay.hide();
				this._progress.hide();
				return;
			};

			this._lyricOverlay.show();
			this._progress.show();

			const lyrics = view.lyrics ?? {};

			if (!view.available || !view.title) {
				this._crossfadeLyric('', false);
				this._crossfadeLyric('', true);
				return;
			};

			if (lyrics.status === 'loading') {
				this._crossfadeLyric('…', false);
				this._crossfadeLyric('', true);
				return;
			};

			if (lyrics.status === 'instrumental') {
				this._crossfadeLyric('♪ Instrumental', false);
				this._crossfadeLyric('', true);
				return;
			};

			const lines = lyrics.synced ?? [];

			if (lines.length > 0) {
				const position = view.positionUs / 1000000 + this._offsetSeconds();
				const index = activeLyricIndex(lines, Math.max(0, position));
				const current = index >= 0 ? lines[index]?.text ?? '' : '';
				const next = index + 1 < lines.length ? lines[index + 1]?.text ?? '' : '';

				this._crossfadeLyric(current, false);
				this._crossfadeLyric(next, true);
				return;
			};

			if (lyrics.plainText) {
				this._crossfadeLyric('No synced lyrics', false);
				this._crossfadeLyric('', true);
				return;
			};

			this._crossfadeLyric('No lyrics found', false);
			this._crossfadeLyric('', true);
		};

		_setLyrics(current, next) {
			if (current !== this._lyric.text) {
				this._crossfadeLyric(current, false);
			};
			if (next !== this._lyricNext.text) {
				this._crossfadeLyric(next, true);
			};
		};

		_updateArt(artUrl) {
			const key = artUrl || '';

			if (key === this._artKey) {
				return;
			};

			this._artKey = key;

			let gicon = null;

			try {
				if (key.startsWith('file://')) {
					gicon = Gio.icon_new_for_string(GLib.filename_from_uri(key)[0]);
				} else if (key.startsWith('/')) {
					gicon = Gio.icon_new_for_string(key);
				};
			} catch {
				gicon = null;
			};

			if (gicon) {
				this._artIcon.gicon = gicon;
			} else {
				this._artIcon.gicon = null;
				this._artIcon.icon_name = 'audio-x-generic-symbolic';
			};
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
