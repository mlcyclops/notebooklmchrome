// Knowledge-graph builder + serializers (ADR-0011).
//
// Pure, dependency-free, and environment-agnostic: the same module is used by the
// companion server (Node) and can be loaded by the extension (browser). It turns
// the Folderizer data model into an explicit graph:
//   - a synthetic `root` node,
//   - one node per folder (type "folder"),
//   - one node per notebook (type "notebook"),
//   - directed edges: root -> top-level folders, parent folder -> subfolder
//     ("subfolder"), folder -> notebook ("contains"), and root -> any notebook
//     that is not filed in a folder ("unorganized").
//
// A notebook filed in multiple folders is a single node with multiple incoming
// "contains" edges, so shared notebooks naturally connect the folders that hold
// them. Optional `topics`/`tags` on a notebook add "shared-topic" cross-links
// between notebooks that share one.

'use strict';

const SCHEMA_VERSION = 1;

function asArray(v) { return Array.isArray(v) ? v : []; }
function str(v) { return v == null ? '' : String(v); }

// Build a graph object { nodes, edges } from { folders, notebooks }.
// `folders`:   [{ id, name, parentId, notebookIds, color, icon }]
// `notebooks`: [{ id, title, sourceCount, icon, topics?/tags? }]
function buildGraph(input) {
  const folders = asArray(input && input.folders);
  const notebooks = asArray(input && input.notebooks);

  const nodes = [];
  const edges = [];
  const folderIds = new Set();
  const notebookById = new Map();

  // Root.
  nodes.push({ id: 'root', type: 'root', label: 'Library' });

  // Folder nodes.
  for (const f of folders) {
    if (!f || f.id == null) continue;
    const id = str(f.id);
    folderIds.add(id);
    nodes.push({
      id: 'folder:' + id,
      type: 'folder',
      label: str(f.name) || '(untitled folder)',
      color: f.color != null ? str(f.color) : undefined,
      icon: f.icon != null ? str(f.icon) : undefined
    });
  }

  // Notebook nodes (all notebooks become nodes, organized or not).
  for (const nb of notebooks) {
    if (!nb || nb.id == null) continue;
    const id = str(nb.id);
    if (notebookById.has(id)) continue;
    const node = {
      id: 'notebook:' + id,
      type: 'notebook',
      label: str(nb.title) || id,
      sourceCount: Number.isFinite(nb.sourceCount) ? nb.sourceCount : undefined,
      icon: nb.icon != null ? str(nb.icon) : undefined
    };
    notebookById.set(id, node);
    nodes.push(node);
  }

  // Track which notebooks are filed somewhere so we can mark the rest unorganized.
  const filed = new Set();

  for (const f of folders) {
    if (!f || f.id == null) continue;
    const fid = str(f.id);
    const parent = f.parentId != null ? str(f.parentId) : null;

    // Containment among folders.
    if (parent && folderIds.has(parent)) {
      edges.push({ source: 'folder:' + parent, target: 'folder:' + fid, type: 'subfolder' });
    } else {
      edges.push({ source: 'root', target: 'folder:' + fid, type: 'subfolder' });
    }

    // Folder -> notebooks it holds.
    for (const nbId of asArray(f.notebookIds)) {
      const id = str(nbId);
      // Reference even notebooks we did not get full metadata for, so the graph
      // is complete from the folder structure alone.
      if (!notebookById.has(id)) {
        const node = { id: 'notebook:' + id, type: 'notebook', label: id };
        notebookById.set(id, node);
        nodes.push(node);
      }
      filed.add(id);
      edges.push({ source: 'folder:' + fid, target: 'notebook:' + id, type: 'contains' });
    }
  }

  // Unorganized notebooks hang off the root.
  for (const [id] of notebookById) {
    if (!filed.has(id)) {
      edges.push({ source: 'root', target: 'notebook:' + id, type: 'unorganized' });
    }
  }

  // Optional shared-topic cross-links between notebooks.
  const byTopic = new Map();
  for (const nb of notebooks) {
    if (!nb || nb.id == null) continue;
    const id = str(nb.id);
    const topics = asArray(nb.topics).concat(asArray(nb.tags));
    for (const t of topics) {
      const key = str(t).toLowerCase().trim();
      if (!key) continue;
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push(id);
    }
  }
  const seenPair = new Set();
  for (const [topic, ids] of byTopic) {
    const uniq = Array.from(new Set(ids));
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i], b = uniq[j];
        const pk = a < b ? a + '|' + b + '|' + topic : b + '|' + a + '|' + topic;
        if (seenPair.has(pk)) continue;
        seenPair.add(pk);
        edges.push({ source: 'notebook:' + a, target: 'notebook:' + b, type: 'shared-topic', topic });
      }
    }
  }

  return { nodes, edges };
}

// JSON envelope with metadata. `generatedAt` is injected by the caller (the lib
// stays free of Date so it is deterministic and testable).
function toJSON(graph, meta) {
  const envelope = {
    version: SCHEMA_VERSION,
    kind: 'notebooklm-knowledge-graph',
    generatedAt: (meta && meta.generatedAt) || null,
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      folders: graph.nodes.filter(n => n.type === 'folder').length,
      notebooks: graph.nodes.filter(n => n.type === 'notebook').length
    },
    graph
  };
  return JSON.stringify(envelope, null, 2);
}

function xmlEscape(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// GraphML serialization (yEd / Gephi / Cytoscape compatible).
function toGraphML(graph, meta) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns">');
  // Attribute keys.
  lines.push('  <key id="label" for="node" attr.name="label" attr.type="string"/>');
  lines.push('  <key id="type" for="node" attr.name="type" attr.type="string"/>');
  lines.push('  <key id="color" for="node" attr.name="color" attr.type="string"/>');
  lines.push('  <key id="icon" for="node" attr.name="icon" attr.type="string"/>');
  lines.push('  <key id="sourceCount" for="node" attr.name="sourceCount" attr.type="int"/>');
  lines.push('  <key id="etype" for="edge" attr.name="type" attr.type="string"/>');
  lines.push('  <key id="topic" for="edge" attr.name="topic" attr.type="string"/>');
  if (meta && meta.generatedAt) {
    lines.push('  <!-- generatedAt: ' + xmlEscape(meta.generatedAt) + ' -->');
  }
  lines.push('  <graph id="G" edgedefault="directed">');

  for (const n of graph.nodes) {
    lines.push('    <node id="' + xmlEscape(n.id) + '">');
    lines.push('      <data key="label">' + xmlEscape(n.label) + '</data>');
    lines.push('      <data key="type">' + xmlEscape(n.type) + '</data>');
    if (n.color !== undefined) lines.push('      <data key="color">' + xmlEscape(n.color) + '</data>');
    if (n.icon !== undefined) lines.push('      <data key="icon">' + xmlEscape(n.icon) + '</data>');
    if (n.sourceCount !== undefined) lines.push('      <data key="sourceCount">' + n.sourceCount + '</data>');
    lines.push('    </node>');
  }
  let i = 0;
  for (const e of graph.edges) {
    lines.push('    <edge id="e' + (i++) + '" source="' + xmlEscape(e.source) + '" target="' + xmlEscape(e.target) + '">');
    lines.push('      <data key="etype">' + xmlEscape(e.type) + '</data>');
    if (e.topic !== undefined) lines.push('      <data key="topic">' + xmlEscape(e.topic) + '</data>');
    lines.push('    </edge>');
  }
  lines.push('  </graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}

module.exports = { buildGraph, toJSON, toGraphML, SCHEMA_VERSION };
