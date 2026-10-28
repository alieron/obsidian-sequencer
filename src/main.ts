import { CachedMetadata, FrontMatterCache, getFrontMatterInfo, getLinkpath, MarkdownView, Notice, parseYaml, Plugin, setIcon, TFile } from "obsidian";
import { ConfirmSequenceDeleteModal, InsertSequenceNoteModal } from "./modal";
import { DEFAULT_SETTINGS, SequencerSettings, SequencerSettingTab } from "./settings";

export default class SequentialNoteNavigator extends Plugin {
	settings: SequencerSettings;
	private pluginDeletedPaths = new Set<string>();
	private sequenceSnapshots = new Map<string, CachedMetadata>();

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
			this.app.metadataCache.on("changed", (file, _data, cache) => {
				this.snapshotSequenceMetadata(file, cache);
				const activeFile = this.app.workspace.getActiveFile();
				if (file.path === activeFile?.path) {
					this.addNavigationButtons();
				}
			})
		);

		this.app.workspace.onLayoutReady(() => {
			for (const file of this.app.vault.getMarkdownFiles()) {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache) this.snapshotSequenceMetadata(file, cache);
			}
		});
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			const cache = this.sequenceSnapshots.get(oldPath);
			this.sequenceSnapshots.delete(oldPath);
			if (cache) this.sequenceSnapshots.set(file.path, cache);
		}));

		this.registerEvent(
			this.app.metadataCache.on("deleted", (file, prevCache) => {
				return this.runSequenceAction(() => this.handleDeletedFile(file, prevCache));
			})
		);

		this.addCommand({
			id: "set-prev-note",
			name: "Add link to previous note (deprecated: use 'insert note before current note')",
			callback: () => this.insertNoteAroundCurrent("before"),
		});

		this.addCommand({
			id: "set-next-note",
			name: "Add link to next note (deprecated: use 'insert note after current note')",
			callback: () => this.insertNoteAroundCurrent("after"),
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
				void this.runSequenceAction(() => this.deleteCurrentNoteFromSequence());
			},
		});

		this.addCommand({
			id: "remove-current-note-from-sequence",
			name: "Remove current note from sequence",
			callback: () => {
				void this.runSequenceAction(() => this.removeCurrentNoteFromSequence());
			},
		});

		this.addCommand({
			id: "unlink-current-note-from-sequence",
			name: "Unlink current note from sequence",
			callback: () => {
				void this.runSequenceAction(() => this.removeCurrentNoteFromSequence());
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
			const nextBtn = this.createNavButton("next", frontmatter.next, file);
			actionsEl.insertBefore(nextBtn, actionsEl.firstChild);

			const prevBtn = this.createNavButton("prev", frontmatter.prev, file);
			actionsEl.insertBefore(prevBtn, actionsEl.firstChild);
		}

	}

	getFrontmatter(file: TFile): FrontMatterCache | null {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter ?? null;
	}

	createNavButton(label: "prev" | "next", value: unknown, source: TFile): HTMLButtonElement {
		const target = this.sequenceTarget(value);
		const btn = document.createElement("button");
		btn.disabled = !target;
		btn.classList.add("clickable-icon", "seq-nav-button");
		// btn.style.padding = "4px";

		const iconName = label === "prev" ? "arrow-big-left" : "arrow-big-right";
		setIcon(btn, iconName);

		if (target) {
			btn.ariaLabel = `${label === "prev" ? "Previous Note" : "Next Note"}\nClick to open\nCtrl+Click to open to the right`
			btn.onclick = async (event: MouseEvent) => {
				const resolved = this.app.metadataCache.getFirstLinkpathDest(this.cleanLinkTarget(target), source.path);
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

	async runSequenceAction(action: () => Promise<unknown>) {
		try {
			await action();
		} catch (error) {
			console.error("Sequencer operation failed", error);
			new Notice(`Sequence operation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	sequenceTarget(value: unknown, strict = false): string | null {
		if (Array.isArray(value) && value.length === 1) value = value[0];
		if (typeof value === "string") return value.trim() || null;
		if (strict && value != null && (!Array.isArray(value) || value.length > 0)) {
			throw new Error("Sequence properties must be a string or a singleton string list.");
		}
		return null;
	}

	async readSequence(file: TFile, allowMissing = false) {
		const content = await this.app.vault.read(file);
		const info = getFrontMatterInfo(content);
		if (!info.exists && /^(?:\uFEFF)?---\r?\n/.test(content)) {
			throw new Error(`Invalid frontmatter in ${file.path}`);
		}
		const frontmatter: unknown = info.exists ? parseYaml(info.frontmatter) : {};
		if (frontmatter != null && (typeof frontmatter !== "object" || Array.isArray(frontmatter))) {
			throw new Error(`Invalid frontmatter in ${file.path}`);
		}
		const fm = (frontmatter ?? {}) as FrontMatterCache;
		return {
			prev: this.resolveSequenceLinkFromFrontmatter(file, fm, "prev", allowMissing),
			next: this.resolveSequenceLinkFromFrontmatter(file, fm, "next", allowMissing),
		};
	}

	cleanLinkTarget(target: string): string {
		return getLinkpath(target.replace(/^\s*['"]?/, "")
			.replace(/['"]?\s*$/, "")
			.replace(/^\[\[/, "")
			.replace(/\]\]$/, "").split("|")[0] ?? "");
	}

	getYamlLink(sourceFile: TFile, targetFile: TFile): string {
		const linktext = this.app.metadataCache.fileToLinktext(targetFile, sourceFile.path);
		return `[[${linktext}]]`;
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
				await this.runSequenceAction(async () => {
					if (await this.insertSelectedNoteAroundCurrent(currentFile, targetFile, position)) {
						await view.leaf.openFile(targetFile);
					}
				});
			},
		);

		modal.open();
	}

	async insertSelectedNoteAroundCurrent(currentFile: TFile, targetFile: TFile, position: "before" | "after") {
		if (targetFile.path === currentFile.path) {
			new Notice("Choose a different note to insert into the sequence.");
			return;
		}

		const { prev: previousFile, next: nextFile } = await this.readSequence(currentFile);
		if ((position === "before" ? previousFile : nextFile)?.path === targetFile.path) return true;
		// ponytail: reject moves; detaching an existing sequence needs a separate operation.
		const targetSequence = await this.readSequence(targetFile);
		if (targetSequence.prev || targetSequence.next) {
			new Notice("Remove this note from its sequence before inserting it elsewhere.");
			return false;
		}
		const neighbor = position === "before" ? previousFile : nextFile;
		if (neighbor) await this.readSequence(neighbor);

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
		return true;
	}

	async deleteCurrentNoteFromSequence() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const currentFile = view?.file;
		if (!currentFile) {
			new Notice("Run this command with a note open.");
			return;
		}

		const { prev: previousFile, next: nextFile } = await this.readSequence(currentFile);

		if (!previousFile && !nextFile) {
			new Notice("This note is not connected to a sequence.");
			return;
		}

		if (!this.settings.confirmSequenceDelete) {
			await this.deleteSequencedFile(currentFile);
			return;
		}

		new ConfirmSequenceDeleteModal(this.app, currentFile, async (dontAskAgain) => {
			if (dontAskAgain) {
				this.settings.confirmSequenceDelete = false;
				await this.saveSettings();
			}

			await this.runSequenceAction(() => this.deleteSequencedFile(currentFile));
		}).open();
	}

	async deleteSequencedFile(currentFile: TFile) {
		const { prev: previousFile, next: nextFile } = await this.readSequence(currentFile);
		await this.reconnectSequenceNeighbors(previousFile, nextFile);

		const fileToOpen = nextFile ?? previousFile;
		this.pluginDeletedPaths.add(currentFile.path);
		try {
			await this.app.fileManager.trashFile(currentFile);
		} catch (error) {
			this.pluginDeletedPaths.delete(currentFile.path);
			throw error;
		}

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

		const { prev: previousFile, next: nextFile } = await this.readSequence(currentFile);

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
		// Validate both neighbors before the first write, including ambiguous list properties.
		if (previousFile) await this.readSequence(previousFile, true);
		if (nextFile) await this.readSequence(nextFile, true);
		if (previousFile) {
			await this.updateFrontmatterLink(previousFile, "next", nextFile ? this.getYamlLink(previousFile, nextFile) : null);
		}

		if (nextFile) {
			await this.updateFrontmatterLink(nextFile, "prev", previousFile ? this.getYamlLink(nextFile, previousFile) : null);
		}
	}

	snapshotSequenceMetadata(file: TFile, cache: CachedMetadata) {
		const frontmatter: FrontMatterCache = {};
		for (const key of ["prev", "next"]) {
			const value: unknown = cache.frontmatter?.[key];
			frontmatter[key] = Array.isArray(value) ? [...(value as unknown[])] : value;
		}
		this.sequenceSnapshots.set(file.path, { frontmatter });
	}

	async handleDeletedFile(file: TFile, prevCache: CachedMetadata | null) {
		const cache = prevCache ?? this.sequenceSnapshots.get(file.path);
		this.sequenceSnapshots.delete(file.path);
		if (this.pluginDeletedPaths.delete(file.path)) return;
		if (!this.settings.repairSequenceOnDelete) return;
		// Incoming links cannot reliably identify a unique chain for an unindexed note.
		if (!cache) {
			new Notice(`Cannot repair the sequence for ${file.basename}: previous metadata is unavailable.`);
			return;
		}

		const frontmatter = cache.frontmatter;
		const previousFile = this.resolveSequenceLinkFromFrontmatter(file, frontmatter, "prev");
		const nextFile = this.resolveSequenceLinkFromFrontmatter(file, frontmatter, "next");

		if (!previousFile && !nextFile) return;

		await this.reconnectSequenceNeighbors(previousFile, nextFile);
	}

	resolveSequenceLinkFromFrontmatter(file: TFile, frontmatter: FrontMatterCache | undefined, key: "prev" | "next", allowMissing = false): TFile | null {
		const rawTarget = this.sequenceTarget(frontmatter?.[key], true);
		if (!rawTarget) return null;

		const cleanTarget = this.cleanLinkTarget(rawTarget);
		const resolved = this.app.metadataCache.getFirstLinkpathDest(cleanTarget, file.path);
		if (!resolved && allowMissing) return null;
		if (!resolved || resolved.path === file.path) throw new Error(`Invalid ${key} link in ${file.path}`);

		return this.app.vault.getFileByPath(resolved.path);
	}

	async updateFrontmatterLink(file: TFile, key: "prev" | "next", value: string | null) {
		if (!this.app.vault.getFileByPath(file.path)) throw new Error(`Note no longer exists: ${file.path}`);
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			this.sequenceTarget(frontmatter[key], true);
			if (value === null) delete frontmatter[key];
			else frontmatter[key] = value;
		});
	}
}
