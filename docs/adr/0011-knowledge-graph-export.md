# ADR-0011: Export the library as a knowledge graph (JSON / GraphML)

**Status:** Accepted
**Date:** 2026-06-26

## Context

ADR-0009 reframed the companion server's value: a folderized NotebookLM library is
already a graph (folders as nodes, notebooks as leaves, shared notebooks/topics as
edges). To make that real and usable by other tools, the library needs to be
*exportable* in standard, interoperable formats, not just described in a diagram.

Two consumers matter: programs that want structured JSON, and graph tools
(yEd, Gephi, Cytoscape) that read **GraphML**. The export must work even when no
extension is connected (so a script can run against `folders.json` alone), and it
must be safe against hostile folder/notebook names (XML injection in GraphML).

## Decision

Add a pure, dependency-free, environment-agnostic module `lib/knowledge-graph.js`
and expose it through the companion server.

- **`buildGraph({ folders, notebooks })`** produces `{ nodes, edges }`:
  - a synthetic `root` node; one `folder` node per folder; one `notebook` node per
    notebook (including notebooks referenced only by a folder, so the graph is
    complete from the folder structure alone);
  - directed edges: `root -> top-level folder`, `parent -> subfolder`
    (`subfolder`), `folder -> notebook` (`contains`), and `root -> notebook`
    (`unorganized`) for notebooks not filed anywhere;
  - a notebook filed in multiple folders is one node with multiple incoming
    `contains` edges, so shared notebooks connect their folders naturally;
  - optional `shared-topic` cross-links between notebooks that share a
    `topics`/`tags` value.
- **`toJSON(graph, meta)`** wraps the graph in a versioned envelope
  (`version`, `kind`, `generatedAt`, `counts`, `graph`). The lib never calls
  `Date` itself; the caller injects `generatedAt`, keeping the module deterministic
  and unit-testable.
- **`toGraphML(graph, meta)`** emits standards-compliant GraphML with typed
  attribute keys, escaping all text to close the XML-injection vector.
- **Server:** `GET /api/graph` returns JSON; `GET /api/graph?format=graphml`
  returns GraphML as a downloadable attachment. Folders come from `folders.json`;
  notebooks are fetched live from the extension when connected, otherwise the graph
  is built from folders alone. A CLI command `node test-api.js graph [graphml]`
  exercises it.

## Consequences

- **Positive:** The "personal knowledge graph" positioning becomes a concrete,
  interoperable artifact. Works offline-of-extension (folders only) and online
  (folders + live notebook titles/source counts). The pure builder is reused by
  any future surface (an in-extension export button, Atlas).
- **Positive:** Deterministic and heavily unit-tested; GraphML output is
  injection-safe.
- **Negative:** Cross-topic edges require `topics`/`tags` metadata the listing path
  does not yet provide, so `shared-topic` edges are empty until that data exists.
  Containment edges (the backbone) are always present.
- **Neutral:** No storage-schema change; the folder data model is unchanged. The
  graph is derived, not stored.

## Alternatives Considered

- **A bespoke JSON shape only (no GraphML).** Rejected: GraphML unlocks existing
  visualization/analysis tools for free.
- **Build the graph inside the extension and download from there.** Deferred (a
  nice future affordance), but the server is the documented programmatic surface
  and works headlessly for scripts; the shared `lib/` builder lets the extension
  adopt it later with no duplication.
- **Heavier formats (GEXF, RDF/Turtle).** Rejected for now as over-scoped; JSON +
  GraphML cover the common consumers.

## Supersedes / Superseded by

- Supersedes: none. Realizes the knowledge-graph idea from
  [ADR-0009](0009-brand-assets-and-knowledge-graph-direction.md).
- Superseded by: —
