import { App, FuzzySuggestModal, Modal, normalizePath, Notice, Setting, TFile } from "obsidian";
import { SequencerSettings } from "./settings";

type Suggestion = {
	type: "unresolved";
	linktext: string;
} | {
	type: "file";
	file: TFile;
	linktext: string;
};

type ChooseFileCallback = (file: TFile) => Promise<void>;

export class InsertSequenceNoteModal extends FuzzySuggestModal<Suggestion> {
	private suggestions: Suggestion[] = [];

	constructor(
		app: App,
		private settings: SequencerSettings,
		private currentFile: TFile,
		private position: "before" | "after",
		private onChooseFile: ChooseFileCallback,
	) {
		super(app);
		this.setPlaceholder(`Choose note to insert ${position} ${currentFile.basename}`);
	}

	async onOpen() {
		const files = this.app.vault.getMarkdownFiles();
		const fileSuggestions: Suggestion[] = files
			.filter((file) => file.path !== this.currentFile.path)
			.filter((file) => !this.settings.onlySiblingFiles || file.parent?.path === this.currentFile.parent?.path)
			.map((file) => ({
				type: "file",
				file,
				linktext: file.basename,
			}));

		const unresolvedLinks = new Set<string>();
		const allLinks = this.app.metadataCache.unresolvedLinks;

		for (const links of Object.values(allLinks)) {
			for (const link of Object.keys(links)) {
				if (!files.some(f => f.basename === link)) {
					unresolvedLinks.add(link);
				}
			}
		}

		const unresolvedSuggestions: Suggestion[] = Array.from(unresolvedLinks).map((link) => ({
			type: "unresolved",
			linktext: link,
		}));

		this.suggestions = [...fileSuggestions, ...unresolvedSuggestions];
		await super.onOpen();
	}

	getItems(): Suggestion[] {
		const out: Suggestion[] = [...this.suggestions];
		if (this.inputEl.value && !out.some(s => s.linktext === this.inputEl.value)) {
			out.push({
				type: "unresolved",
				linktext: this.inputEl.value
			});
		}
		return out;
	}

	getItemText(item: Suggestion): string {
		return item.linktext;
	}

	onChooseItem(item: Suggestion): void {
		void (async () => {
			let targetFile: TFile;

			if (item.type === "file" && item.file) {
				targetFile = item.file;
			} else {
				const filename = item.linktext.endsWith(".md") ? item.linktext : `${item.linktext}.md`;
				const folderPath = this.currentFile.parent?.path ?? "";
				const path = normalizePath(folderPath ? `${folderPath}/${filename}` : filename);
				targetFile = await this.app.vault.create(path, "");
			}

			await this.onChooseFile(targetFile);
		})().catch((error: unknown) => {
			console.error("Sequence insertion failed", error);
			new Notice(`Sequence insertion failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	}
}

export class ConfirmSequenceDeleteModal extends Modal {
	private dontAskAgain = false;

	constructor(
		app: App,
		private file: TFile,
		private onConfirm: (dontAskAgain: boolean) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Delete sequence note?");
		contentEl.empty();
		contentEl.createEl("p", {
			text: `Delete "${this.file.basename}" and reconnect its previous and next notes?`,
		});

		new Setting(contentEl)
			.setName("Don't ask again")
			.setDesc("Sequencer will still reconnect the sequence when using this command.")
			.addToggle((toggle) => {
				toggle.onChange((value) => {
					this.dontAskAgain = value;
				});
			});

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText("Cancel")
					.onClick(() => this.close());
			})
			.addButton((button) => {
				button
					.setButtonText("Delete")
					.setCta()
					.onClick(() => {
						void (async () => {
							await this.onConfirm(this.dontAskAgain);
							this.close();
						})();
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
