// Integration test: the server serves the user's LIVE folders from a connected
// extension (ADR-0017), falling back to folders.json when none is connected.
// A WebSocket client stands in for the extension's background worker, replying to
// list_folders / list_notebooks exactly as the real relay does.
// Run: node tests/folders-live.test.js

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { spawn } = require('child_process');

const DIR = path.join(__dirname, '..');
const FOLDERS = path.join(DIR, 'folders.json');
const PORT = 3521;

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(b); } });
    }).on('error', reject);
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const had = fs.existsSync(FOLDERS);
  const backup = had ? fs.readFileSync(FOLDERS) : null;
  // A DIFFERENT folder set on disk, so we can prove "live" wins over disk.
  fs.writeFileSync(FOLDERS, JSON.stringify({ folders: [{ id: 'disk1', name: 'OnDisk', parentId: null, notebookIds: [] }] }, null, 2));

  const child = spawn(process.execPath, ['server.js'], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  let ws;
  let ok = false;
  try {
    for (let i = 0; i < 50; i++) { try { const s = await getJson('/status'); if (s.status === 'online') break; } catch (e) {} await wait(100); }

    // ---- no extension connected: falls back to folders.json ----
    const diskRes = await getJson('/api/folders');
    check('with no extension, /api/folders falls back to folders.json',
      Array.isArray(diskRes.folders) && diskRes.folders.length === 1 && diskRes.folders[0].id === 'disk1');

    // ---- connect a stand-in extension over WebSocket ----
    const liveFolders = [
      { id: 'L1', name: 'Compliance', parentId: null, notebookIds: ['n1', 'n2'] },
      { id: 'L2', name: 'Audit', parentId: 'L1', notebookIds: ['n2'] }
    ];
    const liveNotebooks = [{ id: 'n1', title: 'SOC 2' }, { id: 'n2', title: 'Evidence' }];
    ws = new WebSocket('ws://127.0.0.1:' + PORT);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.type === 'ping') return;
      if (m.type === 'list_folders') ws.send(JSON.stringify({ id: m.id, type: 'response', data: { folders: liveFolders } }));
      else if (m.type === 'list_notebooks') ws.send(JSON.stringify({ id: m.id, type: 'response', data: liveNotebooks }));
    });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    await wait(150); // let the server register the client

    // ---- now the live folders win ----
    const liveRes = await getJson('/api/folders');
    check('with the extension connected, /api/folders returns LIVE folders',
      liveRes.folders.length === 2 && liveRes.folders.some(f => f.id === 'L1') && !liveRes.folders.some(f => f.id === 'disk1'));

    // ---- graph + podcast plan use the live snapshot too ----
    const graph = await getJson('/api/graph');
    check('the knowledge graph uses live folders + notebooks',
      graph.counts.folders === 2 && graph.counts.notebooks === 2);

    const pod = await getJson('/api/folders/L1/podcast/plan');
    check('podcast plan resolves notebook titles from the live snapshot',
      pod.episodes.length === 2 && pod.episodes[0].title.indexOf('SOC 2') !== -1);

    ok = true;
    console.log(`\n${passed}/${passed} folders-live assertions passed.`);
  } finally {
    if (ws) try { ws.close(); } catch (e) {}
    child.kill();
    if (backup) fs.writeFileSync(FOLDERS, backup); else { try { fs.unlinkSync(FOLDERS); } catch (e) {} }
  }
  if (!ok) process.exit(1);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
