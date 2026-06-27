# Progress

> Living status doc. UPDATE the header in place; the Session Log is APPEND-ONLY (newest first). See CLAUDE.md.

## Current State
- ✅ PR #1 merged: standalone folders (chrome.storage.local), fixed automation selectors, XSS hardening, server folders.json fallback, README + hero banner.
- ✅ Context-management system established (CLAUDE.md, PROGRESS.md, ADR system) — this change.
- ✅ Folder colors & icons: optional `color`/`icon` fields per folder, curated allow-listed palette + emoji set, inline customize popover, injection-safe rendering, backward-compatible normalization (ADR-0003).
- ✅ Import / export folder structures (JSON): Export downloads a versioned `{version, exportedAt, data}` envelope; Import reads a file, validates/normalizes through `normalizeFolderData` + the color/icon sanitize allow-lists, and REPLACES the current folders after a `confirm()`. Offline-first, dependency-free (ADR-0004).
- ✅ Search and filter within folders: debounced `<input type="search">` in the sidebar header filters the folder tree + unorganized list client-side, in memory, via a pure recursive `nodeMatchesQuery` predicate (folder name OR assigned notebook title OR descendant match; case-insensitive substring). Ancestors of a match stay visible/expanded; non-matching branches hide. Clear "×" button resets; empty query = full render; "No matches" empty state. Injection-safe escape-then-wrap highlighting. No data mutation/persistence (ADR-0005).
- ✅ Sync folders across devices: opt-in cross-device sync built on `chrome.storage.sync` (no companion server, no new permissions). A sidebar header toggle persists `nlm_sync_enabled` in `chrome.storage.local` (default OFF). `chrome.storage.local` stays the always-present render source; when sync is ON, `writeFoldersToStorage` mirrors the same `nlm_folders` value into `chrome.storage.sync`, and a `chrome.storage.onChanged` listener (area `sync`) pulls remote edits into local + re-renders live (loop-guarded). A quota/error on a sync write degrades gracefully to local-only — keeps data, reverts the toggle, and surfaces a calm "Folder set too large to sync — kept locally" status. Last-write-wins conflict policy; CRDT/merge deferred (ADR-0006).

## Next Up
- ✅ ADR-0008 increment 1 — trustworthy notebook detection (VERIFIED LIVE: full ~80 owned notebooks render). Authenticated **`wXbhsf`** ("My notebooks") RPC with WIZ tokens (`SNlM0e`/`FdrFJe`/`cfb2h`) and the page's real query args (empty `[]` returns only a recent subset; `ub2Bae` returns the Featured gallery — both wrong). Tolerant chunked-response parser, field mapping (`title=[0]`, `id=[2]`, `sourceCount=[1].length`, `icon=[3]`), DOM-scan fallback, and honest loading / error+retry / verified-empty states replacing the always-on "No unorganized notebooks" string.
- 🚧 ADR-0008 increment 2 IN PROGRESS: premium UI overhaul. `content.css` fully rewritten with a design-system (color/elevation/radius/motion tokens), one motion language, and rich hover/focus/active states — folder & notebook icons "pop" (scale+tilt+glow) on hover, buttons lift, dropdowns/popovers animate, online status pulses, `prefers-reduced-motion` fully covered. CSS-only; markup, class names, and data model untouched. Needs live visual confirmation.

## Next Up
- [ ] Confirm increment 2 visually on the live page; iterate on spacing/feel per user taste
- [ ] Quiet the `localhost:3000/status` console spam (optional server poll; browser logs ERR_CONNECTION_REFUSED every 5s)
- [ ] Search and filter within folders
- [ ] Harden the experimental chat / generate automation against UI changes
- [ ] Firefox / Edge packaging

## Blocked / Open Questions
- None.

---

## Session Log (append-only, newest first)

### 2026-06-26 — Sync folders across devices (ADR-0006)
- Implemented opt-in cross-device folder sync on `chrome.storage.sync` — no companion server, no new permissions (existing `storage` permission covers it). See ADR-0006.
- Added a sync toggle (theme-styled switch) + a small status line to the sidebar header. The opt-in flag persists in `chrome.storage.local` under `nlm_sync_enabled` (default OFF, so existing behavior is unchanged until a user opts in); an in-memory `syncEnabled` mirror lets synchronous write/onChanged paths consult it without an async round-trip.
- `writeFoldersToStorage` now always writes local first (offline source of truth), then — only when sync is ON — mirrors the same `nlm_folders` value to `chrome.storage.sync` via `writeFoldersToSync`, wrapped in try/catch + `chrome.runtime.lastError` checks. On a quota/error (`QUOTA_BYTES_PER_ITEM_EXCEEDED`), `handleSyncDegradation` keeps local data, reverts the toggle to OFF, and surfaces a calm "Folder set too large to sync — kept locally" status. Never throws into the page, never loses data.
- `readFoldersFromStorage` is unchanged (local stays the render source). Remote edits flow IN via a single `chrome.storage.onChanged` listener (area `sync`): on a folders-key change while sync is enabled it writes the value into local, reloads `folderData`, and re-renders (honoring the active search query). A JSON-equality loop guard ignores echoes of our own write; non-sync areas and the disabled state are ignored.
- Enabling sync migrates the current local folders up to sync (first write through `writeFoldersToSync`); disabling just stops mirroring. Conflict policy is last-write-wins via onChanged; CRDT/merge deferred. Import still routes through `saveFolders` so it propagates to sync when enabled. All existing features (colors/icons, import/export, search) untouched.
- While rebasing onto the ADR-0008 merge I found a pre-existing botched-merge bug in `renderSidebar` (duplicate `const unorganized` at two lines → `node --check` SyntaxError, present on `origin/main`). Resolved the obvious mis-merge by keeping the canonical ADR-0008 `renderUnorganizedState(unorganized)` path (loading/error/verified-empty states) and dropping the duplicated inline ADR-0005 block, preserving the search filter. Flagged for review.
- Tested: `node --check` on all JS + manifest JSON parse (pass after the merge fix); headless Chromium load via Playwright (MV3 service worker registers, no page/load errors); a Node unit harness mocking `chrome.storage.local`/`.sync`/`.onChanged`/`runtime.lastError` and replicating the pure logic — 16/16 assertions pass (sync OFF → local only; sync ON → mirrors to sync; simulated quota error degrades to local-only without throwing and surfaces the status; onChanged from `sync` updates local + triggers re-render; loop guard / non-sync area / disabled all ignored). Real multi-device propagation is browser-gated and can't be exercised headlessly.
- Next: Harden the experimental chat / generate automation against UI changes.

### 2026-06-26 — Search and filter within folders (ADR-0005)
- Added a debounced (~180ms) `<input type="search">` with a clear ("×") button to the sidebar header, styled to the dark violet theme in `content.css`.
- Introduced transient module state `searchQuery` (lowercased, never persisted). `renderSidebar()` / `renderFolderNode()` consult it and the unorganized list filters by title; an empty/cleared query restores the full tree.
- Implemented pure helpers: `nodeMatchesQuery(node, q, allFolders, notebooks)` (folder name OR an assigned notebook title OR any descendant folder matches — reuses the same `parentId` / `notebookIds` assignment the normal render uses), `notebookMatchesQuery`, and an injection-safe `highlightMatch` (escape FIRST via `escapeHtml`, then wrap matches in `<mark class="nlm-search-hl">` on the already escaped string). No raw user text reaches innerHTML.
- Ancestor preservation falls out of the predicate: a folder renders whenever a descendant matches, so ancestors of a match stay visible; non-matching siblings hide. A folder whose own name matches shows all its children. Filtering is purely visual — it never mutates or re-persists `folderData`; drag-and-drop still operates on the real data.
- Added a gentle "No matches" state when an active query matches nothing.
- Tested: `node --check` on all JS + manifest JSON parse (pass); headless Chromium load via Playwright (service worker registers, no load errors); a Node unit harness replicating the pure predicate/highlight logic — 16/16 assertions pass (folder-name match, nested-notebook match keeps ancestors, non-matching branches hidden, empty query returns all, case-insensitive substring, and highlight escapes a `<script>`-style name with no raw HTML).
- Next: Sync folders across devices.
### 2026-06-26 — Fix: customize popover (clip → hover-hide → click-through) (ADR-0008, increment 2)
- Three layered regressions on the 🎨 customize popover, all fixed in CSS:
  1. **Clipped**: `overflow: hidden` on `.nlm-folder-header` (added for the hover sheen) clipped the popover. Fix: removed it; gave `::before` `border-radius: inherit`.
  2. **Hover-hide**: popover is a child of the hover-revealed `.nlm-folder-actions`; moving toward it left the header :hover and faded it out. Fix: `:has(.nlm-dropdown.show)` pins the actions container visible.
  3. **Click-through**: later rows paint after the popover's owner row and intercepted clicks. Fix: `.nlm-folder:has(.nlm-dropdown.show)` / `.nlm-notebook-item:has(...)` get `position: relative; z-index: 50` to lift above siblings.
- Same rules also harden the move-notebook (📂) popover. CSS braces 106/106.

### 2026-06-26 — UI polish: remove status dot, widen sidebar (ADR-0008, increment 2)
- Removed the header server-status dot (the red dot) from markup + CSS (deleted `.nlm-sync-status` rules and `nlm-pulse` keyframes). Decoupled `checkServerStatus()` from that element so the optional companion-server feature (`isConnected`) still works headlessly.
- Widened the slide-out from 320px → 372px (updated the three coupled values: sidebar width, closed `left`, and toggle `.open` left). Helps long notebook/folder titles.
- `node --check` clean; CSS braces 104/104.

### 2026-06-26 — Accordion-collapsible folders (ADR-0008, increment 2)
- Folders now collapse/expand by clicking the header. Added a rotating chevron (down=open, right=collapsed), shown only when a folder has children/notebooks.
- Collapse state held in an in-memory `collapsedFolders` Set (survives re-renders, resets on reload) — deliberately NOT persisted to the folder data model, per ADR-0002/0003/0008 storage contract.
- Markup: wrapped children in `.nlm-folder-children-inner`; animate via `grid-template-rows: 1fr↔0fr` (smooth for unknown heights), guide line fades on close. Click handler toggles classes on existing DOM (not a full re-render) so it animates; action buttons/dropdown clicks are excluded.
- Reduced-motion: chevron + accordion added to the no-animation block. `node --check` clean; CSS braces 110/110.

### 2026-06-26 — Premium UI design-system (ADR-0008, increment 2, pass 1)
- Rewrote `extension/content.css` around a token-based design system: surfaces, accent ramp, semantic colors, radius scale, 3-step elevation, and a single motion language (`--nlm-ease` expo-out + 3 durations).
- Interaction polish on every element: sidebar slide w/ accent seam, toggle glow, primary "+" rotates on hover, folder/notebook **icons pop** (scale + tilt + drop-shadow glow) on hover, rows lift/translate, action buttons reveal with slide+fade, dropdown scales from origin, color swatches glow, online sync dot pulses.
- Accessibility: `:focus-visible` rings scoped to our UI; comprehensive `prefers-reduced-motion` block neutralizes transitions/animations and motion-on-hover.
- Deliberately NO per-item entrance animations — `renderSidebar()` rebuilds innerHTML on every action, so replaying entrances would read as jank.
- Brace-balanced (104/104); `node --check` clean on JS. Headless-Chromium load NOT run (Linux CI path absent on Windows) — needs live visual confirmation.

### 2026-06-26 — Correct RPC + args: full owned list renders (ADR-0008, increment 1 DONE)
- Correction to the previous entry: `ub2Bae` returns the **Featured gallery** (Shakespeare, Sherlock, etc.), not the user's notebooks. The user's own notebooks come from **`wXbhsf`**.
- `wXbhsf` with empty `[]` returns only a small recent subset (2). The home page sends real query args: `[null,1,null,[2,null,null,[1,null,null,null,null,null,null,null,null,null,[1]]],null,[[null,null,[]],[[]],[null,[]]]]` — wired verbatim into `rpcArgs`.
- Verified live (screenshot): all ~80 owned notebooks now populate the Unorganized list ("The Agent2Agent Protocol", "Loop Engineering", "Agent Tools…"). Original bug fully resolved.
- Reference (for future sessions): NotebookLM list RPCs — `wXbhsf` = My notebooks (needs the args above), `ub2Bae` = Featured gallery. Entry shape: `[title, [sources], notebookId, emoji, …]`.

### 2026-06-26 — Detection verified live: 32 notebooks (ADR-0008, increment 1 COMPLETE)
- Network-tab capture on the home page showed the real list RPC is `ub2Bae` (not `wXbhsf`, which returns only recently-opened notebooks with full sources). Its first arg is a **mode selector**: `2` = Featured gallery, `1` = the user's own "My notebooks".
- Switched the call to `ub2Bae` with args `[[1,null,null,[1,...,[1]]]]`. Live result: `RPC returned 32 notebooks (data frame: true)`, detection `ok`, sidebar Unorganized list populated with the user's real notebooks.
- All temporary diagnostics confirmed removed (`grep` clean). Increment 1 closed.
- Known cosmetic: `localhost:3000/status` polling logs `ERR_CONNECTION_REFUSED` every 5s when the optional companion server is offline (browser-level network log; can be throttled later).
- Next: ADR-0008 increment 2 — premium design system, motion language, rich folder/icon hover states.

### 2026-06-26 — Notebook field mapping locked in (ADR-0008, increment 1 follow-up 3)
- Captured the real `wXbhsf` payload shape. A **notebook entry** = `[ title:string, sources:array, notebookId:idToken, emoji:string, … ]`; a **source row** = `[ [uuid], title, [meta], … ]` (note: `[0]` is an array for sources, a string for notebooks). This is why earlier heuristics grabbed source ids/titles.
- Final `extractNotebooksFromRPC`: matches `typeof [0]==='string' && Array.isArray([1]) && isId([2])`, reading `title=[0]`, `id=[2]`, `sourceCount=[1].length`, `icon=[3]`. All temporary diagnostics removed.
- **Open question (completeness):** `wXbhsf` with empty args returned only **2** notebooks ("Animal Versus Artificial Intelligence", "Invention Of The Lightbulb") — neither in the user's original full home list. Likely a recent/subset, not list-all. Next: capture the home page's real list `batchexecute` rpcid from the Network tab (args probably carry paging/scope) and switch to it, or page through.

### 2026-06-26 — Notebook title mapping (ADR-0008, increment 1 follow-up 2)
- Authenticated RPC confirmed working live: `RPC returned 6 notebooks (data frame: true)`, detection `ok`, sidebar Unorganized list populated.
- Bug: titles rendered as id tokens because `extractNotebooksFromRPC` assumed the title is at `arr[1]`, which is an id-like field in NotebookLM rows.
- Rewrote the parser: `isId`/`isHumanTitle` helpers + `bestTitle()` picks the longest human-readable string (whitespace or non-id char) in each id row instead of a fixed index. Logs up to 2 "id row without a human title" samples for diagnostics.
- Open: only 6 returned vs. a larger home list (possible pagination/secondary rpc) — revisit after titles confirmed. `localhost:3000/status` console spam (optional server offline) still to be quieted.

### 2026-06-26 — Authenticated list RPC (ADR-0008, increment 1 follow-up)
- Live test surfaced the real detection failure: the `wXbhsf` batchexecute call returned **HTTP 400** (missing XSRF token) and the DOM scan found 0 (list-view rows expose no `/notebook/<id>` in attributes).
- `fetchNotebooksList()` now builds an authenticated request: `getWizParam()` text-scans the page HTML for `SNlM0e` (sent as `at` in the body), `FdrFJe` (`f.sid`), and `cfb2h` (`bl`); query adds `_reqid` + `rt=c`. Added a rolling `rpcReqId`.
- Added `extractNotebooksFromBatch()` — tolerant parser for the `)]}'` chunked response; unwraps the nested `wrb.fr` JSON string and recurses via `extractNotebooksFromRPC`. Returns `{ notebooks, sawFrame }`; `rpcOk` is set only when a real data frame is seen, so a stale rpcid (200, no frame) doesn't masquerade as a verified-empty account.
- `node --check` passes. Awaiting live confirmation of the `NotebookLM Folderizer:` console output to confirm the `at`-token fix clears the 400.

### 2026-06-26 — Trustworthy notebook detection & states (ADR-0008, increment 1)
- Accepted ADR-0008 (Premium UI/UX redesign and trustworthy notebook states). Renumbered from a draft 0004→0005→0008 after rebasing onto origin/main (upstream had taken 0004 for import/export); 0005–0007 left as reserved gaps per request.
- Root cause of "No unorganized notebooks" while the home is full: `notebooksList` came back empty because the list RPC (`wXbhsf`) could fail and the only DOM fallback matched `<a href="/notebook/…">` anchors, which the list view doesn't expose. The empty branch then hardcoded "No unorganized notebooks", conflating *failed*, *loading*, and *truly zero*.
- Added a `notebooksStatus` lifecycle (`idle`/`loading`/`ok`/`error`). `fetchNotebooksList()` now tries the RPC then always merges in a structural DOM scan (`scrapeNotebooksFromDom`) that reads notebook URLs from *any* attribute on *any* element (not just anchors), deduped by id. Status is `ok` when the RPC succeeds or anything is found; `error` only when the RPC failed *and* nothing was scraped (ambiguous → offer retry, don't claim empty).
- `refreshData()` sets `loading` and renders immediately before fetching. `renderUnorganizedState()` renders four honest states: shimmer skeletons (loading), ⚠️ message + **Retry** button (error), 🎉 "Everything's filed away" (verified empty), or the notebook list.
- CSS: added skeleton shimmer, message block, retry button (token-based, dark violet theme), entrance fade, and a `prefers-reduced-motion` guard that disables the non-essential animations.
- Tested: `node --check` passes on content.js/background.js/server.js; manifest.json parses. Headless-Chromium load NOT run (checklist targets a Linux CI chromium path absent on this Windows box) — needs verification on the live page.
- Next: ADR-0008 increment 2 — the full design-system + animation/hover overhaul.

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
