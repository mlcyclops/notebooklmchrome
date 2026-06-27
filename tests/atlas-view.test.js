// Tests for atlas/atlas-view.js (ADR-0014). Dependency-free.
// Run: node tests/atlas-view.test.js

const assert = require('assert');
const V = require('../atlas/atlas-view');

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

// ---- buildSidebar ----
const folders = [
  { id: 'f1', name: 'Compliance', parentId: null, notebookIds: ['n1', 'n2'] },
  { id: 'f2', name: 'Audit', parentId: 'f1', notebookIds: ['n2'] },
  { id: 'f3', name: 'Cloud', parentId: null, notebookIds: [] }
];
const rows = V.buildSidebar(folders);
check('buildSidebar returns one row per folder', rows.length === 3);
check('buildSidebar nests children under parents with depth', rows[0].id === 'f1' && rows[1].id === 'f2' && rows[1].depth === 1);
check('buildSidebar counts notebooks per folder', rows[0].count === 2 && rows[2].count === 0);
check('buildSidebar tolerates empty input', V.buildSidebar(null).length === 0);

// ---- graphStats ----
const envelope = { graph: { nodes: [
  { id: 'root', type: 'root' }, { id: 'folder:f1', type: 'folder' },
  { id: 'notebook:n1', type: 'notebook' }, { id: 'notebook:n2', type: 'notebook' }
], edges: [{}, {}, {}] } };
const stats = V.graphStats(envelope);
check('graphStats counts folders/notebooks/edges from an envelope', stats.folders === 1 && stats.notebooks === 2 && stats.edges === 3);
check('graphStats also accepts a raw {nodes,edges} graph', V.graphStats(envelope.graph).notebooks === 2);

// ---- episodeRows ----
const eps = V.episodeRows({ episodes: [{ episode: 1, title: 'A', notebookId: 'n1' }, { episode: 2, title: 'B', notebookId: 'n2' }] });
check('episodeRows maps episodes with a default status', eps.length === 2 && eps[0].status === 'Planned' && eps[1].title === 'B');

// ---- studyGroups ----
const groups = V.studyGroups({ jobs: [
  { format: 'faq' }, { format: 'faq' }, { format: 'timeline' }
] });
const byFmt = Object.fromEntries(groups.map(g => [g.format, g.count]));
check('studyGroups tallies jobs per format', byFmt.faq === 2 && byFmt.timeline === 1);

// ---- summarizeResults ----
const sum = V.summarizeResults([{ ok: true }, { ok: false }, { ok: true }]);
check('summarizeResults tallies ok/failed/total', sum.total === 3 && sum.ok === 2 && sum.failed === 1);

// ---- connectionLabel ----
check('connectionLabel: connected when a client is present', V.connectionLabel({ connectedClients: 1 }) === 'Connected');
check('connectionLabel: no extension when zero clients', V.connectionLabel({ connectedClients: 0 }) === 'No extension');
check('connectionLabel: offline when no status', V.connectionLabel(null) === 'Offline');

console.log(`\n${passed}/${passed} atlas-view assertions passed.`);
