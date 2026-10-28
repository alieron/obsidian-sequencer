// Native API boundary only: js-yaml is already installed by ESLint. This does
// not emulate Obsidian's serializer, event timing, editor saves, or link index.
import yaml from 'js-yaml';
export const parseYaml = (text) => yaml.load(text);
export const stringifyYaml = (value) => yaml.dump(value);
export function getFrontMatterInfo(content) {
 const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
 if (!match && /^---\r?\n/.test(content)) throw new Error('Unclosed frontmatter');
 return { exists: !!match, frontmatter: match?.[1] ?? '', contentStart: match?.[0].length ?? 0 };
}
export const getLinkpath = (link) => link.split('#')[0];
export const notices = [];
export class Notice { constructor(message) { notices.push(message); } }
export class Plugin {
 constructor(app) { this.app = app; this.commands = []; }
 loadData() { return Promise.resolve({}); }
 saveData() { return Promise.resolve(); }
 addSettingTab() {}
 registerEvent() {}
 addCommand(command) { this.commands.push(command); }
}
export class PluginSettingTab {}
export class MarkdownView {}
export class Modal { constructor(app) { this.app = app; } }
export class FuzzySuggestModal extends Modal {
 setPlaceholder() {}
 open() { FuzzySuggestModal.last = this; }
}
export class Setting {}
export class TFile {}
export const setIcon = () => {};
export const normalizePath = (path) => path.replace(/\/+/g, '/').replace(/^\.\//, '');
