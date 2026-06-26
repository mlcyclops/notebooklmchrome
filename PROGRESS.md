# Progress

> Living status doc. UPDATE the header in place; the Session Log is APPEND-ONLY (newest first). See CLAUDE.md.

## Current State
- ✅ PR #1 merged: standalone folders (chrome.storage.local), fixed automation selectors, XSS hardening, server folders.json fallback, README + hero banner.
- ✅ Context-management system established (CLAUDE.md, PROGRESS.md, ADR system) — this change.

## Next Up
- [ ] Folder colors & icons
- [ ] Import / export folder structures (JSON)
- [ ] Search and filter within folders
- [ ] Sync folders across devices
- [ ] Harden the experimental chat / generate automation against UI changes
- [ ] Firefox / Edge packaging

## Blocked / Open Questions
- None.

---

## Session Log (append-only, newest first)

### 2026-06-26 — Foundation: context-management system
- Added CLAUDE.md with context-window-management rules and the ADR + PROGRESS workflow.
- Created PROGRESS.md and the docs/adr/ system (template, index, ADR-0001, ADR-0002).
- Decisions recorded: ADR-0001 (adopt ADRs), ADR-0002 (offline-first folders via chrome.storage.local — documenting the choice already shipped in PR #1).
