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

		new Setting(containerEl)
			.setName('Create Reciprocal Links')
			.setDesc('Automatically creates the corresponding link back to your current note, when adding a sequential link to another note.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.reciprocalLinks)
					.onChange(async (value) => {
						this.plugin.settings.reciprocalLinks = value;
						await this.plugin.saveSettings();
						this.display()
					})
			);
		new Setting(containerEl)
			.setName('Show Sibling Notes Only')
			.setDesc('Only suggest notes in the same folder when adding sequential links.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.onlySiblingFiles)
					.onChange(async (value) => {
						this.plugin.settings.onlySiblingFiles = value;
						await this.plugin.saveSettings();
						this.display()
					})
			);

	}
}
