# Progress

> Living status doc. UPDATE the header in place; the Session Log is APPEND-ONLY (newest first). See CLAUDE.md.

## Current State
- ✅ PR #1 merged: standalone folders (chrome.storage.local), fixed automation selectors, XSS hardening, server folders.json fallback, README + hero banner.
- ✅ Context-management system established (CLAUDE.md, PROGRESS.md, ADR system) — this change.
- ✅ Folder colors & icons: optional `color`/`icon` fields per folder, curated allow-listed palette + emoji set, inline customize popover, injection-safe rendering, backward-compatible normalization (ADR-0003).
- ✅ Import / export folder structures (JSON): Export downloads a versioned `{version, exportedAt, data}` envelope; Import reads a file, validates/normalizes through `normalizeFolderData` + the color/icon sanitize allow-lists, and REPLACES the current folders after a `confirm()`. Offline-first, dependency-free (ADR-0004).

## Next Up
- [ ] Search and filter within folders
- [ ] Sync folders across devices
- [ ] Harden the experimental chat / generate automation against UI changes
- [ ] Firefox / Edge packaging

## Blocked / Open Questions
- None.

---

## Session Log (append-only, newest first)

### 2026-06-26 — Import / export folder structures (ADR-0004)
- Added **Export** and **Import** buttons to the sidebar header next to "New Root Folder".
- `exportFolders()` serializes the live folder structure into a versioned envelope `{ version: 1, exportedAt: <ISO>, data }`, pretty-prints it, and downloads it via a Blob + temporary `<a download>` named `notebooklm-folders-<YYYY-MM-DD>.json`, revoking the object URL after.
- `importFolders()` triggers a hidden `<input type="file" accept="application/json">`, reads the file with `FileReader`, `JSON.parse`s in try/catch, then validates via the pure `parseImportedFolders()` helper. It accepts either the enveloped form (`{ version, data }`) or a bare `{ folders: [...] }` structure, and runs the candidate through `normalizeFolderData` so every node's `color`/`icon` is forced onto the ADR-0003 sanitize allow-lists. Invalid/malformed files show a clear, non-throwing inline status and change nothing.
- Import semantics are **REPLACE after `confirm()`** ("This will replace your current folders. Continue?"); on accept it sets `folderData` and persists via the existing `saveFolders()` path (chrome.storage.local + re-render + optional server sync). Names/titles still render through `escapeHtml`.
- Styled `.nlm-btn-secondary` Export/Import buttons and the `.nlm-import-status` line in `content.css` to match the dark violet theme.
- Next: Search and filter within folders.

### 2026-06-26 — Folder colors & icons (ADR-0003)
- Added optional `color` and `icon` fields to the folder data model. New folders seed sensible defaults; `normalizeFolderData` default-fills both fields recursively so folders stored before this feature keep rendering.
- Curated, dependency-free presets: an 8-color palette and a 12-emoji set, both used as allow-lists. `sanitizeFolderColor`/`sanitizeFolderIcon` reject anything not in the list before it reaches `innerHTML` or an inline `style`, closing the CSS/HTML injection vector.
- `renderFolderNode` now shows the chosen emoji before the name and applies the color as an icon tint + left-border accent.
- Added a per-folder 🎨 "customize" button that opens an inline popover (reusing the dropdown pattern + the global click-to-close handler) with color swatches and emoji buttons; selecting one updates the folder, calls `saveFolders()`, and re-renders. Persistence reuses the existing `chrome.storage.local` path; optional server sync unaffected.
- Styled the popover, swatches, and icon picker in `content.css` to match the dark violet glassmorphism theme (Outfit font, existing CSS variables).
- Next: Import / export folder structures (JSON).

### 2026-06-26 — Foundation: context-management system
- Added CLAUDE.md with context-window-management rules and the ADR + PROGRESS workflow.
- Created PROGRESS.md and the docs/adr/ system (template, index, ADR-0001, ADR-0002).
- Decisions recorded: ADR-0001 (adopt ADRs), ADR-0002 (offline-first folders via chrome.storage.local — documenting the choice already shipped in PR #1).
