# ADR-0008: Premium UI/UX redesign and trustworthy notebook states

**Status:** Accepted
**Date:** 2026-06-26

## Context

The Folderizer sidebar works, but it does not yet read as a polished, professional
product, and one of its core surfaces is actively misleading.

Two problems are driving this decision:

1. **The "Unorganized Notebooks" section lies.** In the live UI the section renders
   "No unorganized notebooks" even when the user's NotebookLM home is full of
   notebooks, none of which have been filed into a folder. The root cause is data,
   not display: `renderSidebar()` derives the unorganized list from `notebooksList`
   (`extension/content.js:448`), but that array comes back empty.
   - `fetchNotebooksList()` (`extension/content.js:344`) first calls the
     `batchexecute` RPC `wXbhsf`. When that RPC shape changes or returns nothing,
     it silently falls back to scraping `<a href="/notebook/…">` anchors
     (`extension/content.js:378`).
   - The current home **list view** does not expose notebooks as plain `/notebook/…`
     anchors, so the scrape finds nothing and `notebooksList` stays empty.
   - The empty-state branch (`extension/content.js:449`) cannot distinguish
     *genuinely zero unorganized* from *failed to load* from *still loading*, so it
     always shows the same reassuring-but-wrong "No unorganized notebooks" copy.

2. **The look and feel is below the bar for a flagship custom plug-in.** There is a
   small token set and ~27 transition/hover rules in `extension/content.css`, but no
   cohesive design system, no consistent motion language, and only minimal hover
   affordances on folders and icons. The product should feel like award-winning,
   expert-level work: deliberate spacing and typography, fluid animation, and rich,
   responsive hover states on every interactive element.

These two problems are coupled: the broken empty state is itself a UX failure, and
fixing it well (honest loading / empty / error states) is part of the same redesign.

## Decision

We will treat the sidebar as a product surface with a real design system, and we
will make every notebook state honest. Specifically:

**A. Reliable notebook detection (fixes the unorganized bug).**

- Harden `fetchNotebooksList()` so it does not depend on a single RPC id or on
  `/notebook/…` anchors existing in the DOM. Detection will, in order:
  1. attempt the `batchexecute` RPC (kept, but treated as best-effort);
  2. fall back to a DOM scan that matches notebook **rows/cards** by structure
     (project/notebook containers and their click targets), not just `<a href>`;
  3. de-duplicate by notebook id and title.
- Detection failures must be observable: log a structured warning and set an
  explicit status so the UI can react.

**B. Trustworthy empty / loading / error states.**

- Replace the single hardcoded "No unorganized notebooks" string with three
  distinct states for both the unorganized list and folder contents:
  - **Loading** — skeleton rows while the first fetch is in flight.
  - **Empty (verified)** — shown only when detection succeeded and the count is
    truly zero.
  - **Error / unavailable** — shown when detection failed, with a retry affordance,
    never disguised as "empty".

**C. A premium design system.**

- Formalize design tokens in `:root` (color, elevation, radius, spacing scale,
  typography, motion timing/easing) and build all components from them.
- Define a single motion language: consistent easing curve, durations, and a
  `prefers-reduced-motion` path that disables non-essential animation.
- Give every interactive element a deliberate hover/focus/active response —
  folders, folder icons, notebook rows, buttons, and the collapse handle — with
  smooth transitions and clear affordance (lift, tint, icon emphasis).
- Polish folder and icon rendering (introduced in ADR-0003) so color and icon read
  crisply at rest and animate responsively on hover.

The redesign is **CSS- and render-layer-first**: it must not change the folder data
model or storage contract from [ADR-0002](0002-offline-first-folders-via-chrome-storage.md)
or [ADR-0003](0003-folder-colors-and-icons.md).

## Consequences

- **Positive:** The unorganized section becomes correct and trustworthy; users can
  actually see and file their notebooks. The extension reads as a premium,
  expert-level product. A token-based system makes future visual changes cheap and
  consistent.
- **Positive:** Honest loading/error states make detection regressions visible
  instead of silently presenting an empty UI.
- **Negative:** More CSS and render-state logic to maintain; richer animation needs
  a `prefers-reduced-motion` path and performance care (transform/opacity only).
- **Negative:** Structure-based DOM detection is coupled to NotebookLM's markup and
  will need maintenance when Google changes its layout — but this is strictly more
  robust than the anchor-only scrape it replaces.
- **Neutral:** No change to the storage schema, the companion server API, or the
  folder data model.

## Alternatives Considered

- **Fix only the bug, defer the redesign.** Rejected: the empty-state bug is a UX
  defect, and the user's explicit goal is expert-level look, feel, and animation;
  splitting them would leave the surface half-finished.
- **Two separate ADRs (detection fix vs. visual redesign).** Considered, but the
  honest empty/loading/error states sit exactly at the seam between the two, so a
  single ADR keeps the decision coherent. Implementation can still land as small,
  separate increments per the one-increment-per-PR rule.
- **Adopt a CSS framework / component library.** Rejected: a content-script overlay
  must stay lightweight and avoid clashing with NotebookLM's own styles; a small,
  scoped token system is leaner and fully under our control.
- **Keep the anchor-only DOM scrape.** Rejected: it is the proximate cause of the
  empty list and breaks whenever the home view is not anchor-based.

## Supersedes / Superseded by

- Supersedes: none. Builds on
  [ADR-0002](0002-offline-first-folders-via-chrome-storage.md) and
  [ADR-0003](0003-folder-colors-and-icons.md).
- Superseded by: —
