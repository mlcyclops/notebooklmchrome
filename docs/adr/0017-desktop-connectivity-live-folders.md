# ADR-0017: Desktop connectivity and live folders from the extension

**Status:** Accepted
**Date:** 2026-06-27

## Context

In the installed desktop app, Atlas showed "No extension" and an empty library even
though the user had folders and notebooks in NotebookLM. Root causes:

1. **Folders came from `folders.json`, not the extension.** The server read folders
   from a server-side file that does not exist in a fresh install, while the user's
   real folders live in the extension's `chrome.storage.local`. So even with the
   extension connected, Atlas could not see the user's folders.
2. **No clear path to connect the extension.** The desktop installer did not ship
   the extension, so a packaged-app user had nothing to "Load unpacked", and the app
   gave no guidance. Notebooks (which are relayed through the extension) therefore
   never appeared.
3. **Hidden port mismatch.** The extension connects only to `ws://localhost:3000`,
   but the desktop app silently fell back to another port if 3000 was busy, and the
   Atlas status text was hardcoded to "localhost:3000", so a mismatch was invisible.

## Decision

- **Serve live folders from the extension.** The content script answers a new
  `list_folders` relay message with `chrome.storage.local` folders. The server gains
  `getFoldersLive()` and `getFolders()` (prefer live extension folders, fall back to
  `folders.json`). `GET /api/folders`, the knowledge graph, and the automation
  snapshot all use it, so Atlas shows the folders that actually exist.
- **Bundle the extension and guide the user.** electron-builder ships `extension/`
  as an unpacked `extraResources` folder. A Help menu item, "Connect the
  extension...", explains the steps and opens that folder. Atlas itself shows a
  connect hint (load the extension, open NotebookLM) whenever no extension is
  connected.
- **Make the port honest.** `/status` reports the real `port`; Atlas shows
  `location.host` instead of a hardcoded value; and the desktop app warns when it
  could not bind 3000 (the port the extension requires).

## Consequences

- **Positive:** With the extension loaded and a NotebookLM tab open, Atlas now shows
  the user's real folders, notebooks, graph, and plans. Packaged-app users have a
  clear, in-app way to find and load the extension. Port problems are visible.
- **Positive:** Backward compatible: with no extension connected, everything falls
  back to `folders.json` exactly as before (existing tests unchanged).
- **Negative:** `GET /api/folders` now returns live folders when an extension is
  connected, which can differ from what was last `POST`ed to `folders.json`. This is
  the intended behavior for Atlas; pure-API users without an extension are
  unaffected.
- **Neutral:** The extension still installs in the browser separately; the desktop
  app cannot load it into the user's browser automatically (browsers do not allow
  that), so the flow is "reveal the folder, user loads it once".

## Alternatives Considered

- **Have the extension POST its folders to `/api/folders` on every change.** Works,
  but couples the extension to the server's lifecycle and duplicates state; pulling
  on demand is simpler and keeps `chrome.storage.local` the single source of truth.
- **Auto-load the extension from the desktop app.** Not possible; browsers do not let
  an external app install an unpacked extension.
- **Pick any free port and tell the extension which one.** The extension (a content
  script / MV3 worker) has no reliable channel to learn the desktop app's chosen
  port; standardizing on 3000 and warning on conflict is simpler and predictable.

## Supersedes / Superseded by

- Supersedes: none. Fixes gaps in
  [ADR-0014](0014-atlas-research-podcast-studio.md) and
  [ADR-0015](0015-atlas-desktop-app-and-installers.md).
- Superseded by: —
