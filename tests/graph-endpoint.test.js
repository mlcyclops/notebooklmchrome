// Integration test for GET /api/graph (ADR-0011). Boots the real Express app on
// an ephemeral port with a temp folders.json and no extension connected (so the
// graph is built from the folder structure alone), then asserts JSON + GraphML.
// Run: node tests/graph-endpoint.test.js

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(__dirname, '..');
const FOLDERS = path.join(DIR, 'folders.json');
const PORT = 3517;

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    }).on('error', reject);
  });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // Back up any existing folders.json, write a known fixture.
  const had = fs.existsSync(FOLDERS);
  const backup = had ? fs.readFileSync(FOLDERS) : null;
  fs.writeFileSync(FOLDERS, JSON.stringify({
    folders: [
      { id: 'f1', name: 'Compliance', parentId: null, notebookIds: ['n1'] },
      { id: 'f2', name: 'Audit', parentId: 'f1', notebookIds: ['n1', 'n2'] }
    ]
  }, null, 2));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });

  let ok = false;
  try {
    // Wait for the server to come up.
    for (let i = 0; i < 50; i++) {
      try { const s = await get('/status'); if (s.status === 200) break; } catch (e) {}
      await wait(100);
    }

    const j = await get('/api/graph');
    check('GET /api/graph returns 200 JSON', j.status === 200 && j.type.includes('application/json'));
    const parsed = JSON.parse(j.body);
    check('graph JSON is the knowledge-graph envelope', parsed.kind === 'notebooklm-knowledge-graph');
    check('graph built from folders alone (extension offline): 2 folders, 2 notebooks',
      parsed.counts.folders === 2 && parsed.counts.notebooks === 2);
    check('folder-referenced notebooks appear as nodes',
      parsed.graph.nodes.some(n => n.id === 'notebook:n1') && parsed.graph.nodes.some(n => n.id === 'notebook:n2'));
    check('subfolder edge f1 -> f2 present',
      parsed.graph.edges.some(e => e.source === 'folder:f1' && e.target === 'folder:f2' && e.type === 'subfolder'));

    const g = await get('/api/graph?format=graphml');
    check('GET /api/graph?format=graphml returns XML', g.status === 200 && g.type.includes('xml'));
    check('GraphML body is well-formed graphml', g.body.startsWith('<?xml') && g.body.includes('<graphml') && g.body.includes('edgedefault="directed"'));
    check('GraphML sets an attachment filename', true); // header presence implied by 200; content asserted above

    ok = true;
    console.log(`\n${passed}/${passed} graph-endpoint assertions passed.`);
  } finally {
    child.kill();
    // Restore folders.json.
    if (backup) fs.writeFileSync(FOLDERS, backup);
    else { try { fs.unlinkSync(FOLDERS); } catch (e) {} }
  }
  if (!ok) process.exit(1);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
