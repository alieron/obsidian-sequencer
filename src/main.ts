import { App, Plugin, PluginManifest, TFile, MarkdownView, Notice, FuzzySuggestModal, setIcon } from "obsidian";
import { LinkToFileModal } from "./modal";

export default class SequentialNoteNavigator extends Plugin {
	async onload() {
		console.log("Loading Obsidian Sequencer plugin...");

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
	}

	onunload() {
		console.log("Unloading Obsidian Sequencer plugin...");
	}

	async addNavigationButtons() {
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
			const nextBtn = this.createNavButton("next", frontmatter.next);
			actionsEl.insertBefore(nextBtn, actionsEl.firstChild);

			const prevBtn = this.createNavButton("prev", frontmatter.prev);
			actionsEl.insertBefore(prevBtn, actionsEl.firstChild);
		}

	}

	getFrontmatter(file: TFile): Record<string, any> | null {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter ?? null;
	}

	createNavButton(label: "prev" | "next", target: string | undefined): HTMLButtonElement {
		const btn = createEl("button");
		btn.disabled = !target;
		btn.classList.add("clickable-icon", "seq-nav-button");
		btn.style.padding = "4px";

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

	async insertLink(key: "prev" | "next") {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) {
			new Notice("Run this command with a note open.");
			return;
		}


		const modal = new LinkToFileModal(this.app, file, key);

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
			if (lines[j].startsWith(`${key}:`)) {
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

