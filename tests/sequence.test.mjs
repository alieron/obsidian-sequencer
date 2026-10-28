import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';

const bundle = await build({
 stdin: { contents: 'export {default as Sequencer} from "./src/main.ts"; export * from "./src/relations.ts"; export * from "./tests/obsidian.mock.mjs";', resolveDir: process.cwd() },
 bundle: true, write: false, platform: 'node', format: 'esm',
 plugins: [{ name: 'mock-obsidian', setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.resolve('tests/obsidian.mock.mjs') }));
 } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { Sequencer, parseYaml, stringifyYaml, getFrontMatterInfo, FuzzySuggestModal, notices } = api;

test('inverse pair parser accepts spaces and rejects unsafe or ambiguous pairs', () => {
 assert.deepEqual(api.parseInverseRelations(' next: prev\n\nsuccessor note: predecessor note '), [
  { forward: 'next', reverse: 'prev' }, { forward: 'successor note', reverse: 'predecessor note' },
 ]);
 for (const text of ['a:a', 'a:b\nc:a', 'a:b\na:c', 'a:b:c', ':b', 'a:', 'a', '__proto__: b', 'a:constructor', 'prototype:b', '"a":b', 'a:#b']) {
  assert.throws(() => api.parseInverseRelations(text), Error, text);
 }
});

function setup(entries, active = Object.keys(entries)[0], options = {}) {
 const files = new Map();
 const content = new Map();
 const writes = [];
 const opened = [];
 const events = {};
 const delayed = [];
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
    if (events.changed && options.emitChanges) {
     const cache = { frontmatter: structuredClone(data) };
     const event = () => events.changed(file, '', cache);
     if (options.emitChanges === 'delayed') delayed.push(event);
     else await event();
    }
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
 const drain = async () => {
  while (true) {
   delayed.splice(0).forEach(event => event());
   const queue = plugin.mutationQueue;
   await queue;
   await new Promise(resolve => setImmediate(resolve));
   if (queue === plugin.mutationQueue && !delayed.length) break;
  }
 };
 const edit = async (name, data, wait = true) => {
  content.set(name, `---\n${stringifyYaml(data)}---\nBody of ${name}\n`);
  events.changed(files.get(name), '', { frontmatter: structuredClone(data) });
  if (wait) await drain();
 };
 return { plugin, app, files, content, writes, opened, fm, events, drain, edit, file: (name) => files.get(name) };
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
   await h.drain();
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
 h.content.set('B.md', `---\n${stringifyYaml(changed.frontmatter)}---\nBody`);
 h.events.changed(file, '', changed);
 await h.drain();
 changed.frontmatter.next[0] = '[[missing]]';
 assert.deepEqual(h.plugin.sequenceSnapshots.get('B.md').frontmatter.next, ['[[C]]']);
 h.files.delete('B.md');
 h.content.set('Renamed.md', h.content.get('B.md')); h.content.delete('B.md');
 file.path = 'Renamed.md'; file.basename = 'Renamed'; h.files.set(file.path, file);
 h.events.rename(file, 'B.md');
 assert.equal(h.plugin.sequenceSnapshots.has('B.md'), false);
 assert.deepEqual(h.plugin.sequenceSnapshots.get(file.path).frontmatter.next, ['[[C]]']);
 // Model Obsidian's incoming-link rename updates before the next synchronization.
 h.content.set('A.md', '---\nnext: "[[Renamed]]"\n---\nBody');
 h.content.set('C.md', '---\nprev: "[[Renamed]]"\n---\nBody');
 h.content.set(file.path, '---\nprev: "[[A]]"\nnext: "[[C]]"\n---\nBody');
 h.events.changed(file, h.content.get(file.path), h.app.metadataCache.getFileCache(file));
 await h.drain();
 assert.equal(h.plugin.sequenceSnapshots.get(file.path).frontmatter.next, '[[C]]');
 h.files.delete(file.path); h.content.delete(file.path);
 await h.events.deleted(file, null);
 await h.drain();
 assert.equal(h.fm('A.md').next, '[[C]]'); assert.equal(h.fm('C.md').prev, '[[A]]');
 assert.equal(h.plugin.sequenceSnapshots.has(file.path), false);
});

test('null metadata for a never-indexed file reports unavailable without writes', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' } }, 'A.md', { getFileCache: () => null });
 await h.plugin.onload();
 const file = h.file('B.md');
 h.files.delete(file.path); h.content.delete(file.path);
 await h.events.deleted(file, null);
 await h.drain();
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
 await h.drain();
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

for (const emitChanges of ['inline', 'delayed']) {
 for (const [key, inverse] of [['next', 'prev'], ['prev', 'next'], ['succ', 'pred'], ['pred', 'succ']]) {
  for (const list of [false, true]) {
   test(`manual ${key} ${list ? 'list' : 'scalar'}, ${emitChanges}: add, retarget, remove, stale events`, async () => {
    const h = setup({ 'A.md': { tags: ['keep'] }, 'B.md': { unrelated: 123 }, 'C.md': {} }, 'A.md', { emitChanges, getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
    await h.plugin.onload();
    assert.equal(h.writes.length, 0, 'startup does not migrate');
    const value = name => list ? [`[[${name}#Heading|Alias]]`] : `[[${name}#Heading|Alias]]`;
    await h.edit('A.md', { tags: ['keep'], [key]: value('B') });
    assert.equal(h.fm('B.md')[inverse], '[[A]]');
    assert.equal(h.fm('B.md').unrelated, 123);
    await h.edit('A.md', { tags: ['keep'], [key]: value('C') });
    assert.equal(h.fm('B.md')[inverse], undefined);
    assert.equal(h.fm('C.md')[inverse], '[[A]]');
    await h.edit('A.md', { tags: ['keep'] });
    assert.equal(h.fm('C.md')[inverse], undefined);
    const count = h.writes.length;
    for (let i = 0; i < 3; i++) {
     h.events.changed(h.file('A.md'), '', { frontmatter: { [key]: '[[B]]' } });
     h.events.changed(h.file('C.md'), '', { frontmatter: { [inverse]: '[[A]]' } });
    }
    await h.drain();
    assert.equal(h.writes.length, count);
    assert.deepEqual(h.fm('A.md'), { tags: ['keep'] });
   });
  }
 }

 test(`native DLL mutations serialize metadata events: ${emitChanges}`, async () => {
  const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]', next: '[[C]]' }, 'C.md': { prev: '[[B]]' }, 'X.md': {} }, 'B.md', { emitChanges, getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
  await h.plugin.onload();
  await h.plugin.insertSelectedNoteAroundCurrent(h.file('A.md'), h.file('X.md'), 'after');
  await h.drain();
  assert.deepEqual(h.fm('X.md'), { prev: '[[A]]', next: '[[B]]' });
  assert.equal(h.fm('B.md').prev, '[[X]]');
  await h.plugin.removeCurrentNoteFromSequence();
  await h.drain();
  assert.deepEqual(h.fm('B.md'), {});
  assert.equal(h.fm('X.md').next, '[[C]]');
  assert.equal(h.fm('C.md').prev, '[[X]]');
  const x = h.file('X.md');
  await h.app.fileManager.trashFile(x);
  h.events.changed(x, '', { frontmatter: { prev: '[[A]]', next: '[[C]]' } });
  await h.drain();
  assert.equal(h.fm('A.md').next, '[[C]]');
  assert.equal(h.fm('C.md').prev, '[[A]]');
  await h.plugin.deleteSequencedFile(h.file('C.md'));
  await h.drain();
  assert.deepEqual(h.fm('A.md'), {});
  assert.equal(h.plugin.sequenceSnapshots.has('C.md'), false);
 });
}

test('conflicting retarget never removes old inverse; unrelated removal is preserved', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' }, 'C.md': { prev: '[[D]]' }, 'D.md': {} }, 'A.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }), emitChanges: 'inline' });
 await h.plugin.onload();
 await h.edit('A.md', { next: '[[C]]' });
 assert.equal(h.writes.length, 0);
 assert.equal(h.fm('B.md').prev, '[[A]]');
 assert.equal(h.fm('C.md').prev, '[[D]]');
 assert.match(notices.at(-1), /conflict/i);
 await h.edit('A.md', {});
 assert.equal(h.fm('B.md').prev, undefined);
 assert.equal(h.fm('C.md').prev, '[[D]]');
});

test('inverse writes and no-ops preserve queued edits on other keys', async () => {
 for (const noop of [false, true]) {
  const h = setup({ 'A.md': {}, 'B.md': noop ? { prev: '[[A]]' } : {}, 'C.md': {} }, 'A.md', { emitChanges: 'inline', getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
  await h.plugin.onload();
  if (noop) void h.plugin.enqueueMutation(() => h.plugin.updateFrontmatterLink(h.file('B.md'), 'prev', '[[A]]'));
  else await h.edit('A.md', { next: '[[B]]' }, false);
  await h.edit('B.md', { ...(noop ? { prev: '[[A]]' } : {}), succ: '[[C]]' }, false);
  await h.drain();
  assert.equal(h.fm('C.md').pred, '[[B]]');
 }
});

test('inverse write seeds an unindexed existing target without replaying other properties', async () => {
 const h = setup({ 'A.md': {}, 'B.md': { succ: '[[C]]' }, 'C.md': {} }, 'A.md', { emitChanges: 'inline', getFileCache: (file, fm) => file.path === 'B.md' ? null : { frontmatter: fm(file.path) } });
 await h.plugin.onload();
 await h.edit('A.md', { next: '[[B]]' });
 assert.equal(h.fm('B.md').prev, '[[A]]');
 assert.equal(h.fm('C.md').pred, undefined);
});

test('inverse writes to new targets do not seed away their queued manual relations', async () => {
 const h = setup({ 'A.md': {}, 'C.md': {} }, 'A.md', { emitChanges: 'inline', getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
 await h.plugin.onload();
 await h.app.vault.create('B.md', 'Body');
 await h.edit('A.md', { next: '[[B]]' }, false);
 await h.edit('B.md', { succ: '[[C]]' }, false);
 await h.drain();
 assert.equal(h.fm('B.md').prev, '[[A]]');
 assert.equal(h.fm('C.md').pred, '[[B]]');
});

test('immediate deletion uses actual metadata, not the unsynchronized old snapshot', async () => {
 const h = setup({ 'A.md': { next: '[[D]]' }, 'B.md': { prev: '[[A]]', next: '[[C]]' }, 'C.md': { prev: '[[D]]' }, 'D.md': {} }, 'B.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
 await h.plugin.onload();
 let release;
 void h.plugin.enqueueMutation(() => new Promise(resolve => { release = resolve; }));
 await Promise.resolve();
 await h.edit('B.md', {}, false);
 await h.app.fileManager.trashFile(h.file('B.md'));
 release();
 await h.drain();
 assert.equal(h.fm('A.md').next, '[[D]]');
 assert.equal(h.fm('C.md').prev, '[[D]]');
 assert.equal(h.writes.length, 0);
});

for (const removing of [false, true]) {
 test(`native callback rechecks inverse ownership during ${removing ? 'removal' : 'retarget'}`, async () => {
  const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' }, 'C.md': {}, 'D.md': {} }, 'A.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
  await h.plugin.onload();
  const native = h.app.fileManager.processFrontMatter;
  h.app.fileManager.processFrontMatter = async (file, callback) => {
   if (file.path === (removing ? 'B.md' : 'C.md')) {
    h.content.set(file.path, `---\n${stringifyYaml({ prev: '[[D]]' })}---\nBody`);
   }
   return native(file, callback);
  };
  await h.edit('A.md', removing ? {} : { next: '[[C]]' });
  assert.equal(h.fm(removing ? 'B.md' : 'C.md').prev, '[[D]]');
  if (!removing) assert.equal(h.fm('B.md').prev, '[[A]]');
  assert.equal(h.plugin.sequenceSnapshots.get('A.md').frontmatter.next, '[[B]]');
 });
}

test('conflicted retarget retries on another source change without a resolve retry loop', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': { prev: '[[A]]' }, 'C.md': { prev: '[[D]]' }, 'D.md': {} }, 'A.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
 await h.plugin.onload();
 await h.edit('A.md', { next: '[[C]]' });
 const count = notices.length;
 h.events.resolved(); await h.drain();
 assert.equal(notices.length, count);
 h.content.set('C.md', '---\n{}\n---\nBody');
 await h.edit('A.md', { next: '[[C]]', tags: ['retry'] });
 assert.equal(h.fm('C.md').prev, '[[A]]');
 assert.equal(h.fm('B.md').prev, undefined);
});

for (const link of ['folder/B.md', './B', '../folder/B']) {
 test(`custom deleted repair recognizes ${link}`, async () => {
  const h = setup({ 'folder/A.md': { succ: `[[${link}]]` }, 'folder/B.md': { pred: '[[folder/A]]' } }, 'folder/A.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
  await h.plugin.onload();
  assert.equal(h.app.metadataCache.getFirstLinkpathDest(link, 'folder/A.md')?.path, 'folder/B.md');
  await h.app.fileManager.trashFile(h.file('folder/B.md'));
  await h.drain();
  assert.equal(h.fm('folder/A.md').succ, undefined);
 });
}

test('ordinary deleted repair does not overwrite a neighbor owned by another edge', async () => {
 const h = setup({ 'A.md': { next: '[[D]]' }, 'B.md': { prev: '[[A]]', next: '[[C]]' }, 'C.md': { prev: '[[B]]' }, 'D.md': {} }, 'B.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
 await h.plugin.onload();
 await h.app.fileManager.trashFile(h.file('B.md'));
 await h.drain();
 assert.equal(h.fm('A.md').next, '[[D]]');
 assert.equal(h.fm('C.md').prev, '[[A]]');
});

test('malformed values reject safely; disabled sync still preserves command integrity', async () => {
 const h = setup({ 'A.md': {}, 'B.md': {}, 'C.md': {} }, 'A.md', { emitChanges: 'inline' });
 await h.plugin.onload();
 for (const next of [['[[B]]', '[[C]]'], { bad: 'value' }, 12]) {
  await h.edit('A.md', { next });
  assert.equal(h.writes.length, 0);
 }
 await h.edit('A.md', {});
 h.plugin.settings.reciprocalLinks = false;
 await h.edit('A.md', { next: '[[B]]' });
 assert.deepEqual(h.fm('B.md'), {});
 await h.edit('A.md', {});
 await h.plugin.insertSelectedNoteAroundCurrent(h.file('A.md'), h.file('B.md'), 'after');
 await h.drain();
 assert.equal(h.fm('B.md').prev, '[[A]]');
});

test('settings reset baseline without writes; custom normal and command deletion repairs', async () => {
 const h = setup({ 'A.md': { later: '[[B]]' }, 'B.md': { earlier: '[[A]]', later: '[[C]]' }, 'C.md': { earlier: '[[B]]' } }, 'B.md', { emitChanges: 'delayed', getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
 await h.plugin.onload();
 h.plugin.settings.inverseRelations = 'later: earlier';
 await h.plugin.saveSettings();
 h.events.changed(h.file('A.md'), '', { frontmatter: {} });
 await h.drain();
 assert.equal(h.writes.length, 0);
 await h.app.fileManager.trashFile(h.file('B.md'));
 await h.drain();
 assert.equal(h.fm('A.md').later, '[[C]]');
 assert.equal(h.fm('C.md').earlier, '[[A]]');
 await h.plugin.deleteSequencedFile(h.file('C.md'));
 await h.drain();
 assert.deepEqual(h.fm('A.md'), {});
});

test('new file first edit syncs and missing target retries on resolve without polling', async () => {
 const h = setup({ 'A.md': {} }, 'A.md', { emitChanges: 'inline' });
 await h.plugin.onload();
 await h.app.vault.create('New.md', 'Body');
 await h.edit('New.md', { succ: '[[Later]]' });
 assert.equal(h.writes.length, 0);
 await h.app.vault.create('Later.md', 'Body');
 h.events.resolved();
 await h.drain();
 assert.equal(h.fm('Later.md').pred, '[[New]]');
 await h.edit('New.md', {});
 assert.equal(h.fm('Later.md').pred, undefined);
});

test('invalid persisted configuration falls back safely with a notice', async () => {
 const h = setup({ 'A.md': {}, 'B.md': {} });
 h.plugin.loadData = async () => ({ inverseRelations: '__proto__: next' });
 await h.plugin.onload();
 assert.match(notices.at(-1), /using defaults/);
 await h.edit('A.md', { succ: '[[B]]' });
 assert.equal(h.fm('B.md').pred, '[[A]]');
});

test('late first caches of existing unindexed files seed only; new files synchronize', async () => {
 const h = setup({ 'A.md': { next: '[[B]]' }, 'B.md': {} }, 'A.md', { getFileCache: () => null, emitChanges: 'inline' });
 await h.plugin.onload();
 h.events.changed(h.file('A.md'), '', { frontmatter: h.fm('A.md') });
 await h.drain();
 assert.equal(h.writes.length, 0);
 await h.app.vault.create('New.md', 'Body');
 await h.edit('New.md', { succ: '[[B]]' });
 assert.equal(h.fm('B.md').pred, '[[New]]');
});

test('renaming moves custom baseline and removal uses the new source path', async () => {
 const h = setup({ 'A.md': { succ: '[[B]]' }, 'B.md': { pred: '[[A]]' } }, 'A.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }), emitChanges: 'inline' });
 await h.plugin.onload();
 const file = h.file('A.md');
 h.files.delete(file.path);
 h.content.set('Renamed.md', h.content.get(file.path)); h.content.delete(file.path);
 file.path = 'Renamed.md'; file.basename = 'Renamed'; h.files.set(file.path, file);
 h.events.rename(file, 'A.md');
 assert.equal(h.plugin.sequenceSnapshots.has('A.md'), false);
 assert.equal(h.plugin.sequenceSnapshots.get(file.path).frontmatter.succ, '[[B]]');
 // Obsidian's link updater has also renamed incoming links.
 h.content.set('B.md', `---\n${stringifyYaml({ pred: '[[Renamed]]' })}---\nBody`);
 await h.edit(file.path, {});
 assert.equal(h.fm('B.md').pred, undefined);
});

test('toggle saves reset current-content baselines instead of replaying disabled edits', async () => {
 const h = setup({ 'A.md': {}, 'B.md': {} }, 'A.md', { getFileCache: (file, fm) => ({ frontmatter: fm(file.path) }) });
 await h.plugin.onload();
 h.plugin.settings.reciprocalLinks = false;
 await h.plugin.saveSettings();
 h.content.set('A.md', `---\n${stringifyYaml({ next: '[[B]]' })}---\nBody`);
 h.plugin.settings.reciprocalLinks = true;
 await h.plugin.saveSettings();
 h.events.changed(h.file('A.md'), '', { frontmatter: {} });
 await h.drain();
 assert.equal(h.writes.length, 0);
});

test('removal rejects a corrupt same-neighbor chain instead of writing self links', async () => {
 const h = setup({ 'A.md': { next: '[[B]]', prev: '[[B]]' }, 'B.md': { next: '[[A]]', prev: '[[A]]' } });
 await assert.rejects(h.plugin.removeCurrentNoteFromSequence(), /itself/);
 assert.equal(h.writes.length, 0);
});
