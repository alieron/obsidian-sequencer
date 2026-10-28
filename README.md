# Sequencer

Sequencer helps you move through a set of notes in a fixed order. It stores the order with two frontmatter properties, `prev` and `next`, so your notes stay normal Markdown files and the sequence remains easy to inspect or edit by hand.

Use it for reading lists, lesson notes, project logs, daily workflows, drafts, or any folder where "previous" and "next" are more useful than a loose collection of links.

## How It Works

Each note can point to the note before it and the note after it:

```md
---
prev: "[[Chapter 1]]"
next: "[[Chapter 3]]"
---
```

When a note has either `prev` or `next`, Sequencer adds previous and next arrow buttons to the note header. Click an arrow to open the linked note, or Ctrl-click/Cmd-click to open it in a new tab.

Sequence properties accept a string or a singleton string list (for example, `next: ["[[Chapter 3]]"]`). Multi-target lists are not supported.

## Getting Started

1. Open the first note in your sequence.
2. Run **Sequencer: Insert note after current note** from the command palette.
3. Choose an existing note, or type a new note name to create one.
4. Move to the next note and repeat until the sequence is complete.

Sequencer writes the matching links needed to keep the chain connected. For example, inserting `Chapter 2` after `Chapter 1` adds `next: "[[Chapter 2]]"` to `Chapter 1` and `prev: "[[Chapter 1]]"` to `Chapter 2`.

## Commands

The legacy **Add link to previous note** and **Add link to next note** commands now insert notes before or after the current note, including reconnecting neighbors. Targets already connected to another sequence are rejected; remove them from that sequence first. Selecting the existing neighbor is a no-op.

### Insert Note Before Current Note

Command palette name: **Sequencer: Insert note before current note**

Opens a note picker and inserts the chosen note immediately before the current note. Sequencer updates the chosen note, the current note, and the previous neighbor so the chain stays connected.

If the chosen note does not exist yet, type its name in the picker to create it.

### Insert Note After Current Note

Command palette name: **Sequencer: Insert note after current note**

Opens a note picker and inserts the chosen note immediately after the current note. Sequencer updates the current note, the chosen note, and the next neighbor so the chain stays connected.

If the chosen note does not exist yet, type its name in the picker to create it.

### Delete Current Note From Sequence

Command palette name: **Sequencer: Delete current note from sequence**

Deletes the current note and reconnects its previous and next notes. Sequencer asks for confirmation by default, and the confirmation dialog includes an option not to ask again.

### Remove Current Note From Sequence

Command palette name: **Sequencer: Remove current note from sequence**

Removes the current note from the sequence without deleting the file. Sequencer clears the current note's `prev` and `next` properties, then reconnects the previous and next notes around it.

### Unlink Current Note From Sequence

Command palette name: **Sequencer: Unlink current note from sequence**

Does the same thing as **Remove current note from sequence**. This alias exists so the command is easier to find by either term.

## Navigation

Sequencer shows arrow buttons in the note header when the open note has sequence frontmatter:

<p align="center">
	<img src="assets/prev_next_arrows.png" alt="Previous and next note arrows">
</p>

- Previous arrow: opens the note in `prev`
- Next arrow: opens the note in `next`
- Ctrl-click or Cmd-click: opens the target note in a new tab

If a linked note cannot be found, Sequencer shows a notice instead of changing notes.

## Settings

### Automatically Sync Inverse Properties

When enabled, manual frontmatter edits synchronize the matching inverse property. For example, setting `A.next` to `[[B]]` sets `B.prev` to `[[A]]`; editing `B.prev` works in the other direction too. Removing or retargeting a link clears only its matching old reciprocal. Turning this off disables manual synchronization, not the explicit insert/remove/delete commands: those always maintain the `next`/`prev` chain.

### Inverse Relations

Configure one `forward: reverse` pair per nonempty line. Defaults:

```text
next: prev
succ: pred
```

Names are case-sensitive and may contain spaces. Each property can belong to only one pair; identical keys, duplicate/overlapping pairs, dangerous object keys, and ambiguous punctuation are rejected. Invalid saved configuration falls back to the defaults with a notice. An empty configuration disables manual inverse pairs. Commands and arrow navigation still use `next` and `prev`, regardless of configured custom pairs.

Only scalar strings and singleton string lists are supported; malformed or multi-target properties are rejected without guessing. Links resolve relative to the source note and can include aliases or headings. Synchronization never overwrites an occupied inverse pointing elsewhere: a conflict notice is shown before changing either target. Your manual source edit is retained, so resolve the conflict explicitly. Unrelated properties are preserved.

This is **one-hop inverse synchronization**, not transitive closure or a general graph engine. Startup captures baselines without migrating existing notes. Changing the configuration resets baselines from current note contents, without rewriting the vault. Missing targets are skipped with a notice and retried when Obsidian finishes resolving metadata, without polling. Repeated or delayed metadata events use fresh note contents; command writes and synchronization are serialized to avoid treating intermediate chain states as manual edits.

### Only Show Sibling Notes

When enabled, the note picker only suggests notes in the same folder as the current note. This keeps sequence-building focused when your vault has many notes.

Turn this off if your sequences often cross folder boundaries.

### Repair Sequences When Deleting Notes

When enabled, Sequencer watches for normal Obsidian file deletes. If a deleted note had `prev`/`next` or configured custom inverse links, Sequencer reconnects the neighboring notes automatically. Explicit sequence deletion also repairs custom pairs. Remove/unlink commands only detach the default `next`/`prev` sequence; custom pairs have no navigation or insert commands.

Repair uses Obsidian's previous metadata, falling back to lightweight sequence metadata snapshots captured at startup and refreshed on metadata changes. If a note was never indexed and neither source is available, Sequencer shows a notice instead of guessing its neighbors.

Multi-file writes are not transactional: a native write or trash failure can leave earlier successful writes in place. Conflicting, malformed, or missing relationships require manual correction; the plugin does not scan incoming links to reconstruct an unknown chain.

### Confirm Sequence Note Deletion

When enabled, **Delete current note from sequence** asks before deleting the note. Turn this off if you want the command to delete and reconnect immediately.

## Frontmatter Example

This sequence:

```text
Chapter 1 <-> Chapter 2 <-> Chapter 3
```

is stored like this:

```md
<!-- Chapter 1.md -->
---
next: "[[Chapter 2]]"
---
```

```md
<!-- Chapter 2.md -->
---
prev: "[[Chapter 1]]"
next: "[[Chapter 3]]"
---
```

```md
<!-- Chapter 3.md -->
---
prev: "[[Chapter 2]]"
---
```

## Tips

- Keep each sequence in one folder if you want the note picker to stay compact.
- Use clear note names so the previous and next arrows are easy to follow.
- You can edit `prev` and `next` manually if you need to repair or reshape a sequence.
