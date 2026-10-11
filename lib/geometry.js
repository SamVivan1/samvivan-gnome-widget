export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
};

export function snap(value, {gridSize = 20, snapToGrid = true} = {}) {
	return snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value);
};

export function sizeForWidget(widget, sizes) {
	const [defaultWidth, defaultHeight] = sizes[widget.size] ?? sizes.small;

	return [
		Number.isFinite(widget.width) ? widget.width : defaultWidth,
		Number.isFinite(widget.height) ? widget.height : defaultHeight,
	];
};

export function monitorWorkArea(monitor, {gap = 0, panelHeight = 0} = {}) {
	const top = panelHeight + gap;

	return {
		x: gap,
		y: top,
		width: Math.max(1, monitor.width - gap * 2),
		height: Math.max(1, monitor.height - top - gap),
	};
};

export function widgetFractions(widget, monitor, {gap = 0, panelHeight = 0, sizes} = {}) {
	const [width, height] = sizeForWidget(widget, sizes);
	const area = monitorWorkArea(monitor, {gap, panelHeight});
	const spanX = Math.max(1, area.width - width);
	const spanY = Math.max(1, area.height - height);

	return {
		fx: clamp((widget.x - area.x) / spanX, 0, 1),
		fy: clamp((widget.y - area.y) / spanY, 0, 1),
	};
};

export function positionForFractions(widget, monitor, {gap = 0, panelHeight = 0, sizes} = {}) {
	const [width, height] = sizeForWidget(widget, sizes);
	const area = monitorWorkArea(monitor, {gap, panelHeight});
	const spanX = Math.max(0, area.width - width);
	const spanY = Math.max(0, area.height - height);
	const fx = clamp(Number.isFinite(widget.fx) ? widget.fx : 0, 0, 1);
	const fy = clamp(Number.isFinite(widget.fy) ? widget.fy : 0, 0, 1);

	return {
		x: Math.round(area.x + fx * spanX),
		y: Math.round(area.y + fy * spanY),
	};
};

export function rectForWidget(widget, sizes) {
	const [width, height] = sizeForWidget(widget, sizes);

	return {
		x: widget.x,
		y: widget.y,
		width,
		height,
	};
};

export function rectsOverlap(a, b, gap = 0) {
	return a.x < b.x + b.width + gap &&
		a.x + a.width + gap > b.x &&
		a.y < b.y + b.height + gap &&
		a.y + a.height + gap > b.y;
};
