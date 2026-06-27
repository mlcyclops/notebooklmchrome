# ADR-0014: Atlas, a Research & Podcast Studio on the companion server

**Status:** Accepted
**Date:** 2026-06-26

## Context

The roadmap names **Atlas** as the flagship application built on the companion
server (concept in [ADR-0009](0009-brand-assets-and-knowledge-graph-direction.md),
mockup `assets/app-atlas-concept.svg`). With the knowledge-graph export (ADR-0011)
and the podcast/study/watch automation (ADR-0013) in place, Atlas can be a thin,
real app that *consumes* those APIs rather than introducing new backend behavior.

It must: require no new Google access (talk only to `localhost:3000`), work with the
build-free ethos of this repo (no bundler), degrade gracefully when the extension
is offline or there are no folders, and keep its logic testable despite living in
the browser.

## Decision

Ship Atlas as a static single-page app under `atlas/`, served by the companion
server at **`/atlas`** (`express.static`).

- **Shared, tested view-model.** `atlas/atlas-view.js` is a pure, UMD module (Node
  `require` + browser global `window.AtlasView`) holding every data transform:
  `buildSidebar` (folder forest to depth-ordered rows), `graphStats`,
  `episodeRows`, `studyGroups`, `summarizeResults`, `connectionLabel`. The DOM-only
  code in `app.js` calls these, so the logic is unit-tested in Node and the browser
  layer stays thin.
- **App surface.** A library rail (folders + a concentric knowledge-graph
  rendering), a Podcast Studio (pick a folder, plan via the dry-run endpoints,
  generate via the execute endpoints, per-episode status), a Study Pack panel
  (format chips + counts + generate), and a Watch-mode toggle. It calls only the
  existing endpoints: `/status`, `/api/folders`, `/api/graph`,
  `/api/folders/:id/podcast(/plan)`, `/api/folders/:id/study-pack(/plan)`,
  `/api/watch*`.
- **Graceful degradation.** Empty folders, an offline server, or a disconnected
  extension render calm empty states and toasts rather than errors; generation
  failures are reported per item (the server already returns per-job results).
- **No new backend.** Atlas adds only static serving; all behavior reuses prior
  ADRs.

## Consequences

- **Positive:** A genuinely usable flagship app, build-free, that showcases the
  graph + automation work and validates the API surface end to end. The shared
  view-model keeps presentation logic honest and tested.
- **Positive:** Opening `http://localhost:3000/atlas` is the whole install; nothing
  to bundle or deploy.
- **Negative:** It is intentionally minimal (three panels, a simple graph layout)
  and inherits the experimental/best-effort nature of generation (ADR-0010/0013).
  Richer features (full Graph/Study tabs, audio playback, scheduling UI) are future
  increments.
- **Neutral:** Browser rendering/interaction is verified manually (served app,
  folders + graph + plan flow exercised); the pure view-model and the static-serving
  are covered by automated tests.

## Alternatives Considered

- **A separate repo / framework SPA (React, Vite).** Rejected: adds a build step
  and a toolchain to a deliberately build-free project; vanilla + a shared UMD
  module is enough.
- **Bake Atlas into the extension UI.** Rejected: Atlas is a studio/dashboard that
  benefits from full-page space and the server APIs; the sidebar stays focused on
  organizing.
- **Defer Atlas, ship only the APIs.** Rejected: the roadmap calls for the app, and
  it doubles as living documentation of the API.

## Supersedes / Superseded by

- Supersedes: none. Realizes the Atlas concept from
  [ADR-0009](0009-brand-assets-and-knowledge-graph-direction.md); consumes
  [ADR-0011](0011-knowledge-graph-export.md) and
  [ADR-0013](0013-automation-podcast-study-watch.md).
- Superseded by: —
