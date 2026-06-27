# ADR-0009: Brand asset system, knowledge-graph positioning, and the Atlas roadmap

**Status:** Accepted
**Date:** 2026-06-26

## Context

The detection fix and premium UI redesign (ADR-0008) are shipped, and several earlier
features (folder colors/icons, import/export, search, sync) are now live. Two gaps
remain at the project's surface:

1. **Presentation.** The README leaned on emoji bullets and a bare screenshot. For a
   flagship custom plug-in that markets itself on look and feel, the public-facing
   page should match the in-product polish: consistent iconography, a framed hero,
   and figures that explain the product rather than just show it.
2. **Direction.** The companion server has always been described as a low-level
   "programmatic API", which undersells it. The folder structure it exposes is in
   fact a graph (folders as nodes, notebooks as leaves, shared sources/topics as
   edges). We have no stated product narrative for what that graph unlocks, and the
   roadmap still listed already-shipped items as pending.

GitHub constraint: README HTML is sanitized and inline CSS is stripped, so any
"frame" or animation has to live **inside** self-contained SVG assets referenced as
images, not in markdown styling.

## Decision

**A. A small, self-contained brand asset system under `assets/`.**

- A set of **animated SVG feature icons** (`assets/icons/*.svg`), one per headline
  feature, drawn from the existing violet brand palette and using SMIL animation that
  renders on GitHub. They degrade to a clean rest state where animation is unsupported.
- A **framed hero image** (`assets/folders-hero.svg`) that wraps the product
  screenshot in an app-window chrome (title bar, traffic lights, URL pill). Because
  GitHub strips inline CSS, the frame is baked into the SVG and the screenshot is
  embedded as a base64 data URI so the asset is fully self-contained. It is generated
  by `tools/build-hero.js` so it can be regenerated when the screenshot changes.
- Two **explanatory figures**: a knowledge-graph infographic
  (`assets/knowledge-graph-infographic.svg`) and a concept mockup for the next app
  (`assets/app-atlas-concept.svg`).
- House style for prose assets and the README: **no em dashes**.

**B. Position the companion server as a personal knowledge graph.**

- Frame the server's value as turning a folderized library into a queryable,
  automatable knowledge graph, documented with the infographic and a README section.
  This is a narrative/docs change only; the API and data model are unchanged.

**C. Commit to "Atlas" as the flagship next build, and reimagine the roadmap.**

- Mark shipped items as shipped, and split the roadmap into **Shipped** and **Next**.
- Add server-integration ideas: knowledge-graph export (JSON/GraphML), an automated
  **podcast pipeline** (folder to multi-episode series via `generate-product`),
  scheduled **research/study packs**, and a **watch mode** that regenerates products
  when sources change.
- Name **Atlas**, a Research &amp; Podcast Studio built entirely on the existing API
  (`/api/folders`, `/api/notebooks`, `/chat`, `/generate-product`), as the next
  flagship application, illustrated by the concept mockup.

## Consequences

- **Positive:** The README reads as a polished product page and explains, not just
  shows, the value. The server gains a clear narrative. The roadmap reflects reality
  and points at a concrete, buildable next step that needs no new Google access.
- **Positive:** Assets are dependency-free SVG that render on GitHub and are cheap to
  regenerate (`tools/build-hero.js`).
- **Negative:** The hero SVG embeds the screenshot as base64, so it is large (~225 KB)
  and must be rebuilt when the screenshot changes.
- **Neutral:** No code, storage schema, or API changes. Atlas is a concept only until
  it is picked up as its own increment with its own ADR.

## Alternatives Considered

- **Keep emoji bullets and the bare screenshot.** Rejected: below the bar set by
  ADR-0008's in-product polish.
- **Composite the hero as a raster PNG.** Rejected: would require an image toolchain
  in the repo; a generated SVG keeps the pipeline dependency-free and the frame crisp.
- **Use external image hosting / CSS frames in the README.** Rejected: GitHub strips
  inline CSS and proxies images, so a self-contained SVG is the only reliable frame.
- **Defer naming a next app.** Rejected: the user asked for a concrete next build;
  Atlas gives the roadmap a clear flagship target.

## Supersedes / Superseded by

- Supersedes: none. Builds on
  [ADR-0003](0003-folder-colors-and-icons.md) and
  [ADR-0008](0008-premium-ui-ux-and-trustworthy-notebook-states.md).
- Superseded by: —
