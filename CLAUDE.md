# CLAUDE.md

**NotebookLM Folderizer** — a Chrome Manifest V3 extension that adds real, nested
folders with drag-and-drop to Google NotebookLM. Folders persist in
`chrome.storage.local` so the extension works completely standalone; an optional
Node companion server exposes a programmatic API by driving the extension. See
[`README.md`](README.md) for the full feature set, install steps, and architecture.

This file is the operating manual for any Claude Code session working in this repo.
Read it at the start of every session.

## Golden Rules

1. **One increment per PR.** Keep each change small, self-contained, and reviewable.
2. **Externalize state before context fills.** Write what you've learned and decided
   to `PROGRESS.md` or an ADR rather than holding it in your head. Markdown on disk
   survives a context reset; your working memory does not.
3. **Read first.** At session start, read `PROGRESS.md` and the latest ADRs before
   touching anything. They are the source of truth for where things stand.
4. **Test before commit.** Run the [Testing Checklist](#testing-checklist):
   `node --check` on all JS, a headless Chromium load, and feature-specific checks.
5. **Follow the workflow:** ADR → implement → test → PR.
6. **No AI/model identifiers.** Never put AI or model names/markers in commits, PR
   text, or code.

## Context Window Management

The context window is a finite, shared resource. Treat it like working memory that
can be wiped at any moment, and keep durable state on disk so nothing is lost.

- **Start by reading, not re-deriving.** Begin each session by reading the
  `PROGRESS.md` header ("Current State" and "Next Up") and the ADR index
  (`docs/adr/README.md`). Trust those as the source of truth instead of
  re-exploring the codebase to reconstruct what's already known.
- **Delegate bulk to subagents.** Push exploration, research, and verification into
  subagents (the Agent / worker tool) so large file contents and dead-end searches
  stay out of the main context. Ask them to return concise summaries — file paths,
  line numbers, and conclusions — not raw dumps.
- **Read narrowly.** Prefer targeted `Grep`/`Glob` and reading specific line ranges
  over reading whole files. Only pull in what you actually need.
- **Checkpoint early.** When context gets heavy (roughly 70% full) or before any
  risky or large step, update `PROGRESS.md` first, then proceed. If the context is
  reset right after, the next session picks up cleanly.
- **End by writing.** Close every session by updating `PROGRESS.md` (move completed
  items, set "Next Up", append a dated Session Log entry) and recording any
  significant decisions as ADRs.
- **Stay scoped.** Keep chat replies and commits tightly focused. Avoid pasting
  large file dumps into the conversation.

## Progress Log — `PROGRESS.md`

`PROGRESS.md` is the living status document. It has two parts with two different
update rules:

- **Header — UPDATED IN PLACE.** The "Current State", "Next Up", and
  "Blocked / Open Questions" sections are rewritten to reflect reality. Move
  finished work into Current State, keep "Next Up" as the live to-do list, and
  record anything blocking in "Blocked / Open Questions".
- **Session Log — APPEND-ONLY.** Never edit or delete past entries. Add a new dated
  entry at the **top** (newest first) describing what changed and what's next.

Update `PROGRESS.md` at the **start** of a session (note what you're picking up) and
at the **end** (what changed, what's next).

## Decision Records — `docs/adr/`

Significant architectural or product decisions are captured as Architecture Decision
Records (ADRs) under `docs/adr/`.

- **One ADR per significant decision.** File name: `NNNN-kebab-title.md`, where
  `NNNN` is the next sequential number (zero-padded, e.g. `0003`).
- **Append-only and immutable once Accepted.** Never rewrite an Accepted ADR. If a
  decision changes, write a **new** ADR and mark the old one
  "Superseded by ADR-XXXX".
- **Statuses:** `Proposed` → `Accepted` → `Superseded` / `Deprecated`.
- **Maintain the index.** Add a row to `docs/adr/README.md` for every new ADR
  (append, don't rewrite history).
- **Use the template.** Start new ADRs from [`docs/adr/template.md`](docs/adr/template.md).

## Per-Increment Workflow

Each unit of work follows this loop:

1. **Write/Accept an ADR** for the decision driving the change (skip only for trivial,
   non-architectural edits).
2. **Implement** the increment — one focused change.
3. **Test** against the [Testing Checklist](#testing-checklist).
4. **Commit** with a clear, conventional message (no AI/model identifiers).
5. **Push** to the working branch:
   `git push -u origin claude/slack-session-1kq2me`.
6. **Open a DRAFT PR** (link the Slack thread in the body).
7. **Update `PROGRESS.md`** — header in place, plus a new Session Log entry.

## Testing Checklist

Run before every commit:

- **Syntax check all JS:**
  `node --check extension/content.js extension/background.js server.js`
- **Validate JSON:** ensure `manifest.json` and any other JSON files still parse.
- **Headless Chromium load:** launch the extension in headless Chromium via Playwright
  (chromium at `/opt/pw-browsers/chromium`, a persistent context with
  `--load-extension=extension/`) and confirm the MV3 service worker registers.
- **Feature check:** add any check specific to the change (manual or automated) that
  exercises the behavior you touched.

## Conventions

- **Branch:** `claude/slack-session-1kq2me`.
- **PRs:** always opened as **draft**; link the Slack discussion thread.
- **Commits:** conventional, descriptive messages — and **no AI/model identifiers**
  anywhere in the message, body, or trailers.
- **Keep docs in sync:** `README.md`, `PROGRESS.md`, and the ADR index
  (`docs/adr/README.md`) should always reflect the current state.
