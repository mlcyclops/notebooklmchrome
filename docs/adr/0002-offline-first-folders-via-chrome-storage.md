# ADR-0002: Offline-first folders via chrome.storage.local

**Status:** Accepted
**Date:** 2026-06-26

This ADR documents a decision already shipped in PR #1, recording its rationale for
future sessions.

## Context

The headline feature of the extension is real, nested folders for NotebookLM. Earlier,
folder structure depended on the optional Node companion server, which meant a user
had to install dependencies and run a local server just to organize notebooks. That
conflicts with the project's core promise: zero setup — *Load unpacked and go*. The
extension must be trivial to install and fully usable with no server and no network.

## Decision

We will treat **`chrome.storage.local` as the source of truth for folder structure**.

- The extension persists folders to `chrome.storage.local` and reads from it on load.
- Default folders are seeded on first run so the UI is usable immediately.
- The companion Node server is **optional** and acts only as a secondary sync/automation
  layer; it never becomes a prerequisite for folder functionality.

## Consequences

- **Positive:** Zero-setup install; folders work fully offline and without any server;
  matches the README's standalone promise.
- **Negative / trade-off:** The server is demoted to optional/secondary, so any
  server-side folder features must reconcile back to the extension's storage.
- **Neutral:** `chrome.storage.local` is now canonical, so any future cross-device or
  server sync logic must reconcile *to* it (storage wins), and is scoped to a single
  browser profile until explicit sync is added.

## Alternatives Considered

- **Server as source of truth (prior approach).** Required running a local server for a
  basic feature; broke the zero-setup install promise.
- **`chrome.storage.sync` instead of `local`.** Gives cross-device sync for free but
  imposes tight quotas (per-item and total size limits) that a deep folder tree can
  exceed; revisit as part of the dedicated "sync folders across devices" roadmap item.
- **In-memory / `localStorage` only.** No reliable cross-session persistence under MV3
  service-worker lifecycles.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: none.
