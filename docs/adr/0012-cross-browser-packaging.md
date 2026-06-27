# ADR-0012: Cross-browser packaging (Chrome, Edge, Firefox)

**Status:** Accepted
**Date:** 2026-06-26

## Context

The extension is authored once under `extension/` as Chrome MV3. We want to ship it
to **Edge** and **Firefox** too, without forking the source or hand-maintaining
parallel manifests.

- **Edge** is Chromium-based and runs the Chrome MV3 build unchanged.
- **Firefox** supports MV3 but differs: it uses `background.scripts` (an event
  page) rather than `background.service_worker`, and it requires a
  `browser_specific_settings.gecko` id. The `chrome.*` callback APIs the code uses
  are available in Firefox via its WebExtension compatibility layer.

We also want real, submittable `.zip` artifacts produced on any OS without adding
build dependencies.

## Decision

Add `tools/package-extension.js`, a dependency-free packager that builds from the
single `extension/` source:

- Emits `dist/chrome/`, `dist/edge/`, `dist/firefox/` unpacked builds plus
  `dist/<target>.zip` for each.
- **Chrome and Edge** get the manifest verbatim (same Chromium build; `edge` is a
  clearly-named copy).
- **Firefox** gets an adapted manifest: `background.service_worker` is rewritten to
  `background.scripts: ["background.js"]`, and a `browser_specific_settings.gecko`
  id + `strict_min_version` are added. The source manifest is never mutated.
- Includes a tiny **store-only ZIP writer** (with a CRC32 implementation) so the
  zips are valid archives produced identically on every platform, with no external
  tooling. Builds use a fixed DOS timestamp so artifacts are deterministic.
- Wired as `npm run package`; `dist/` is git-ignored.

## Consequences

- **Positive:** One source, three store-ready outputs from one command, no deps,
  cross-platform. Firefox adaptation is automatic and centralized.
- **Positive:** The packager is unit-tested end to end, including parsing the
  produced zips back and re-verifying every entry's CRC.
- **Negative:** Store-only zips are uncompressed, so artifacts are larger than a
  deflated zip. For an extension of this size this is negligible, and it avoids a
  compression dependency.
- **Neutral / future:** Firefox runtime correctness (the `chrome.*` callbacks, the
  optional `ws://localhost` companion connection) is not verified in CI here; it is
  packaging, not a Firefox certification. The `chrome.*` APIs used are within
  Firefox's supported compatibility surface.

## Alternatives Considered

- **Maintain separate manifests per browser by hand.** Rejected: drift-prone; the
  transform is small and mechanical.
- **Use `web-ext` / `webpack` / a zip dependency.** Rejected for now: adds tooling
  and a dependency to a deliberately build-free project; a ~90-line packager covers
  the need.
- **Skip Firefox (Chromium-only).** Rejected: Firefox is an explicit roadmap target
  and the adaptation is cheap.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: —
