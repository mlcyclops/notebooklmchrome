// Integration test for the automation endpoints (ADR-0013). Boots the real
// Express app with a temp folders.json and no extension connected, then asserts
// the dry-run plan endpoints, the watch lifecycle, and that execute endpoints
// fail gracefully (per-job errors, never a crash) when the extension is offline.
// Run: node tests/automation-endpoint.test.js

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(__dirname, '..');
const FOLDERS = path.join(DIR, 'folders.json');
const PORT = 3518;

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, json: null, raw: b }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const had = fs.existsSync(FOLDERS);
  const backup = had ? fs.readFileSync(FOLDERS) : null;
  fs.writeFileSync(FOLDERS, JSON.stringify({
    folders: [{ id: 'f1', name: 'Compliance', parentId: null, notebookIds: ['n1', 'n2'] }]
  }, null, 2));

  const child = spawn(process.execPath, ['server.js'], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  let ok = false;
  try {
    for (let i = 0; i < 50; i++) { try { const s = await req('GET', '/status'); if (s.status === 200) break; } catch (e) {} await wait(100); }

    // ---- plan endpoints (no extension) ----
    const pod = await req('GET', '/api/folders/f1/podcast/plan');
    check('GET podcast/plan returns one episode per notebook', pod.status === 200 && pod.json.episodes.length === 2);
    check('podcast plan uses audio-overview format', pod.json.episodes.every(e => e.format === 'audio-overview'));

    const sp = await req('GET', '/api/folders/f1/study-pack/plan');
    check('GET study-pack/plan returns notebooks x 4 formats', sp.status === 200 && sp.json.jobs.length === 8);
    const spLimited = await req('GET', '/api/folders/f1/study-pack/plan?formats=faq');
    check('study-pack/plan honors a formats query', spLimited.json.jobs.length === 2 && spLimited.json.jobs.every(j => j.format === 'faq'));

    const missing = await req('GET', '/api/folders/nope/podcast/plan');
    check('plan for a missing folder is empty, not an error', missing.status === 200 && missing.json.episodes.length === 0);

    // ---- execute with extension offline: graceful per-job failure ----
    const run = await req('POST', '/api/folders/f1/podcast', {});
    check('POST podcast returns a plan + results array', run.status === 200 && Array.isArray(run.json.results));
    check('every job failed gracefully (no extension) without crashing the server',
      run.json.results.length === 2 && run.json.results.every(r => r.ok === false && typeof r.error === 'string'));

    const dry = await req('POST', '/api/folders/f1/study-pack?dryRun=1', {});
    check('POST ?dryRun=1 returns the plan and skips execution', dry.json.dryRun === true && dry.json.results === null);

    // ---- watch lifecycle ----
    const start = await req('POST', '/api/watch', { intervalMs: 5000, autoGenerate: false });
    check('POST /api/watch starts the watcher', start.json.active === true && start.json.intervalMs === 5000);

    const statusOn = await req('GET', '/api/watch');
    check('GET /api/watch reports active', statusOn.json.active === true);

    // Mutate folders.json to add a notebook, then ask what watch would regenerate.
    fs.writeFileSync(FOLDERS, JSON.stringify({
      folders: [{ id: 'f1', name: 'Compliance', parentId: null, notebookIds: ['n1', 'n2', 'n3'] }]
    }, null, 2));
    const wplan = await req('GET', '/api/watch/plan');
    check('GET /api/watch/plan detects the newly added notebook', wplan.json.changes.length === 1 && wplan.json.changes[0].addedNotebookIds.join(',') === 'n3');
    check('watch/plan turns the change into regen jobs (podcast + study pack)', wplan.json.jobs.length === 1 + 4);

    const stop = await req('POST', '/api/watch/stop', {});
    check('POST /api/watch/stop stops the watcher', stop.json.active === false);

    ok = true;
    console.log(`\n${passed}/${passed} automation-endpoint assertions passed.`);
  } finally {
    child.kill();
    if (backup) fs.writeFileSync(FOLDERS, backup); else { try { fs.unlinkSync(FOLDERS); } catch (e) {} }
  }
  if (!ok) process.exit(1);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
