// Atlas view-model: pure, environment-agnostic transforms from API responses to
// render-ready data (ADR-0014). Shared by the browser app (loaded as a <script>,
// exposes window.AtlasView) and the Node tests (require). No DOM, no network.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function asArray(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return v == null ? '' : String(v); }

  // Flatten the folder forest into ordered rows with depth (DFS, roots first).
  // Each row: { id, name, depth, count } where count = notebooks in the folder.
  function buildSidebar(folders) {
    const list = asArray(folders);
    const children = new Map();
    for (const f of list) {
      if (!f || f.id == null) continue;
      const parent = f.parentId == null ? null : str(f.parentId);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(f);
    }
    const rows = [];
    function walk(parentKey, depth) {
      for (const f of (children.get(parentKey) || [])) {
        rows.push({ id: str(f.id), name: str(f.name) || '(untitled)', depth, count: asArray(f.notebookIds).length });
        walk(str(f.id), depth + 1);
      }
    }
    walk(null, 0);
    return rows;
  }

  // Header stats from a knowledge-graph envelope or a raw {nodes,edges} graph.
  function graphStats(graphOrEnvelope) {
    const g = graphOrEnvelope && graphOrEnvelope.graph ? graphOrEnvelope.graph : graphOrEnvelope;
    const nodes = asArray(g && g.nodes);
    const edges = asArray(g && g.edges);
    return {
      folders: nodes.filter(n => n.type === 'folder').length,
      notebooks: nodes.filter(n => n.type === 'notebook').length,
      edges: edges.length
    };
  }

  // Episode rows for the Podcast Studio from a podcast plan.
  function episodeRows(podcastPlan) {
    const eps = asArray(podcastPlan && podcastPlan.episodes);
    return eps.map(e => ({
      episode: e.episode,
      title: str(e.title),
      notebookId: str(e.notebookId),
      status: 'Planned'
    }));
  }

  // Group a study-pack plan's jobs by format, for the Study Pack panel chips.
  function studyGroups(studyPlan) {
    const jobs = asArray(studyPlan && studyPlan.jobs);
    const counts = new Map();
    for (const j of jobs) {
      const f = str(j.format);
      counts.set(f, (counts.get(f) || 0) + 1);
    }
    return Array.from(counts, ([format, count]) => ({ format, count }));
  }

  // Summarize runPlan results into a tally for the UI.
  function summarizeResults(results) {
    const list = asArray(results);
    const ok = list.filter(r => r && r.ok).length;
    return { total: list.length, ok, failed: list.length - ok };
  }

  // Human label for the connection / watch state.
  function connectionLabel(status) {
    if (!status) return 'Offline';
    return status.connectedClients > 0 ? 'Connected' : 'No extension';
  }

  return { buildSidebar, graphStats, episodeRows, studyGroups, summarizeResults, connectionLabel };
});
