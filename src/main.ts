import { App, Plugin, PluginManifest, TFile, MarkdownView, Notice, setIcon } from "obsidian";

export default class SequentialNoteNavigator extends Plugin {
	async onload() {
		console.log("Loading Obsidian Sequencer plugin...");

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.addNavigationButtons())
		);

		// run on startup
		this.addNavigationButtons();
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

		if (frontmatter.next) {
			const nextBtn = this.createNavButton("next", frontmatter.next);
			actionsEl.insertBefore(nextBtn, actionsEl.firstChild);
		}

		if (frontmatter.prev) {
			const prevBtn = this.createNavButton("prev", frontmatter.prev);
			actionsEl.insertBefore(prevBtn, actionsEl.firstChild);
		}

	}

	getFrontmatter(file: TFile): Record<string, any> | null {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache?.frontmatter ?? null;
	}

	createNavButton(label: "prev" | "next", target: string): HTMLButtonElement {
		const btn = createEl("button");
		btn.classList.add("clickable-icon", "seq-nav-button");
		btn.style.padding = "4px";

		const iconName = label === "prev" ? "arrow-big-left" : "arrow-big-right";
		setIcon(btn, iconName);

		btn.onclick = async () => {
			const cleanTarget = target.replace(/\[\[|\]\]/g, "");
			const resolved = this.app.metadataCache.getFirstLinkpathDest(cleanTarget, "");
			if (!resolved) {
				new Notice(`Note not found: ${target}`);
				return;
			}

			const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (mdView) {
				await mdView.leaf.openFile(resolved);
			} else {
				new Notice("No active markdown view.");
			}
		};

		return btn;
	}
}

