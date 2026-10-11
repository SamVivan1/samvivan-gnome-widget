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

			const accent = theme?.accent || '#3584e4';

			const main = new St.BoxLayout({
				orientation: Clutter.Orientation.HORIZONTAL,
				style_class: 'widget-media-main',
				x_expand: true,
				y_expand: true,
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
				y_align: Clutter.ActorAlign.CENTER,
			});

			this._title = createLabel('', 'widget-media-title', `color: ${theme.text};`);
			this._artist = createLabel('', 'widget-media-artist', `color: ${theme.muted};`);
			this._visualizer = new BarVisualizer(accent);
			this._visualizer.setAnimate(this._animate);
			this._progress = new LineProgress(accent, theme);

			info.add_child(this._title);
			info.add_child(this._artist);
			info.add_child(this._visualizer);
			info.add_child(this._progress);

			this._lyricRow = new St.BoxLayout({
				orientation: Clutter.Orientation.VERTICAL,
				x_expand: true,
			});
			this._lyric = createLabel('', 'widget-media-lyric', `color: ${theme.text};`);
			this._lyricNext = createLabel('', 'widget-media-lyric-next', `color: ${theme.muted};`);
			this._lyric.x_align = Clutter.ActorAlign.CENTER;
			this._lyricNext.x_align = Clutter.ActorAlign.CENTER;
			this._lyricRow.add_child(this._lyric);
			this._lyricRow.add_child(this._lyricNext);
			info.add_child(this._lyricRow);

			this._hint = createLabel('', 'widget-media-hint', `color: ${theme.muted};`);
			this._hint.x_align = Clutter.ActorAlign.CENTER;
			info.add_child(this._hint);

			main.add_child(info);
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
				this._lyricRow.hide();
				this._hint.hide();
				return;
			};

			const lyrics = view.lyrics ?? {};

			if (!view.available || !view.title) {
				this._lyricRow.hide();
				this._hint.hide();
				return;
			};

			if (lyrics.status === 'loading') {
				this._setLyrics('…', '');
				this._hint.hide();
				return;
			};

			if (lyrics.status === 'instrumental') {
				this._lyricRow.hide();
				this._hint.text = 'Instrumental';
				this._hint.show();
				return;
			};

			const lines = lyrics.synced ?? [];

			if (lines.length > 0) {
				const position = view.positionUs / 1000000 + this._offsetSeconds();
				const index = activeLyricIndex(lines, Math.max(0, position));
				const current = index >= 0 ? lines[index]?.text ?? '' : '';
				const next = index + 1 < lines.length ? lines[index + 1]?.text ?? '' : '';

				this._setLyrics(current, next);
				this._hint.hide();
				return;
			};

			if (lyrics.plainText) {
				this._lyricRow.hide();
				this._hint.text = 'No synced lyrics';
				this._hint.show();
				return;
			};

			this._setLyrics('', '');
			this._hint.text = 'No lyrics found';
			this._hint.show();
		};

		_setLyrics(current, next) {
			this._lyricRow.show();

			if (current !== this._lyric.text) {
				this._lyric.text = current;
			};

			this._lyricNext.text = next;
			this._lyricNext.visible = next.length > 0;
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
