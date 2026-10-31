import { App, PluginSettingTab, Setting } from "obsidian";
import SequentialNoteNavigator from "./main";
import { parseInverseRelations } from "./relations";

export interface SequencerSettings {
	reciprocalLinks: boolean;
	inverseRelations: string;
	onlySiblingFiles: boolean;
	repairSequenceOnDelete: boolean;
	confirmSequenceDelete: boolean;
}

export const DEFAULT_SETTINGS: SequencerSettings = {
	reciprocalLinks: true,
	inverseRelations: 'next: prev\nsucc: pred',
	onlySiblingFiles: true,
	repairSequenceOnDelete: true,
	confirmSequenceDelete: true
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
			.setName('Inverse relations')
			.setHeading();

		new Setting(containerEl)
			.setName('Automatically sync inverse properties')
			.setDesc('Automatically sync inverse properties when editing note properties. Sequence commands always preserve both links, even when this is off.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.reciprocalLinks)
					.onChange(async (value) => {
						this.plugin.settings.reciprocalLinks = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Property pairs')
			.setDesc('Enter one forward: inverse pair per line, for example next: prev and succ: pred. When automatic syncing is enabled, editing either property syncs its inverse. No multi-hop relationships are inferred.')
			.addTextArea((text) => {
				const field = document.createElement('div');
				text.inputEl.replaceWith(field);
				field.appendChild(text.inputEl);
				const error = field.createDiv({
					attr: { id: 'sequencer-inverse-relations-error', role: 'alert' }
				});
				error.hidden = true;
				text.inputEl.rows = 4;
				text.inputEl.setAttribute('aria-label', 'Inverse relations');
				text.inputEl.setAttribute('aria-describedby', error.id);
				text.inputEl.setAttribute('aria-invalid', 'false');
				text.setValue(this.plugin.settings.inverseRelations)
					.onChange(async (value) => {
						try {
							parseInverseRelations(value);
						} catch (cause) {
							error.textContent = cause instanceof Error ? cause.message : 'Invalid inverse relations.';
							error.hidden = false;
							text.inputEl.setAttribute('aria-invalid', 'true');
							return;
						}
						error.textContent = '';
						error.hidden = true;
						text.inputEl.setAttribute('aria-invalid', 'false');
						if (value === this.plugin.settings.inverseRelations) return;
						this.plugin.settings.inverseRelations = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName('Sequences')
			.setHeading();

		new Setting(containerEl)
			.setName('Only show sibling notes')
			.setDesc('Only suggest notes in the same folder when adding sequential links.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.onlySiblingFiles)
					.onChange(async (value) => {
						this.plugin.settings.onlySiblingFiles = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Repair sequences when deleting notes')
			.setDesc('When a note in a sequence is deleted, reconnect the previous and next notes automatically.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.repairSequenceOnDelete)
					.onChange(async (value) => {
						this.plugin.settings.repairSequenceOnDelete = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName('Confirm sequence note deletion')
			.setDesc('Ask before the sequencer delete command removes a note and reconnects the sequence.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.confirmSequenceDelete)
					.onChange(async (value) => {
						this.plugin.settings.confirmSequenceDelete = value;
						await this.plugin.saveSettings();
					})
			);

	}
}
