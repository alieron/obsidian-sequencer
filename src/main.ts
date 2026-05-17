import { CachedMetadata, FrontMatterCache, MarkdownView, Notice, Plugin, setIcon, TFile } from "obsidian";
import { ConfirmSequenceDeleteModal, InsertSequenceNoteModal, LinkToFileModal } from "./modal";
import { DEFAULT_SETTINGS, SequencerSettings, SequencerSettingTab } from "./settings";

export default class SequentialNoteNavigator extends Plugin {
	settings: SequencerSettings;
	private pluginDeletedPaths = new Set<string>();

	async onload() {
		console.debug("Loading Obsidian Sequencer plugin...");

		await this.loadSettings();

		this.addSettingTab(new SequencerSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.addNavigationButtons())
		);

		// run on startup
		this.addNavigationButtons();

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (file.path === activeFile?.path) {
					this.addNavigationButtons();
				}
			})
		);

		this.registerEvent(
			this.app.metadataCache.on("deleted", (file, prevCache) => {
				void this.handleDeletedFile(file, prevCache);
			})
		);

		this.addCommand({
			id: "set-prev-note",
			name: "Add link to previous note (deprecated: use Insert note before current note)",
			callback: () => this.insertLink("prev"),
		});

		this.addCommand({
			id: "set-next-note",
			name: "Add link to next note (deprecated: use Insert note after current note)",
			callback: () => this.insertLink("next"),
		});

		this.addCommand({
			id: "insert-note-before-current",
			name: "Insert note before current note",
			callback: () => {
				void this.insertNoteAroundCurrent("before");
			},
		});

		this.addCommand({
			id: "insert-note-after-current",
			name: "Insert note after current note",
			callback: () => {
				void this.insertNoteAroundCurrent("after");
			},
		});

		this.addCommand({
			id: "delete-current-note-from-sequence",
			name: "Delete current note from sequence",
			callback: () => {
				void this.deleteCurrentNoteFromSequence();
			},
		});

		this.addCommand({
			id: "remove-current-note-from-sequence",
			name: "Remove current note from sequence",
			callback: () => {
				void this.removeCurrentNoteFromSequence();
			},
		});

		this.addCommand({
			id: "unlink-current-note-from-sequence",
			name: "Unlink current note from sequence",
			callback: () => {
				void this.removeCurrentNoteFromSequence();
			},
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as SequencerSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		console.debug("Unloading Obsidian Sequencer plugin...");
	}

	addNavigationButtons() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const file = view.file;
		if (!file) return;

		const headerEl = view.containerEl.querySelector(".view-header");
		const actionsEl = headerEl?.querySelector(".view-actions");
		if (!headerEl || !actionsEl) return;

		// delete old buttons/prevent duplicate buttons
		actionsEl.querySelectorAll(".seq-nav-button").forEach((el) => el.remove());

		const frontmatter = this.getFrontmatter(file);
		if (!frontmatter) return;

		if (frontmatter.next || frontmatter.prev) {
			const nextBtn = this.createNavButton("next", frontmatter.next as string | undefined);
			actionsEl.insertBefore(nextBtn, actionsEl.firstChild);

			const prevBtn = this.createNavButton("prev", frontmatter.prev as string | undefined);
			actionsEl.insertBefore(prevBtn, actionsEl.firstChild);
		}

	}

	getFrontmatter(file: TFile): FrontMatterCache | null {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter ?? null;
	}

	createNavButton(label: "prev" | "next", target: string | undefined): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.disabled = !target;
		btn.classList.add("clickable-icon", "seq-nav-button");
		// btn.style.padding = "4px";

		const iconName = label === "prev" ? "arrow-big-left" : "arrow-big-right";
		setIcon(btn, iconName);

		if (target) {
			btn.ariaLabel = `${label === "prev" ? "Previous Note" : "Next Note"}\nClick to open\nCtrl+Click to open to the right`
			btn.onclick = async (event: MouseEvent) => {
				const cleanTarget = target.replace(/\[\[|\]\]/g, "");
				const resolved = this.app.metadataCache.getFirstLinkpathDest(cleanTarget, "");
				if (!resolved) {
					new Notice(`Note not found: ${target}`);
					return;
				}

				const openNewTab = event.ctrlKey || event.metaKey;

				const leaf = openNewTab ? this.app.workspace.getLeaf(true) : this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
				if (leaf) {
					await leaf.openFile(resolved);
				}
			};
		}

		return btn;
	}

	insertLink(key: "prev" | "next") {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) {
			new Notice("Run this command with a note open.");
			return;
		}


		const modal = new LinkToFileModal(this.app, this.settings, file, key);

		modal.open();
	}

	resolveSequenceLink(file: TFile, key: "prev" | "next"): TFile | null {
		const frontmatter = this.getFrontmatter(file);
		const rawTarget: unknown = frontmatter?.[key];
		if (typeof rawTarget !== "string") return null;

		const cleanTarget = this.cleanLinkTarget(rawTarget);

		return this.app.metadataCache.getFirstLinkpathDest(cleanTarget, file.path);
	}

	cleanLinkTarget(target: string): string {
		return target.replace(/^\s*['"]?/, "")
			.replace(/['"]?\s*$/, "")
			.replace(/^\[\[/, "")
			.replace(/\]\]$/, "");
	}

	getYamlLink(sourceFile: TFile, targetFile: TFile): string {
		const linktext = this.app.metadataCache.fileToLinktext(targetFile, sourceFile.path);
		return `"[[${linktext}]]"`;
	}

	insertNoteAroundCurrent(position: "before" | "after") {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const currentFile = view?.file;
		if (!currentFile) {
			new Notice("Run this command with a note open.");
			return;
		}

		const modal = new InsertSequenceNoteModal(
			this.app,
			this.settings,
			currentFile,
			position,
			async (targetFile) => {
				await this.insertSelectedNoteAroundCurrent(currentFile, targetFile, position);
				await view.leaf.openFile(targetFile);
			},
		);

		modal.open();
	}

	async insertSelectedNoteAroundCurrent(currentFile: TFile, targetFile: TFile, position: "before" | "after") {
		if (targetFile.path === currentFile.path) {
			new Notice("Choose a different note to insert into the sequence.");
			return;
		}

		const previousFile = this.resolveSequenceLink(currentFile, "prev");
		const nextFile = this.resolveSequenceLink(currentFile, "next");

		if (position === "before") {
			await this.updateFrontmatterLink(targetFile, "prev", previousFile ? this.getYamlLink(targetFile, previousFile) : null);
			await this.updateFrontmatterLink(targetFile, "next", this.getYamlLink(targetFile, currentFile));
			await this.updateFrontmatterLink(currentFile, "prev", this.getYamlLink(currentFile, targetFile));
			if (previousFile) {
				await this.updateFrontmatterLink(previousFile, "next", this.getYamlLink(previousFile, targetFile));
			}
		} else {
			await this.updateFrontmatterLink(targetFile, "prev", this.getYamlLink(targetFile, currentFile));
			await this.updateFrontmatterLink(targetFile, "next", nextFile ? this.getYamlLink(targetFile, nextFile) : null);
			await this.updateFrontmatterLink(currentFile, "next", this.getYamlLink(currentFile, targetFile));
			if (nextFile) {
				await this.updateFrontmatterLink(nextFile, "prev", this.getYamlLink(nextFile, targetFile));
			}
		}

		new Notice(`Inserted ${targetFile.basename} ${position} ${currentFile.basename}.`);
	}

	async deleteCurrentNoteFromSequence() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const currentFile = view?.file;
		if (!currentFile) {
			new Notice("Run this command with a note open.");
			return;
		}

		const previousFile = this.resolveSequenceLink(currentFile, "prev");
		const nextFile = this.resolveSequenceLink(currentFile, "next");

		if (!previousFile && !nextFile) {
			new Notice("This note is not connected to a sequence.");
			return;
		}

		if (!this.settings.confirmSequenceDelete) {
			await this.deleteSequencedFile(currentFile, previousFile, nextFile);
			return;
		}

		new ConfirmSequenceDeleteModal(this.app, currentFile, async (dontAskAgain) => {
			if (dontAskAgain) {
				this.settings.confirmSequenceDelete = false;
				await this.saveSettings();
			}

			await this.deleteSequencedFile(currentFile, previousFile, nextFile);
		}).open();
	}

	async deleteSequencedFile(currentFile: TFile, previousFile: TFile | null, nextFile: TFile | null) {
		await this.reconnectSequenceNeighbors(previousFile, nextFile);

		const fileToOpen = nextFile ?? previousFile;
		this.pluginDeletedPaths.add(currentFile.path);
		await this.app.fileManager.trashFile(currentFile);

		if (fileToOpen) {
			await this.app.workspace.getLeaf(false).openFile(fileToOpen);
		}

		new Notice(`Deleted ${currentFile.basename} from the sequence.`);
	}

	async removeCurrentNoteFromSequence() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const currentFile = view?.file;
		if (!currentFile) {
			new Notice("Run this command with a note open.");
			return;
		}

		const previousFile = this.resolveSequenceLink(currentFile, "prev");
		const nextFile = this.resolveSequenceLink(currentFile, "next");

		if (!previousFile && !nextFile) {
			new Notice("This note is not connected to a sequence.");
			return;
		}

		await this.reconnectSequenceNeighbors(previousFile, nextFile);
		await this.updateFrontmatterLink(currentFile, "prev", null);
		await this.updateFrontmatterLink(currentFile, "next", null);
		new Notice(`Removed ${currentFile.basename} from the sequence.`);
	}

	async reconnectSequenceNeighbors(previousFile: TFile | null, nextFile: TFile | null) {
		if (previousFile) {
			await this.updateFrontmatterLink(previousFile, "next", nextFile ? this.getYamlLink(previousFile, nextFile) : null);
		}

		if (nextFile) {
			await this.updateFrontmatterLink(nextFile, "prev", previousFile ? this.getYamlLink(nextFile, previousFile) : null);
		}
	}

	async handleDeletedFile(file: TFile, prevCache: CachedMetadata | null) {
		if (this.pluginDeletedPaths.delete(file.path)) return;
		if (!this.settings.repairSequenceOnDelete) return;

		const frontmatter = prevCache?.frontmatter;
		const previousFile = this.resolveSequenceLinkFromFrontmatter(file, frontmatter, "prev");
		const nextFile = this.resolveSequenceLinkFromFrontmatter(file, frontmatter, "next");

		if (!previousFile && !nextFile) return;

		await this.reconnectSequenceNeighbors(previousFile, nextFile);
	}

	resolveSequenceLinkFromFrontmatter(file: TFile, frontmatter: FrontMatterCache | undefined, key: "prev" | "next"): TFile | null {
		const rawTarget: unknown = frontmatter?.[key];
		if (typeof rawTarget !== "string") return null;

		const cleanTarget = this.cleanLinkTarget(rawTarget);
		const resolved = this.app.metadataCache.getFirstLinkpathDest(cleanTarget, file.path);
		if (!resolved) return null;

		return this.app.vault.getFileByPath(resolved.path);
	}

	async updateFrontmatterLink(file: TFile, key: "prev" | "next", value: string | null) {
		if (!this.app.vault.getFileByPath(file.path)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		if (lines[0] !== "---") {
			if (value === null) return;
			// no frontmatter — insert a new block
			const newFrontmatter = `---\n${key}: ${value}\n---\n`;
			await this.app.vault.modify(file, newFrontmatter + content);
			return;
		}

		// find the end of the frontmatter
		let i = 1;
		while (i < lines.length && lines[i] !== "---") i++;
		if (i >= lines.length) {
			new Notice("Invalid frontmatter format.");
			return;
		}

		// insert the link
		let found = false;
		for (let j = 1; j < i; j++) {
			if ((lines[j] as string).startsWith(`${key}:`)) {
				if (value === null) {
					lines.splice(j, 1);
				} else {
					lines[j] = `${key}: ${value}`;
				}
				found = true;
				break;
			}
		}
		if (!found && value !== null) {
			lines.splice(i, 0, `${key}: ${value}`);
		}

		// write the frontmatter back to the file
		const newContent = lines.join("\n");
		await this.app.vault.modify(file, newContent);
	}
}
