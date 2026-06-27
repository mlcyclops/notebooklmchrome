// Tests for lib/knowledge-graph.js (ADR-0011). Dependency-free.
// Run: node tests/knowledge-graph.test.js

const assert = require('assert');
const { buildGraph, toJSON, toGraphML, SCHEMA_VERSION } = require('../lib/knowledge-graph');

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

const folders = [
  { id: 'f1', name: 'Compliance', parentId: null, notebookIds: ['n1', 'n2'], color: '#a78bfa', icon: '\u{1F4C1}' },
  { id: 'f2', name: 'Audit', parentId: 'f1', notebookIds: ['n2'] }, // n2 is shared across f1 & f2
  { id: 'f3', name: 'Empty', parentId: null, notebookIds: [] }
];
const notebooks = [
  { id: 'n1', title: 'SOC 2', sourceCount: 3, topics: ['security'] },
  { id: 'n2', title: 'Evidence', sourceCount: 5, tags: ['security'] },
  { id: 'n3', title: 'Loose note' } // unorganized, not in any folder
];

const g = buildGraph({ folders, notebooks });
const nodeIds = new Set(g.nodes.map(n => n.id));

// ---- nodes ----
check('has a synthetic root node', nodeIds.has('root'));
check('creates a node per folder', nodeIds.has('folder:f1') && nodeIds.has('folder:f2') && nodeIds.has('folder:f3'));
check('creates a node per notebook', nodeIds.has('notebook:n1') && nodeIds.has('notebook:n2') && nodeIds.has('notebook:n3'));
check('folder node carries label/color/icon', g.nodes.find(n => n.id === 'folder:f1').label === 'Compliance' && g.nodes.find(n => n.id === 'folder:f1').color === '#a78bfa');
check('notebook node carries title + sourceCount', g.nodes.find(n => n.id === 'notebook:n1').label === 'SOC 2' && g.nodes.find(n => n.id === 'notebook:n1').sourceCount === 3);

// ---- edges ----
const hasEdge = (s, t, type) => g.edges.some(e => e.source === s && e.target === t && (!type || e.type === type));
check('top-level folder links to root', hasEdge('root', 'folder:f1', 'subfolder') && hasEdge('root', 'folder:f3', 'subfolder'));
check('subfolder links to its parent folder', hasEdge('folder:f1', 'folder:f2', 'subfolder'));
check('folder contains its notebooks', hasEdge('folder:f1', 'notebook:n1', 'contains') && hasEdge('folder:f1', 'notebook:n2', 'contains'));
check('a shared notebook has incoming contains edges from both folders', hasEdge('folder:f1', 'notebook:n2', 'contains') && hasEdge('folder:f2', 'notebook:n2', 'contains'));
check('unorganized notebook hangs off root', hasEdge('root', 'notebook:n3', 'unorganized'));
check('organized notebooks are NOT marked unorganized', !hasEdge('root', 'notebook:n1', 'unorganized'));
check('shared-topic cross-link added between n1 and n2 (both "security")', g.edges.some(e => e.type === 'shared-topic' && ((e.source === 'notebook:n1' && e.target === 'notebook:n2') || (e.source === 'notebook:n2' && e.target === 'notebook:n1'))));

// ---- notebook referenced only by a folder (no metadata) still becomes a node ----
const g2 = buildGraph({ folders: [{ id: 'fa', name: 'A', parentId: null, notebookIds: ['ghost'] }], notebooks: [] });
check('folder-referenced notebook with no metadata still becomes a node', g2.nodes.some(n => n.id === 'notebook:ghost'));

// ---- robustness ----
const empty = buildGraph({});
check('empty input yields just the root node', empty.nodes.length === 1 && empty.nodes[0].id === 'root' && empty.edges.length === 0);
check('null input does not throw', buildGraph(null).nodes.length === 1);

// ---- JSON serialization ----
const json = JSON.parse(toJSON(g, { generatedAt: '2026-06-26T00:00:00Z' }));
check('JSON envelope has version + kind', json.version === SCHEMA_VERSION && json.kind === 'notebooklm-knowledge-graph');
check('JSON envelope carries generatedAt + counts', json.generatedAt === '2026-06-26T00:00:00Z' && json.counts.folders === 3 && json.counts.notebooks === 3);
check('JSON envelope embeds the graph', Array.isArray(json.graph.nodes) && Array.isArray(json.graph.edges));

// ---- GraphML serialization ----
const xml = toGraphML(g, { generatedAt: '2026-06-26T00:00:00Z' });
check('GraphML declares the XML + graphml root', xml.startsWith('<?xml') && xml.includes('<graphml'));
check('GraphML has a directed graph element', xml.includes('edgedefault="directed"'));
check('GraphML emits a node per graph node', g.nodes.every(n => xml.includes('<node id="' + n.id + '">') || xml.includes('<node id="' + n.id.replace(/&/g, '&amp;') + '">')));
check('GraphML emits the right number of edges', (xml.match(/<edge /g) || []).length === g.edges.length);

// ---- XML escaping (injection-safety) ----
const evil = buildGraph({ folders: [{ id: 'x', name: '<script>&"\'', parentId: null, notebookIds: [] }], notebooks: [] });
const evilXml = toGraphML(evil, {});
check('GraphML escapes special characters in labels', evilXml.includes('&lt;script&gt;&amp;&quot;&apos;') && !evilXml.includes('<script>&"'));

console.log(`\n${passed}/${passed} knowledge-graph assertions passed.`);
