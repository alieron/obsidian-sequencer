import { App, TFile, FuzzySuggestModal, FuzzyMatch, normalizePath } from "obsidian";

type Suggestion = {
	type: "unresolved";
	linktext: string;
} | {
	type: "file";
	file: TFile;
	linktext: string;
};

export class LinkToFileModal extends FuzzySuggestModal<Suggestion> {
	private suggestions: Suggestion[] = [];

	constructor(
		app: App,
		private currentFile: TFile,
		private direction: "prev" | "next",
		private insertLink: (file: TFile, direction: "prev" | "next", link: string) => Promise<void>
	) {
		super(app);
	}

	async onOpen() {
		// Preload suggestions so getItems is sync
		const files = this.app.vault.getMarkdownFiles();
		const fileSuggestions: Suggestion[] = files.map((file) => ({
			type: "file",
			file,
			linktext: file.basename,
		}));

		// Get unresolved links from metadata cache
		const unresolvedLinks = new Set<string>();
		const allLinks = this.app.metadataCache.unresolvedLinks;

		for (const [_, links] of Object.entries(allLinks)) {
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
		super.onOpen();
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

	async onChooseItem(item: Suggestion, evt: MouseEvent | KeyboardEvent) {
		const openNewTab = (evt as MouseEvent).metaKey || (evt as MouseEvent).ctrlKey;
		const link = `"[[${item.linktext}]]"`;

		let targetFile: TFile;

		if (item.type === "file" && item.file) {
			targetFile = item.file;
		} else {
			const path = normalizePath(item.linktext + ".md");
			targetFile = await this.app.vault.create(path, "");
		}

		await this.insertLink(this.currentFile, this.direction, link);
		const leaf = this.app.workspace.getLeaf(openNewTab);
		await leaf.openFile(targetFile);
	}
}

