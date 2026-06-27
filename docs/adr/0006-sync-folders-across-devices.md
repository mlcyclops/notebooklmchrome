# ADR-0006: Sync folders across devices

**Status:** Accepted
**Date:** 2026-06-26

## Context

The roadmap asks for folders to follow a user across their devices. Today the
folder structure lives only in `chrome.storage.local` (ADR-0002), which is
per-profile-per-machine: install the extension on a second computer and you start
from the default seed. Users who keep NotebookLM organized on a laptop and a
desktop have no way to share that organization.

The hard constraint inherited from ADR-0002 is **offline-first and easy-install**:
no required companion server, no account system of our own, no extra permissions
beyond what we already declare. Any cross-device story has to preserve that — a
user who never opts in must see exactly the behavior they have today.

Chrome already offers `chrome.storage.sync`, a key/value area that Chrome
replicates across every device where the user is signed into the same Chrome
profile. It rides on the user's existing Google/Chrome sign-in, needs no backend,
and is already covered by our existing `storage` permission. Its trade-off is
tight quotas: roughly `QUOTA_BYTES_PER_ITEM` ≈ 8 KB per key and ≈ 100 KB total,
and writes can fail with `QUOTA_BYTES_PER_ITEM_EXCEEDED` for a large folder set.

## Decision

We will add **opt-in cross-device sync built on `chrome.storage.sync`**, with no
companion server and no new permissions.

- **Opt-in toggle.** A sync toggle lives in the sidebar header. Its state is
  persisted in `chrome.storage.local` under the key `nlm_sync_enabled`, default
  **OFF**, so existing users see unchanged behavior until they explicitly enable
  it.
- **Local stays the source of truth.** `chrome.storage.local` remains the
  always-present cache that the sidebar renders from. `readFoldersFromStorage`
  keeps reading local only. Turning sync on does not change where we read.
- **Mirror writes when enabled.** When sync is ON, `writeFoldersToStorage` still
  writes local first, then *also* writes the same `nlm_folders` value to
  `chrome.storage.sync`. The sync write is wrapped in try/catch and checks
  `chrome.runtime.lastError`; it never throws into the page and never blocks the
  local write.
- **Remote changes flow in via `onChanged`.** A `chrome.storage.onChanged`
  listener watches area `sync`. When the `nlm_folders` key changes there and sync
  is enabled, we write the new value into local, reload the in-memory
  `folderData`, and re-render the sidebar (respecting any active search query) so
  another device's edits appear live. We guard against feedback loops by ignoring
  a change whose value already equals what we hold.
- **Quota handling → graceful local-only degradation.** On a sync write failure
  (lastError or thrown `QUOTA_BYTES_PER_ITEM_EXCEEDED`/`QUOTA_BYTES`), we keep the
  local data intact, surface a clear, non-blocking status line ("Folder set too
  large to sync — kept locally"), revert the toggle to OFF, and continue
  local-only. No data is lost.
- **Enable migrates up; disable stops.** Enabling sync performs a first write that
  pushes the current local folders up to `chrome.storage.sync`. Disabling simply
  stops mirroring writes; the local copy is retained untouched.
- **Conflict policy: last-write-wins.** With two devices editing, the most recent
  `onChanged` payload wins. This is simple and acceptable for v1; a field-level
  merge / CRDT is explicitly deferred.
- **Independent of the companion server.** This Chrome-sync mechanism is
  orthogonal to the optional companion server's `/api/folders` sync. They can
  coexist; neither requires the other. This is the cross-device mechanism the
  roadmap asked for.

## Consequences

- **Positive:** Real cross-device sync with zero backend, zero new permissions,
  and zero change for users who don't opt in. Edits propagate live between a
  user's signed-in Chrome instances.
- **Positive:** Failure is contained — a quota overflow or an unavailable sync
  area degrades to exactly today's local-only behavior with a visible reason,
  never a crash or data loss.
- **Negative:** `chrome.storage.sync` quotas cap how large a folder set can sync
  (~8 KB/item). Power users with very large structures will be kept local-only and
  told why. Mitigating this (chunking across keys, compression) is future work.
- **Negative:** Last-write-wins can drop a concurrent edit made on another device
  in the window before propagation. Acceptable for v1; documented as a known
  limitation.
- **Neutral:** Requires the user to be signed into Chrome with sync enabled for
  cross-device propagation; otherwise `chrome.storage.sync` behaves like a second
  local store. No account system of ours is introduced.
- **Neutral:** True multi-device propagation cannot be exercised in a single
  headless browser; it is verified by unit-testing the pure logic (mirror,
  degrade, onChanged) and confirmed manually across devices.

## Alternatives Considered

- **Companion-server-backed sync (own backend + accounts).** Rejected: it breaks
  the offline-first, easy-install promise (ADR-0002), forces an account system and
  hosting, and adds a new trust/permission surface — disproportionate for syncing
  a small JSON tree.
- **Full merge / CRDT conflict resolution.** Deferred. Correct three-way or
  field-level merge is significantly more complex than last-write-wins and is not
  needed for v1's single-user, occasional-multi-device case. Revisit if users
  report lost concurrent edits.
- **Always-on sync (no toggle).** Rejected: it would silently change behavior for
  every existing user and could surprise privacy-sensitive users by pushing data
  into Chrome sync without consent. Opt-in keeps the default unchanged.

## Supersedes / Superseded by

- Supersedes: none. Extends ADR-0002 (offline-first folders) with an optional
  cross-device layer; local storage remains the source of truth.
- Superseded by: none.
