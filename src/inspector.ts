import { ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type SequentialNoteNavigator from "./main";

export const SEQUENCE_INSPECTOR_VIEW_TYPE = "sequencer-inspector";

export type SequenceNode = {
	file: TFile;
	isCurrent: boolean;
};

export class SequenceInspectorView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private plugin: SequentialNoteNavigator,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SEQUENCE_INSPECTOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Sequence inspector";
	}

	getIcon(): string {
		return "signpost";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("seq-inspector");

		const currentFile = this.plugin.getCurrentMarkdownFile();

		if (!currentFile) {
			contentEl.createEl("p", {
				cls: "seq-inspector-empty",
				text: "Open a sequenced note to inspect its chain.",
			});
			return;
		}

		const nodes = this.plugin.getSequenceNodes(currentFile);
		if (nodes.length === 0) {
			contentEl.createEl("p", {
				cls: "seq-inspector-empty",
				text: "This note is not connected to a sequence.",
			});
			return;
		}

		const listEl = contentEl.createDiv({ cls: "seq-inspector-chain" });
		for (const node of nodes) {
			const rowEl = listEl.createDiv({
				cls: `seq-inspector-node${node.isCurrent ? " is-current" : ""}`,
			});
			const markerEl = rowEl.createDiv({ cls: "seq-inspector-marker" });
			setIcon(markerEl, node.isCurrent ? "circle-dot" : "circle");

			const buttonEl = rowEl.createEl("button", {
				cls: "seq-inspector-note",
				text: node.file.path,
			});
			buttonEl.ariaLabel = `Open ${node.file.basename}`;
			buttonEl.onpointerdown = async (event) => {
				event.preventDefault();
				event.stopPropagation();
				await this.plugin.openSequenceFile(node.file);
			};
		}
	}
}
