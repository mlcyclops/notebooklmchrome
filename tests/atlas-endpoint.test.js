// Integration test: the companion server serves the Atlas app (ADR-0014).
// Run: node tests/atlas-endpoint.test.js

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(__dirname, '..');
const PORT = 3519;

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: b }));
    }).on('error', reject);
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: DIR, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  let ok = false;
  try {
    for (let i = 0; i < 50; i++) { try { const s = await get('/status'); if (s.status === 200) break; } catch (e) {} await wait(100); }

    const index = await get('/atlas/');
    check('GET /atlas/ serves HTML', index.status === 200 && index.type.includes('text/html'));
    check('Atlas index references the app title and scripts',
      index.body.includes('Research') && index.body.includes('atlas-view.js') && index.body.includes('app.js'));

    const view = await get('/atlas/atlas-view.js');
    check('serves atlas-view.js as JavaScript', view.status === 200 && /javascript|ecmascript/.test(view.type) && view.body.includes('buildSidebar'));

    const app = await get('/atlas/app.js');
    check('serves app.js', app.status === 200 && app.body.includes('Podcast'));

    const css = await get('/atlas/style.css');
    check('serves style.css', css.status === 200 && css.type.includes('text/css'));

    ok = true;
    console.log(`\n${passed}/${passed} atlas-endpoint assertions passed.`);
  } finally {
    child.kill();
  }
  if (!ok) process.exit(1);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
