# ADR-0020: Atlas UI polish and custom Help popup

**Status:** Accepted
**Date:** 2026-06-27

## Context

The Atlas desktop app worked but lacked an in-app way to learn how to use it, find
support, or see the version. The native Electron menu had a plain "About" dialog,
which is functional but not polished and is invisible in the browser-served `/atlas`.
We want a single, attractive, in-app Help that works the same in the desktop app and
the browser, plus general frame polish for a pleasant first-run experience.

## Decision

- **Custom Help / About popup** in `atlas/` (not a native dialog): a soft, rounded
  (22px) modal over a blurred overlay, opened from a topbar "?" button and closed via
  the X, an overlay click, or Esc. It contains a 3-step "Getting started" guide and
  tips, the **support email** (mailto), a **"View on GitHub"** link, and the **current
  version**. Because it is part of the Atlas page, it appears identically in the
  desktop app and the browser.
- **Version surfacing:** `/status` now returns `version` (from `package.json`); the
  popup reads it so the displayed version is always accurate.
- **Frame polish:** themed scrollbars, a subtle topbar accent seam, and refined
  empty/connect states.
- Bump the app to **1.0.2** for the release that carries this plus the live-folders
  and relay fixes.

## Consequences

- **Positive:** One polished, consistent Help surface in both the app and browser,
  with support contact, version, and source link a click away. No native-dialog
  divergence.
- **Positive:** Version is single-sourced from `package.json` via `/status`, so it
  cannot drift.
- **Negative:** The automated screenshot tool times out on the live-polling page, so
  visual sign-off relies on computed-style assertions rather than an image.
- **Neutral:** Pure presentation; no API or data-model change.

## Alternatives Considered

- **Keep the native Electron About dialog.** Rejected: not polished, and absent in the
  browser-served Atlas.
- **A separate Help HTML page.** Rejected: a modal keeps context and is simpler than
  routing/another window.

## Supersedes / Superseded by

- Supersedes: none. Builds on
  [ADR-0014](0014-atlas-research-podcast-studio.md) and
  [ADR-0015](0015-atlas-desktop-app-and-installers.md).
- Superseded by: —
