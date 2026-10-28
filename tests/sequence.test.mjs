import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';

const bundle = await build({
 stdin: { contents: 'export {default as Sequencer} from "./src/main.ts"; export * from "./tests/obsidian.mock.mjs";', resolveDir: process.cwd() },
 bundle: true, write: false, platform: 'node', format: 'esm',
 plugins: [{ name: 'mock-obsidian', setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.resolve('tests/obsidian.mock.mjs') }));
 } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { Sequencer, parseYaml, stringifyYaml, getFrontMatterInfo, FuzzySuggestModal, notices } = api;

function setup(entries, active = Object.keys(entries)[0], options = {}) {
 const files = new Map();
 const content = new Map();
 const writes = [];
 const opened = [];
 const events = {};
 for (const [name, value] of Object.entries(entries)) {
  const file = { path: name, basename: path.basename(name, '.md'), parent: { path: path.dirname(name) } };
  files.set(name, file);
  content.set(name, typeof value === 'string' ? value : `---\n${stringifyYaml(value)}---\nBody of ${name}\n`);
 }
 const fm = (name) => parseYaml(getFrontMatterInfo(content.get(name)).frontmatter) ?? {};
 const leaf = { openFile: async (file) => { opened.push(file.path); } };
 const view = { file: files.get(active), leaf, containerEl: { querySelector: () => null } };
 const app = {
  workspace: { on() {}, onLayoutReady: (callback) => callback(), getActiveFile: () => view.file, getActiveViewOfType: () => view, getLeaf: () => leaf },
  vault: {
   on: (name, handler) => { events[name] = handler; },
   read: async (file) => { assert.ok(content.has(file.path)); return content.get(file.path); },
   getFileByPath: (name) => files.get(name) ?? null,
   getMarkdownFiles: () => [...files.values()],
   create: async (name, text) => {
    assert.ok(!files.has(name));
    const file = { path: name, basename: path.basename(name, '.md'), parent: { path: path.dirname(name) } };
    files.set(name, file); content.set(name, text); return file;
   },
  },
  metadataCache: {
   on: (name, handler) => { events[name] = handler; },
   // Deliberately permanently stale; mutation code must never read this.
   getFileCache: (file) => options.getFileCache ? options.getFileCache(file, fm) : ({ frontmatter: {} }), unresolvedLinks: {},
   fileToLinktext: (target) => target.path.replace(/\.md$/, ''),
   getFirstLinkpathDest: (link, source) => {
    const name = link.endsWith('.md') ? link : `${link}.md`;
    return files.get(path.posix.join(path.posix.dirname(source), name)) ?? files.get(name) ?? null;
   },
  },
  fileManager: {
   processFrontMatter: async (file, callback) => {
    const old = content.get(file.path);
    const info = getFrontMatterInfo(old);
    const data = parseYaml(info.frontmatter) ?? {};
    callback(data);
    writes.push(file.path);
    const eol = old.includes('\r\n') ? '\r\n' : '\n';
    content.set(file.path, `---${eol}${stringifyYaml(data).replace(/\n/g, eol)}---${eol}${old.slice(info.contentStart)}`);
   },
   trashFile: async (file) => {
    const previous = { frontmatter: fm(file.path) };
    files.delete(file.path); content.delete(file.path);
    if (events.deleted) await events.deleted(file, previous);
   },
  },
 };
 const plugin = new Sequencer(app);
 plugin.settings = { repairSequenceOnDelete: true, confirmSequenceDelete: false, onlySiblingFiles: true, reciprocalLinks: true };
 return { plugin, app, files, content, writes, opened, fm, events, file: (name) => files.get(name) };
}

for (const direction of ['before', 'after']) {
 for (const lists of [false, true]) {
  test(`splice ${direction}, ${lists ? 'singleton lists' : 'scalars'}, stale cache`, async () => {
   const link = (name) => lists ? [`[[${name}]]`] : `[[${name}]]`;
   const h = setup({ 'A.md': { next: link('B') }, 'B.md': { prev: link('A') }, 'X.md': {} });
   await h.plugin.insertSelectedNoteAroundCurrent(h.file(direction === 'after' ? 'A.md' : 'B.md'), h.file('X.md'), direction);
   assert.equal(h.fm('A.md').next, '[[X]]');
   assert.deepEqual(h.fm('X.md'), { prev: '[[A]]', next: '[[B]]' });
   assert.equal(h.fm('B.md').prev, '[[X]]');
   await h.plugin.insertSelectedNoteAroundCurrent(h.file('A.md'), h.file('X.md'), 'after');
   assert.equal(h.writes.length, 4, 'existing neighbor is a no-op');
  });
 }
}

test('legacy command routing and newly created modal selection splice', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' } });
 await h.plugin.onload();
 const positions = [];
 const original = h.plugin.insertNoteAroundCurrent;
 h.plugin.insertNoteAroundCurrent = (position) => positions.push(position);
 h.plugin.commands.find((c) => c.id === 'set-prev-note').callback();
 h.plugin.commands.find((c) => c.id === 'set-next-note').callback();
 assert.deepEqual(positions, ['before', 'after']);
 h.plugin.insertNoteAroundCurrent = original;
 h.plugin.commands.find((c) => c.id === 'set-next-note').callback();
 FuzzySuggestModal.last.onChooseItem({ type: 'unresolved', linktext: 'New' });
 await new Promise((resolve) => setImmediate(resolve));
 assert.equal(h.fm('A.md').next, '[[New]]');
 assert.deepEqual(h.fm('New.md'), { prev: '[[A]]', next: '[[B]]' });
 assert.equal(h.fm('B.md').prev, '[[New]]');
});

for (const deleted of ['A.md', 'B.md', 'C.md']) {
 for (const nullCache of [false, true]) {
  test(`ordinary deletion ${deleted}, prevCache ${nullCache ? 'null' : 'present'}`, async () => {
   const h = setup({ 'A.md': { next: ['[[B]]'] }, 'B.md': { prev: ['[[A]]'], next: '[[C]]' }, 'C.md': { prev: '[[B]]' } }, 'A.md', {
    getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }),
   });
   await h.plugin.onload();
   const file = h.file(deleted);
   const previous = { frontmatter: h.fm(deleted) };
   h.files.delete(deleted); h.content.delete(deleted);
   await h.events.deleted(file, nullCache ? null : previous);
   if (deleted === 'B.md') {
    assert.equal(h.fm('A.md').next, '[[C]]'); assert.equal(h.fm('C.md').prev, '[[A]]');
   } else if (deleted === 'A.md') assert.equal(h.fm('B.md').prev, undefined);
   else assert.equal(h.fm('B.md').next, undefined);
   assert.equal(h.plugin.sequenceSnapshots.has(deleted), false);
  });
 }
}

test('changed metadata replaces snapshots and rename moves then refreshes them', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' }, 'C.md': { prev: '[[B]]' } }, 'A.md', {
  getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }),
 });
 await h.plugin.onload();
 const file = h.file('B.md');
 const changed = { frontmatter: { prev: ['[[A]]'], next: ['[[C]]'], tags: ['not retained'] } };
 h.events.changed(file, '', changed);
 changed.frontmatter.next[0] = '[[missing]]';
 assert.deepEqual(h.plugin.sequenceSnapshots.get('B.md').frontmatter, { prev: ['[[A]]'], next: ['[[C]]'] });
 h.files.delete('B.md');
 h.content.set('Renamed.md', h.content.get('B.md')); h.content.delete('B.md');
 file.path = 'Renamed.md'; file.basename = 'Renamed'; h.files.set(file.path, file);
 h.events.rename(file, 'B.md');
 assert.equal(h.plugin.sequenceSnapshots.has('B.md'), false);
 assert.deepEqual(h.plugin.sequenceSnapshots.get(file.path).frontmatter.next, ['[[C]]']);
 h.content.set(file.path, '---\nprev: "[[A]]"\nnext: "[[C]]"\n---\nBody');
 h.events.changed(file, h.content.get(file.path), h.app.metadataCache.getFileCache(file));
 assert.equal(h.plugin.sequenceSnapshots.get(file.path).frontmatter.next, '[[C]]');
 h.files.delete(file.path); h.content.delete(file.path);
 await h.events.deleted(file, null);
 assert.equal(h.fm('A.md').next, '[[C]]'); assert.equal(h.fm('C.md').prev, '[[A]]');
 assert.equal(h.plugin.sequenceSnapshots.has(file.path), false);
});

test('null metadata for a never-indexed file reports unavailable without writes', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' } }, 'A.md', { getFileCache: () => null });
 await h.plugin.onload();
 const file = h.file('B.md');
 h.files.delete(file.path); h.content.delete(file.path);
 await h.events.deleted(file, null);
 assert.equal(h.writes.length, 0);
 assert.match(notices.at(-1), /previous metadata is unavailable/);
});

test('remove preserves file, body, unrelated properties, block lists and CRLF', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': '---\r\nprev:\r\n  - "[[A]]"\r\nnext:\r\n  - "[[C]]"\r\ntags:\r\n  - keep\r\n---\r\nBody\r\nunchanged\r\n', 'C.md': { prev: '[[B]]' } }, 'B.md');
 await h.plugin.removeCurrentNoteFromSequence();
 assert.ok(h.file('B.md'));
 assert.deepEqual(h.fm('B.md'), { tags: ['keep'] });
 assert.ok(h.content.get('B.md').endsWith('Body\r\nunchanged\r\n'));
 assert.equal(h.fm('A.md').next, '[[C]]'); assert.equal(h.fm('C.md').prev, '[[A]]');
});

test('aliases, headings, folders and navigation use source-relative resolution', async () => {
 const h = setup({ 'folder/A.md': { next: ['[[B#Heading|Alias]]'] }, 'folder/B.md': { prev: '[[A|Alias]]' }, 'B.md': {}, 'X.md': {} });
 const oldDocument = globalThis.document;
 globalThis.document = { createElement: () => ({ classList: { add() {} } }) };
 try {
  const button = h.plugin.createNavButton('next', ['[[B#Heading|Alias]]'], h.file('folder/A.md'));
  await button.onclick({});
  assert.deepEqual(h.opened, ['folder/B.md']);
 } finally { globalThis.document = oldDocument; }
 await h.plugin.insertSelectedNoteAroundCurrent(h.file('folder/A.md'), h.file('X.md'), 'after');
 assert.equal(h.fm('X.md').next, '[[folder/B]]');
 assert.equal(h.fm('folder/B.md').prev, '[[X]]');
});

test('ambiguous properties anywhere in the write set reject before writes', async () => {
 for (const name of ['A.md', 'B.md', 'X.md']) {
  const entries = { 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' }, 'X.md': {} };
  entries[name].prev = ['[[A]]', '[[B]]'];
  const h = setup(entries);
  await assert.rejects(h.plugin.insertSelectedNoteAroundCurrent(h.file('A.md'), h.file('X.md'), 'after'), /singleton/);
  assert.equal(h.writes.length, 0);
 }
});

test('already sequenced target is rejected; malformed YAML and native write errors surface', async (t) => {

 t.mock.method(console, 'error', () => {});
 const h = setup({ 'A.md': {}, 'B.md': { next: '[[C]]' }, 'C.md': { prev: '[[B]]' } });
 assert.equal(await h.plugin.insertSelectedNoteAroundCurrent(h.file('A.md'), h.file('B.md'), 'after'), false);
 assert.equal(h.writes.length, 0);
 assert.match(notices.at(-1), /Remove this note/);
 h.content.set('A.md', '---\nnext: [broken\n---\nBody');
 await assert.rejects(h.plugin.readSequence(h.file('A.md')));
 assert.equal(h.writes.length, 0);
 h.content.set('A.md', '---\nnext: "[[B]]"\nBody');
 await assert.rejects(h.plugin.readSequence(h.file('A.md')));
 h.app.fileManager.processFrontMatter = async () => { throw new Error('disk failure'); };
 await h.plugin.runSequenceAction(() => h.plugin.updateFrontmatterLink(h.file('B.md'), 'next', null));
 assert.match(notices.at(-1), /disk failure/);
});

test('remove and delete reject multi-target neighbors before any write or trash', async () => {
 for (const operation of ['removeCurrentNoteFromSequence', 'deleteCurrentNoteFromSequence']) {
  const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]', next: '[[C]]' }, 'C.md': { prev: ['[[A]]', '[[B]]'] } }, 'B.md');
  await assert.rejects(h.plugin[operation](), /singleton/);
  assert.equal(h.writes.length, 0);
  assert.ok(h.file('B.md'));
 }
});

test('plugin deletion repairs once and suppression does not depend on cache timing', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]', next: '[[C]]' }, 'C.md': { prev: '[[B]]' } }, 'B.md');
 await h.plugin.onload(); h.plugin.settings.confirmSequenceDelete = false;
 await h.plugin.deleteCurrentNoteFromSequence();
 assert.equal(h.file('B.md'), undefined);
 assert.equal(h.writes.length, 2);
 assert.equal(h.fm('A.md').next, '[[C]]'); assert.equal(h.fm('C.md').prev, '[[A]]');
 assert.equal(h.plugin.sequenceSnapshots.has('B.md'), false);
});

test('native trash failure surfaces and clears deletion suppression', async (t) => {
 t.mock.method(console, 'error', () => {});
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]', next: '[[C]]' }, 'C.md': { prev: '[[B]]' } }, 'B.md');
 await h.plugin.onload(); h.plugin.settings.confirmSequenceDelete = false;
 h.app.fileManager.trashFile = async () => { throw new Error('trash failure'); };
 await h.plugin.runSequenceAction(() => h.plugin.deleteCurrentNoteFromSequence());
 assert.match(notices.at(-1), /Sequence operation failed: trash failure/);
 assert.ok(h.file('B.md'));
 assert.equal(h.plugin.pluginDeletedPaths.has('B.md'), false);
 assert.deepEqual(h.opened, []);
 // Neighbors are already repaired: trash failure does not roll back prior writes.
 assert.equal(h.fm('A.md').next, '[[C]]'); assert.equal(h.fm('C.md').prev, '[[A]]');
});
