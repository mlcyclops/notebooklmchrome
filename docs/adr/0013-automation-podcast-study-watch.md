# ADR-0013: Automation pipelines (podcast, study packs) and watch mode

**Status:** Accepted
**Date:** 2026-06-26

## Context

The companion server exposes a single-shot `generate-product` per notebook. The
roadmap calls for higher-level automation that operates on a **folder**: turn a
folder into a narrated podcast series, build a study pack across its notebooks, and
keep both fresh as the folder changes. The underlying generation drives
NotebookLM's UI and is experimental/best-effort (ADR-0010), so the orchestration
must be honest about partial failure and must be testable without a browser.

## Decision

Add a pure, dependency-injected orchestration module `lib/automation-pipeline.js`
and expose it through the server.

- **Planning (pure).** `planPodcast(folderId, snapshot)` yields one episode per
  notebook in the folder (format `audio-overview`); `planStudyPack(folderId,
  snapshot, { formats })` yields each notebook x each format (default
  study-guide / briefing-doc / faq / timeline). Plans are data, computable with no
  extension connected.
- **Execution.** `runPlan(jobs, runJob, { concurrency, retries })` runs jobs
  against an injected `runJob` (the server passes one that calls the extension),
  sequential by default, with retries, returning a per-job
  `{ ok, attempts, result | error }`. It never throws, so one failed product does
  not abort the batch.
- **Watch mode.** `diffForWatch(prev, curr)` reports folders that are new or have
  gained notebooks; `planRegen(changes, snapshot)` turns that into podcast +
  study-pack jobs. The server runs a poll loop (`POST /api/watch` to start with an
  interval and an opt-in `autoGenerate`, `POST /api/watch/stop`, `GET /api/watch`
  status, `GET /api/watch/plan` dry-run). With `autoGenerate` off (default) it only
  detects and reports changes; on it executes the regen plan best-effort.
- **Server surface.** Dry-run plan endpoints (`GET .../podcast/plan`,
  `GET .../study-pack/plan`) need no extension; execute endpoints
  (`POST .../podcast`, `POST .../study-pack`, with `?dryRun=1`) drive generation
  and return `{ plan, results }`. CLI: `podcast`, `studypack`, `watch`.

## Consequences

- **Positive:** Folder-level automation built entirely on the existing API, with a
  clean separation between deterministic planning (unit-tested) and best-effort
  execution. Dry-run endpoints make the feature fully exercisable headlessly. Watch
  mode is opt-in and safe by default (detect-only).
- **Negative:** Executing a large folder is slow (one product at a time, each a
  best-effort UI automation) and only as reliable as ADR-0010 allows. The watcher
  polls (no push) and holds its baseline in memory, so it resets on server restart.
- **Neutral:** No storage-schema change. `audio-overview` is the podcast format;
  whether NotebookLM exposes it for a given notebook is determined at run time by
  the content-script automation.

## Alternatives Considered

- **Bake orchestration into the content script.** Rejected: the server is the
  automation surface, and a pure Node module is far easier to test and reuse (Atlas
  will consume it).
- **A real job queue / scheduler (cron, persistence).** Deferred as over-scoped for
  this increment; an in-memory interval watcher plus dry-run planning covers the
  need and keeps the server dependency-free.
- **Push-based change detection from the extension.** Nice future improvement, but
  polling `folders.json` + live notebooks works today without new messaging.

## Supersedes / Superseded by

- Supersedes: none. Builds on [ADR-0010](0010-harden-chat-generate-automation.md)
  (the generate automation) and [ADR-0011](0011-knowledge-graph-export.md) (snapshot
  shape).
- Superseded by: —
