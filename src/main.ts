import { FrontMatterCache, MarkdownView, Notice, Plugin, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { SequenceInspectorView, SEQUENCE_INSPECTOR_VIEW_TYPE } from "./inspector";
import type { SequenceNode } from "./inspector";
import { LinkToFileModal } from "./modal";
import { DEFAULT_SETTINGS, SequencerSettings, SequencerSettingTab } from "./settings";

export default class SequentialNoteNavigator extends Plugin {
	settings: SequencerSettings;
	private lastFocusedMarkdownFile: TFile | null = null;
	private lastFocusedMarkdownLeaf: WorkspaceLeaf | null = null;

	async onload() {
		console.debug("Loading Obsidian Sequencer plugin...");

		await this.loadSettings();

		this.addSettingTab(new SequencerSettingTab(this.app, this));
		this.registerView(
			SEQUENCE_INSPECTOR_VIEW_TYPE,
			(leaf) => new SequenceInspectorView(leaf, this),
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.rememberActiveMarkdownView();
				this.addNavigationButtons();
				this.refreshSequenceInspectors();
			})
		);

		// run on startup
		this.rememberActiveMarkdownView();
		this.addNavigationButtons();

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (file.path === activeFile?.path) {
					this.addNavigationButtons();
				}
				this.refreshSequenceInspectors();
			})
		);

		this.addRibbonIcon("list-tree", "Open sequence inspector", () => {
			void this.activateSequenceInspector();
		});

		this.addCommand({
			id: "set-prev-note",
			name: "Add link to previous note",
			callback: () => this.insertLink("prev"),
		});

		this.addCommand({
			id: "set-next-note",
			name: "Add link to next note",
			callback: () => this.insertLink("next"),
		});

		this.addCommand({
			id: "open-sequence-inspector",
			name: "Open sequence inspector",
			callback: () => {
				void this.activateSequenceInspector();
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

	getCurrentMarkdownFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			this.lastFocusedMarkdownFile = view.file;
			this.lastFocusedMarkdownLeaf = view.leaf;
			return view.file;
		}

		return this.lastFocusedMarkdownFile;
	}

	rememberActiveMarkdownView() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;

		this.lastFocusedMarkdownFile = view.file;
		this.lastFocusedMarkdownLeaf = view.leaf;
	}

	async openSequenceFile(file: TFile) {
		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const leaf = activeMarkdownView?.leaf ?? this.lastFocusedMarkdownLeaf ?? this.app.workspace.getLeaf(false);

		await leaf.openFile(file);
		this.lastFocusedMarkdownFile = file;
		this.lastFocusedMarkdownLeaf = leaf;
		this.refreshSequenceInspectors();
	}

	async activateSequenceInspector() {
		const existingLeaves = this.app.workspace.getLeavesOfType(SEQUENCE_INSPECTOR_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			await this.app.workspace.revealLeaf(existingLeaves[0]!);
			this.refreshSequenceInspectors();
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;

		await leaf.setViewState({ type: SEQUENCE_INSPECTOR_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	refreshSequenceInspectors() {
		for (const leaf of this.app.workspace.getLeavesOfType(SEQUENCE_INSPECTOR_VIEW_TYPE)) {
			if (leaf.view instanceof SequenceInspectorView) {
				leaf.view.render();
			}
		}
	}

	getSequenceNodes(currentFile: TFile): SequenceNode[] {
		const currentFrontmatter = this.getFrontmatter(currentFile);
		if (!currentFrontmatter?.prev && !currentFrontmatter?.next) {
			return [];
		}

		let firstFile = currentFile;
		const reverseVisited = new Set<string>([currentFile.path]);
		let previousFile = this.resolveSequenceLink(currentFile, "prev");

		while (previousFile && !reverseVisited.has(previousFile.path)) {
			firstFile = previousFile;
			reverseVisited.add(previousFile.path);
			previousFile = this.resolveSequenceLink(previousFile, "prev");
		}

		const nodes: SequenceNode[] = [];
		const forwardVisited = new Set<string>();
		let nextFile: TFile | null = firstFile;

		while (nextFile && !forwardVisited.has(nextFile.path)) {
			nodes.push({
				file: nextFile,
				isCurrent: nextFile.path === currentFile.path,
			});
			forwardVisited.add(nextFile.path);
			nextFile = this.resolveSequenceLink(nextFile, "next");
		}

		return nodes;
	}

	resolveSequenceLink(file: TFile, key: "prev" | "next"): TFile | null {
		const frontmatter = this.getFrontmatter(file);
		const rawTarget = frontmatter?.[key] as unknown;
		if (typeof rawTarget !== "string") return null;

		const cleanTarget = rawTarget.replace(/^\s*['"]?/, "")
			.replace(/['"]?\s*$/, "")
			.replace(/^\[\[/, "")
			.replace(/\]\]$/, "");

		return this.app.metadataCache.getFirstLinkpathDest(cleanTarget, file.path);
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

	async updateFrontmatterLink(file: TFile, key: "prev" | "next", value: string) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		if (lines[0] !== "---") {
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
				lines[j] = `${key}: ${value}`;
				found = true;
				break;
			}
		}
		if (!found) {
			lines.splice(i, 0, `${key}: ${value}`);
		}

		// write the frontmatter back to the file
		const newContent = lines.join("\n");
		await this.app.vault.modify(file, newContent);
	}
}
