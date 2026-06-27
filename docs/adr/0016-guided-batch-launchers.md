# ADR-0016: Guided .bat launchers with menus and ASCII art

**Status:** Accepted
**Date:** 2026-06-27

## Context

Even with the desktop app (ADR-0015), Windows users benefit from a zero-knowledge
entry point that does not assume they know npm, ports, or where the extension
folder is. The old `run.bat` only started the server and launched Chrome. We want a
single, polished, friendly launcher that exposes every capability (desktop app,
browser studio, extension loading, packaging, installer build, tests, help) behind
a simple numeric menu, and that looks great.

## Decision

Ship two polished, dependency-free batch launchers (CRLF line endings, enforced via
`.gitattributes`):

- **`run.bat`** — the main guided menu. A branded ASCII-art banner ("ATLAS") and a
  numbered menu:
  1. Launch Atlas Studio (runs the built desktop app if present, else dev mode),
  2. Start the server and open Atlas in the browser,
  3. Load the extension into Chrome,
  4. Build the Chrome/Edge/Firefox packages,
  5. Build the Windows desktop installer,
  6. Run the test suite,
  7. Help + API reference,
  0. Exit.
  It auto-detects Node (downloading a portable copy if missing), installs deps on
  first use, frees port 3000, and loops back to the menu after each action. Input is
  hardened (only the first character of a choice is used) so a stray space or
  carriage return never breaks routing. The console is themed (`color`), using
  ASCII-only art so it renders in every Windows console.
- **`build-desktop.bat`** — a focused one-click installer builder with its own
  ASCII-art banner and step-by-step progress, ending by opening `dist-desktop\`.

## Consequences

- **Positive:** Non-technical users get a friendly, attractive front door to every
  feature with no commands to memorize. The launcher is self-healing (portable Node,
  auto `npm install`).
- **Positive:** Robust routing (first-character parsing) avoids the classic batch
  pitfalls; `.gitattributes` keeps the files CRLF so `goto`/labels work on Windows.
- **Negative:** Batch is Windows-only; macOS/Linux users use `npm`/the installers.
  ASCII art (not ANSI truecolor) keeps it universal but less flashy than a TUI.
- **Neutral:** The launchers wrap existing scripts (`npm start`, `npm run package`,
  `npm run dist:win`, `npm test`); no new runtime behavior.

## Alternatives Considered

- **Keep the minimal `run.bat`.** Rejected: did not surface the new capabilities and
  was not menu-driven.
- **ANSI truecolor / a fancy TUI.** Rejected for the launcher: ANSI VT support is
  inconsistent across Windows consoles without enabling it per-process; ASCII +
  `color` is bulletproof. (The polished UI lives in Atlas itself.)
- **A PowerShell script instead of .bat.** Rejected: `.bat` double-click is the most
  familiar, lowest-friction option on Windows and needs no execution-policy changes.

## Supersedes / Superseded by

- Supersedes: the previous minimal `run.bat` behavior.
- Superseded by: —
