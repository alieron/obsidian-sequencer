# Obsidian Sequencer

Adds a way to navigate through your notes sequentially using links to previous and next notes.

Use the `prev` and `next` frontmatter properties to set the links.

Example:
In a.md
```md
---
next: "[[b]]"
---
```

In b.md
```md
---
prev: "[[a]]"
next: "[[c]]"
---
```

In c.md
```md
---
prev: "[[b]]"
---
```

Creates a sequence where a <-> b <-> c