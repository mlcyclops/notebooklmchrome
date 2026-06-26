# ADR-0005: Search and filter within folders

**Status:** Accepted
**Date:** 2026-06-26

## Context

As users accumulate folders, nested subfolders, and many notebooks, scanning the
sidebar tree by eye becomes slow. There is currently no way to narrow the view to
the folders or notebooks a user is looking for; they must manually expand branches
and read every label.

The folder structure already lives fully in memory (`folderData.folders`) and the
notebook list in `notebooksList`, both populated before render. The sidebar is
re-rendered from these in-memory structures on every change via `renderSidebar()`
and the recursive `renderFolderNode()`. This gives us everything needed to filter
locally without any new network round-trips or storage.

The extension is offline-first (ADR-0002): folders persist in
`chrome.storage.local` and the optional companion server is not required. A search
feature must respect that and not introduce a hard dependency on any backend.

## Decision

We will add a **client-side, in-memory search/filter** input to the sidebar header.

- **Input.** A `<input type="search">` sits in the sidebar header (below the
  Export/Import row), styled to the dark violet theme, with a clear ("×") button
  that resets the filter. The `input` event handler is **debounced (~180ms)** so
  re-renders don't fire on every keystroke.
- **Query state.** The current query is held in module state (`searchQuery`). It is
  **not persisted** (no `chrome.storage`, no network) and is cleared on a fresh
  page load — an empty query produces the normal full render.
- **Filtering is a pure, in-memory predicate.** A recursive
  `nodeMatchesQuery(node, q)` checks whether a folder's own name matches
  (case-insensitive substring) OR any notebook assigned to it matches OR any
  descendant folder matches (recursing through the same `parentId` /
  `notebookIds` assignment logic the normal render uses). `renderSidebar()` /
  `renderFolderNode()` consult `searchQuery`:
  - A folder node renders if it matches directly or has any matching descendant.
  - A notebook (in a folder or in the unorganized list) renders if its title
    matches.
  - **Ancestor preservation:** because a folder renders whenever a descendant
    matches, the ancestors of any match stay visible and are forced **expanded**
    so the match is reachable; non-matching siblings are hidden. A folder whose
    own name matches shows all of its children.
- **No data mutation.** Filtering operates only on the existing in-memory
  `folderData` + `notebooksList` and changes what is rendered. It never mutates or
  re-persists stored folder data; clearing the query restores the full tree.
- **Empty state.** When a non-empty query matches nothing, a gentle "No matches"
  message is shown instead of an empty pane.
- **Injection-safe highlighting.** Matching substrings in folder names / notebook
  titles are highlighted. Highlighting is built **escape-then-wrap**: the text is
  first run through `escapeHtml`, and the match is located/wrapped in the already
  escaped string. User text is never placed into `innerHTML` raw, preserving the
  XSS hardening from prior ADRs.
- **Drag-and-drop while filtered.** Filtering is purely visual; drag-and-drop still
  operates on the real underlying data. Only currently rendered (matching) nodes
  are droppable/draggable, which keeps behaviour sane without special-casing.

## Consequences

- **Positive:** Fast, fully offline narrowing of large trees; no network, no new
  storage, no schema change. Reuses existing render and escaping paths, so the XSS
  posture is unchanged. The pure predicate is unit-testable in Node.
- **Positive:** Ancestor preservation makes deep matches reachable without the user
  manually expanding branches.
- **Negative:** A very large tree re-filters and re-renders on each (debounced)
  keystroke; acceptable at expected sidebar sizes but not virtualized.
- **Neutral:** Highlighting adds a small escape-then-wrap helper; it only ever
  operates on already escaped strings.

## Alternatives Considered

- **Server-side search.** Rejected: overkill and breaks offline-first — the data is
  already in memory and the companion server is optional.
- **Fuzzy / typo-tolerant matching.** Deferred: substring, case-insensitive
  matching is simpler, predictable, and dependency-free. Fuzzy matching can be a
  later increment if needed.
- **Persisting the query / filter state.** Rejected: a transient view filter
  shouldn't outlive the session or sync to storage.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: none.
