# ADR-0019: Chrome Web Store listing package

**Status:** Accepted
**Date:** 2026-06-27

## Context

Installing the extension currently requires "Load unpacked", which is too much
friction for most users and blocks the desktop app's onboarding (the app cannot load
an extension into the browser for them). Publishing to the Chrome Web Store makes
install a single "Add to Chrome" click. The store has hard requirements the project
did not yet meet: a manifest `icons` set, a privacy policy, listing copy, and a
store-ready zip.

## Decision

Prepare everything needed to publish, so going live is a short, documented process.

- **Icons:** generate 16/32/48/128 PNGs (`tools/build-extension-icons.js`) into
  `extension/icons/` and reference them from `manifest.json` `icons`.
- **Store-ready zips:** make the packager (`tools/package-extension.js`) recurse into
  subfolders so `icons/` ships inside `dist/chrome.zip` (and edge/firefox). The zip
  is the upload artifact.
- **Listing assets** under `store/`: `store-listing.md` (name, summary, description,
  category, single purpose, screenshot sources, support links), `privacy-policy.md`
  (local-only data handling, permission justifications, no data collection), and
  `SUBMISSION.md` (a step-by-step checklist for Chrome, Edge, and Firefox).
- **Trademark-safe naming:** list publicly as "Folderizer for NotebookLM" rather than
  leading with the NotebookLM mark.

## Consequences

- **Positive:** Publishing becomes mechanical (build zip, paste listing, add
  screenshots, submit). After approval, users install in one click and the desktop
  app can point at the store instead of "Load unpacked".
- **Positive:** Proper icons also improve the in-browser and toolbar appearance.
- **Negative:** Store review, the one-time developer fee, and screenshot creation are
  manual steps that still require a human; this ADR prepares them but cannot complete
  them in CI.
- **Neutral:** No runtime behavior change; the packaging recursion is covered by the
  existing packaging test (now asserting the icons are bundled).

## Alternatives Considered

- **Stay "Load unpacked" only.** Rejected: too much friction; the whole point is a
  one-click install.
- **Self-host a signed CRX with auto-update.** Rejected: only works for enterprise
  policy installs and still warns; the Web Store is the standard one-click path.

## Supersedes / Superseded by

- Supersedes: none. Complements [ADR-0012](0012-cross-browser-packaging.md) (the
  packaging pipeline) and [ADR-0017](0017-desktop-connectivity-live-folders.md).
- Superseded by: —
