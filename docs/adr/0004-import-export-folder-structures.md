# ADR-0004: Import / export folder structures (JSON)

**Status:** Accepted
**Date:** 2026-06-26

## Context

Folders live only in `chrome.storage.local` (ADR-0002), scoped to a single
browser profile on a single machine. There is no way to back them up, move them
to another profile/machine, share a curated structure with a teammate, or
recover after clearing browser data. The optional companion server can persist
`folders.json`, but most users run the extension standalone, so it cannot be the
backup mechanism. The roadmap (`PROGRESS.md`, "Import / export folder
structures (JSON)") calls for a portable, dependency-free way to get folder data
in and out of the extension.

Constraints carried over from earlier decisions:

- **Dependency-free, no build step.** The extension is vanilla JS; we will not add
  a file-handling or schema-validation library.
- **Injection-safe.** Folder rows are built with `innerHTML` interpolation and
  inline `style` (ADR-0003). Imported data is fully attacker-/corruption-influenced
  and must never reach markup or a `style` attribute unchecked. The existing
  `normalizeFolderData` + `sanitizeFolderColor`/`sanitizeFolderIcon` allow-lists,
  plus `escapeHtml` at render time, are the load-bearing safety properties.
- **Offline-first.** Import/export must work with no server present; the optional
  server sync is a side effect, not a requirement.

## Decision

We will add **Export** and **Import** buttons to the sidebar header, next to the
existing "New Root Folder" button, both implemented in vanilla JS.

**Export.** `exportFolders()` serializes the current folder structure into a small
wrapper envelope and triggers a client-side download:

```
{ "version": 1, "exportedAt": "<ISO timestamp>", "data": { "folders": [ ... ] } }
```

It `JSON.stringify`s the envelope (pretty-printed), wraps it in a
`application/json` `Blob`, creates an object URL, clicks a temporary
`<a download>` whose name is `notebooklm-folders-<YYYY-MM-DD>.json`, then removes
the anchor and calls `URL.revokeObjectURL`. The `version` and `exportedAt`
envelope fields let future importers validate and, if the schema ever changes,
migrate. (The extension runtime may use `new Date()` for the timestamp/filename;
the no-`Date` rule only applies to the workflow scripts, not extension code.)

**Import.** A hidden `<input type="file" accept="application/json">` is triggered
by the Import button. On `change`, `importFolders()` reads the file text, runs
`JSON.parse` inside a `try/catch`, and accepts **either** the enveloped form
(`{ version, data }`) **or** a bare `{ folders: [...] }` structure — lenient on
outer shape, strict on validation. The candidate folder structure is then passed
through the existing `normalizeFolderData`, which coerces it to a valid
`{ folders: [...] }` shape and default-fills/sanitizes every node's `color` and
`icon` against the ADR-0003 allow-lists, so an import can never smuggle an
off-allow-list color/icon or a malformed node into storage or the DOM. Folder
names and notebook titles continue to be escaped by `escapeHtml` at render time
(the import path does not bypass it). Parse failures and non-conforming files are
reported with a clear, **non-throwing** user-facing message and otherwise change
nothing.

**Import semantics: REPLACE, after explicit confirmation.** A successful, valid
import shows `confirm('This will replace your current folders. Continue?')`. If
the user accepts, the imported structure becomes the new `folderData`, is
persisted via the existing `saveFolders()` path (which writes
`chrome.storage.local`, re-renders the sidebar, and best-effort syncs the server
when connected), and the UI updates. We choose replace over merge for v1 because
merge semantics are ambiguous — duplicate folder IDs, conflicting nesting/parent
links, and notebook-membership collisions have no single obviously-correct
resolution, and a wrong guess silently corrupts the user's tree.

## Consequences

- **Positive:** Folder structures become portable — users can back up, restore,
  migrate between profiles/machines, and share a curated tree as a single small
  JSON file, all fully offline. The envelope's `version`/`exportedAt` give a clean
  forward-compatibility and migration hook. Reusing `normalizeFolderData` and the
  `sanitize*` allow-lists means imports inherit the exact same injection-safety and
  shape guarantees as normal storage loads — no new trust boundary code.
- **Negative:** Import is destructive (replace-only) in v1: there is no way to
  merge an imported tree into the current one, so combining two structures means
  manual rework. The envelope adds a small versioning surface that future schema
  changes must honor.
- **Neutral:** A new top-level JSON shape (`{ version, exportedAt, data }`) becomes
  part of the extension's external contract. The bare-`{ folders: [...] }` form is
  also accepted on import for leniency, including hand-authored files.

## Alternatives Considered

- **Merge / append on import** (combine imported folders with existing ones).
  Deferred: requires a well-defined conflict-resolution policy for duplicate IDs,
  nesting conflicts, and notebook-membership overlaps. Getting it wrong silently
  corrupts user data, so we ship the unambiguous replace-after-confirm flow first
  and can add an explicit "merge" mode in a later ADR if demand warrants.
- **Cloud / cross-device sync** as the portability mechanism. Out of scope: it is a
  separate roadmap item ("Sync folders across devices") with its own backend,
  auth, and conflict concerns. Local JSON import/export is the dependency-free,
  offline-first primitive that also doubles as a backup format.
- **Bare structure with no envelope** (export the raw `{ folders: [...] }`).
  Rejected: no place to record a schema version or export timestamp, leaving no
  clean migration path. We still *accept* the bare form on import for leniency, but
  always *export* the enveloped form.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: none.
