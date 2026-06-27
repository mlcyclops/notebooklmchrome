# ADR-0015: Atlas Studio desktop app and one-click installers

**Status:** Accepted
**Date:** 2026-06-27

## Context

The new capabilities (Atlas studio, knowledge-graph export, podcast/study
automation, watch mode) all live behind the companion server, which today requires
Node, `npm install`, and a terminal (`npm start`, then open `/atlas`). For
non-technical users that is too much friction. We want enabling these capabilities
to be **extremely easy**: ideally a single double-click install with no Node, npm,
or terminal.

A native desktop wrapper is the standard way to deliver a local Node server + web
UI as an installable app. The constraint: macOS installers must be built on macOS,
so a Windows dev box cannot produce a `.dmg` locally.

## Decision

Ship **Atlas Studio**, an Electron desktop app that bundles the companion server
and the Atlas UI, with installer build pipelines for Windows, macOS, and Linux.

- **In-process server.** `server.js` now exports `start(port)` (and still
  auto-starts under `node server.js`). The Electron main (`desktop/main.js`) picks
  a free port, boots the server in-process, and opens
  `http://localhost:<port>/atlas/` in a native window with a small native menu
  (open in browser, open NotebookLM, about). Single-instance; external links open
  in the system browser.
- **Packaging via electron-builder.** Config lives in `package.json` `build`:
  `appId`, `productName: "Atlas Studio"`, bundling only `desktop/`, `server.js`,
  `lib/`, `atlas/` (+ production `node_modules`). Targets: Windows **NSIS**
  (assisted installer, user can choose the directory), macOS **dmg**, Linux
  **AppImage**. A generated brand icon (`tools/build-icon.js` -> `build/icon.png`,
  dependency-free PNG) is converted by electron-builder per platform.
- **Cross-platform pipeline.** A GitHub Actions workflow
  (`.github/workflows/desktop-build.yml`) builds each installer on its native
  runner (so macOS builds on `macos-latest`), runs the test suite first, and
  uploads each installer as an artifact. Triggered on `v*` tags or manually.
- **Scripts.** `npm run desktop` (dev run), `npm run dist:win` / `dist:mac` /
  `dist` (build installers). `dist-desktop/` is git-ignored.

## Consequences

- **Positive:** Installing the studio becomes a single download + double-click; no
  Node/npm/terminal. The same source powers the dev server and the desktop app (one
  codebase, no fork). The Windows installer build is verified locally; all three
  build on CI.
- **Positive:** `start(port)` makes the server embeddable and is covered by tests
  that boot it in-process (exactly what the desktop does).
- **Negative:** Electron adds a large dev dependency and ~100 MB installers. macOS
  builds cannot be produced on a Windows host, so the `.dmg` is CI-only locally
  (the pipeline handles it). Code signing/notarization is out of scope (artifacts
  are unsigned; users may see an OS warning on first launch).
- **Neutral:** The desktop app delivers the *server + Atlas*; the Chrome/Firefox
  extension still installs separately (it must live in the browser). Live notebook
  data and generation still require a NotebookLM tab with the extension.

## Alternatives Considered

- **Stay terminal-only (`npm start`).** Rejected: not "extremely easy" for
  non-technical users; the whole point of this increment.
- **Tauri / Neutralino instead of Electron.** Lighter binaries, but they do not run
  a Node server in-process without extra plumbing; Electron reuses our existing Node
  server verbatim and is the lowest-risk path.
- **Package the server as a standalone binary (pkg/nexe) + open the default
  browser.** Simpler than Electron but a worse experience (a stray terminal/window,
  no app identity, no menu) and `pkg` struggles with some native/dynamic requires.
- **Cross-build macOS from Windows.** Not supported by Apple tooling; CI on a macOS
  runner is the correct path.

## Supersedes / Superseded by

- Supersedes: none. Wraps [ADR-0014](0014-atlas-research-podcast-studio.md) (Atlas)
  and the companion server.
- Superseded by: —
