# Architecture Decision Records

This directory holds the project's Architecture Decision Records (ADRs) — durable,
numbered notes capturing significant architectural and product decisions and the
reasoning behind them. They give future sessions a source of truth that survives
context-window resets. See [`../../CLAUDE.md`](../../CLAUDE.md) for the full workflow.

**Process (mirrors CLAUDE.md):**

- One ADR per significant decision, named `NNNN-kebab-title.md` with the next
  sequential, zero-padded number.
- ADRs are **append-only and immutable once Accepted** — never rewrite an Accepted
  ADR. To change a decision, add a new ADR and mark the old one
  "Superseded by ADR-XXXX".
- Statuses: `Proposed` → `Accepted` → `Superseded` / `Deprecated`.
- Start from [`template.md`](template.md).
- **Append a row to the index below for every new ADR.**

## Index

| #    | Title                                                                                   | Status   | Date       |
| ---- | --------------------------------------------------------------------------------------- | -------- | ---------- |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)                  | Accepted | 2026-06-26 |
| 0002 | [Offline-first folders via chrome.storage.local](0002-offline-first-folders-via-chrome-storage.md) | Accepted | 2026-06-26 |
| 0003 | [Folder colors and icons](0003-folder-colors-and-icons.md)                              | Accepted | 2026-06-26 |
| 0004 | [Import / export folder structures (JSON)](0004-import-export-folder-structures.md)     | Accepted | 2026-06-26 |
| 0005 | [Search and filter within folders](0005-search-and-filter-within-folders.md)            | Accepted | 2026-06-26 |
| 0006 | [Sync folders across devices](0006-sync-folders-across-devices.md)                       | Accepted | 2026-06-26 |
| 0008 | [Premium UI/UX redesign and trustworthy notebook states](0008-premium-ui-ux-and-trustworthy-notebook-states.md) | Accepted | 2026-06-26 |
| 0009 | [Brand assets, knowledge-graph positioning, and the Atlas roadmap](0009-brand-assets-and-knowledge-graph-direction.md) | Accepted | 2026-06-26 |
| 0010 | [Harden the experimental chat/generate automation against UI changes](0010-harden-chat-generate-automation.md) | Accepted | 2026-06-26 |
| 0011 | [Export the library as a knowledge graph (JSON / GraphML)](0011-knowledge-graph-export.md) | Accepted | 2026-06-26 |
| 0012 | [Cross-browser packaging (Chrome, Edge, Firefox)](0012-cross-browser-packaging.md) | Accepted | 2026-06-26 |
| 0013 | [Automation pipelines (podcast, study packs) and watch mode](0013-automation-podcast-study-watch.md) | Accepted | 2026-06-26 |
