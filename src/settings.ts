import { App, PluginSettingTab, Setting } from "obsidian";
import SequentialNoteNavigator from "./main";

export interface SequencerSettings {
	reciprocalLinks: boolean;
	onlySiblingFiles: boolean;
}

export const DEFAULT_SETTINGS: SequencerSettings = {
	reciprocalLinks: true,
	onlySiblingFiles: true
}

export class SequencerSettingTab extends PluginSettingTab {
	plugin: SequentialNoteNavigator;

	constructor(app: App, plugin: SequentialNoteNavigator) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();
	}
}
