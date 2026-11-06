import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * GNOME Shell keeps several useful containers behind private (underscore-prefixed)
 * properties. They have been stable across 45-51, but are not public API, so
 * every access goes through here with a best-effort fallback and a single place
 * to update when a future Shell version renames them.
 */

export function backgroundGroup() {
	if (Main.layoutManager._backgroundGroup) {
		return Main.layoutManager._backgroundGroup;
	};

	if (Main.layoutManager.backgroundGroup) {
		return Main.layoutManager.backgroundGroup;
	};

	return null;
};

export function overviewControls() {
	const overview = Main.overview;

	if (overview?._overview?.controls) {
		return overview._overview.controls;
	};

	if (overview?.controls) {
		return overview.controls;
	};

	return null;
};

export function workspaceBackgroundGroup(workspace) {
	const background = workspace?._background ?? workspace?.background;

	if (background?._backgroundGroup) {
		return background._backgroundGroup;
	};

	if (background?.backgroundGroup) {
		return background.backgroundGroup;
	};

	return null;
};

export function workspaceMonitor(workspaceBackground) {
	return workspaceBackground?._monitor ?? workspaceBackground?.monitor ?? null;
};