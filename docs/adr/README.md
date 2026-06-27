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
| 0008 | [Premium UI/UX redesign and trustworthy notebook states](0008-premium-ui-ux-and-trustworthy-notebook-states.md) | Accepted | 2026-06-26 |
