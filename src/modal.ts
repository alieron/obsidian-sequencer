import { App, TFile, FuzzySuggestModal, normalizePath } from "obsidian";
import { SequencerSettings } from "./settings";

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
		private settings: SequencerSettings,
		private currentFile: TFile,
		private direction: "prev" | "next",
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
			const path = normalizePath(`${this.currentFile.parent?.path}/${item.linktext}.md`);
			targetFile = await this.app.vault.create(path, "");
		}

		await this.insertLink(link);
		const leaf = this.app.workspace.getLeaf(openNewTab);
		await leaf.openFile(targetFile);
	}

	async insertLink(link: string): Promise<void> {
		this.app.vault.process(this.currentFile, (content) => {
			const match = content.match(/^---\n([\s\S]*?)\n---/);
			let updated: string;
			if (match) {
				updated = content.replace(
					/^---\n([\s\S]*?)\n---/,
					(_: string, yaml: string) => {
						const lines = yaml.split("\n").filter((line: string) => !line.startsWith(`${this.direction}:`)); // replace old link if any
						return `---\n${lines.join("\n")}\n${this.direction}: ${link}\n---`;
					}
				);
			} else {
				updated = `---\n${this.direction}: ${link}\n---` + content;
			}
			return updated;
		});
	}
}

