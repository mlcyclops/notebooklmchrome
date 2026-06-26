# ADR-0003: Folder colors and icons

**Status:** Accepted
**Date:** 2026-06-26

## Context

Folders in the sidebar are visually uniform: every folder row shows the same 📁
glyph and the same neutral styling. As users accumulate folders, scanning the tree
to find a particular one becomes harder. Users have asked to personalize folders so
they can be told apart at a glance — the first item on the roadmap (see
`PROGRESS.md`, "Folder colors & icons").

We want this enrichment to be:

- **Backward compatible** with folder data already stored in `chrome.storage.local`
  by existing users (the data model in ADR-0002). Older folders have no color/icon
  fields and must keep rendering.
- **Injection-safe.** Folder rows are built with `innerHTML` interpolation. Any
  per-folder value placed into markup or an inline `style` attribute is attacker- or
  corruption-influenced storage and could carry a CSS/HTML injection payload if used
  verbatim.
- **Dependency-free.** The extension is vanilla JS with no build step; we will not
  pull in an icon font or a color-picker library.

## Decision

We will add two **optional** fields to each folder node in the folder data model:

- `color` — a hex string drawn from a **curated preset palette** (~8 colors).
- `icon` — a single emoji drawn from a **curated set** (~12 icons).

Specifics:

- **Defaults & backward compatibility.** New folders are seeded with a sensible
  default (default 📁 icon and the default accent color). `normalizeFolderData`
  default-fills `color`/`icon` for any folder that lacks them — both for the seeded
  defaults and for previously stored folders — without otherwise mutating user
  intent. Folders that already carry valid values keep them.
- **Editing UX.** Each folder row gains a small "customize" affordance (a 🎨
  button). It opens an inline popover/picker — reusing the existing dropdown pattern
  (`showMoveDropdown`) and the global click-to-close handler — offering the fixed
  palette of color swatches and the curated emoji buttons. Selecting one updates that
  folder's `color`/`icon`, calls `saveFolders()`, and re-renders. There is no
  free-text input and no external icon library.
- **Rendering.** The folder row shows the chosen emoji icon before the name and uses
  the color as a visual accent (icon tint plus a left-border accent on the header),
  consistent with the existing dark violet theme.
- **Injection-safe allow-listing.** Before any `color` is placed into markup or an
  inline style, it is validated against the preset palette allow-list; any value not
  in the list falls back to the default. Likewise `icon` is validated against the
  curated emoji set. This is the load-bearing safety property: user/stored strings
  never reach `innerHTML` or inline `style` unchecked.
- **Persistence.** Saving reuses the existing `saveFolders()` →
  `chrome.storage.local` path. The optional companion-server sync is unaffected
  because the new fields ride along inside the same `folderData` payload.

## Consequences

What becomes easier or harder as a result. Be honest about trade-offs.

- **Positive:** Folders are far easier to distinguish at a glance. The change is
  additive and backward compatible — no migration step, old data just renders with
  defaults. No new dependencies; the popover reuses the existing dropdown machinery.
  The allow-list approach closes the CSS/HTML injection vector by construction.
- **Negative:** A curated palette and emoji set limit user choice — someone wanting
  a bespoke brand color or a specific glyph cannot have it. The curated sets must be
  maintained in code.
- **Neutral:** The folder data model grows by two optional fields; any external
  consumer of `folders.json` should treat them as optional.

## Alternatives Considered

- **Free-form color input** (e.g. an `<input type="color">` or a text hex field).
  Rejected: arbitrary strings flowing into inline styles widen the injection surface
  and complicate validation, for marginal benefit over a curated palette.
- **External icon font / icon library** (Font Awesome, Material Icons, etc.).
  Rejected: adds a dependency and a network/asset load to a deliberately
  dependency-free, build-step-free extension. Emoji are already used throughout the
  UI and render everywhere with no assets.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: none.
