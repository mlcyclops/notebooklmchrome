// Tests for the desktop packaging + in-process server boot (ADR-0015).
// Does NOT launch Electron (heavy); instead it verifies the mechanism the
// Electron main relies on: server.js exports start(), starting it in-process
// serves Atlas, and the electron-builder config + icon are valid.
// Run: node tests/desktop.test.js

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

const ROOT = path.join(__dirname, '..');
const PORT = 3520;

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: b }));
    }).on('error', reject);
  });
}

(async () => {
  // ---- server module contract (used by desktop/main.js) ----
  const mod = require('../server');
  check('server.js exports a start() function', typeof mod.start === 'function');
  check('requiring server.js does NOT auto-listen (guarded by require.main)', !mod.server.listening);

  // ---- in-process boot (exactly what Electron main does) ----
  const srv = await mod.start(PORT);
  check('start(port) resolves and the server is listening', mod.server.listening === true && !!srv);
  const atlas = await get('/atlas/');
  check('the booted server serves Atlas at /atlas/', atlas.status === 200 && atlas.body.includes('Research'));
  const status = await get('/status');
  check('the booted server answers /status', status.status === 200);
  await new Promise(r => mod.server.close(r));
  check('server closes cleanly', mod.server.listening === false);

  // ---- electron-builder config ----
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('package main points at the Electron entry', pkg.main === 'desktop/main.js');
  const b = pkg.build;
  check('build config present with appId + productName', b && b.appId && b.productName === 'Atlas Studio');
  check('build bundles server, lib, atlas, and desktop', ['desktop/**/*', 'server.js', 'lib/**/*', 'atlas/**/*'].every(g => b.files.includes(g)));
  check('the browser extension is bundled as an extra resource', Array.isArray(b.extraResources) && b.extraResources.some(r => (r.from || r) === 'extension'));
  check('Windows target is the NSIS installer', b.win.target.includes('nsis'));
  check('macOS target is a dmg', b.mac.target.includes('dmg'));
  check('desktop scripts are wired (desktop / dist:win / dist:mac)', !!(pkg.scripts.desktop && pkg.scripts['dist:win'] && pkg.scripts['dist:mac']));

  // ---- icon ----
  const iconPath = path.join(ROOT, b.win.icon);
  check('app icon exists at the configured path', fs.existsSync(iconPath));
  const icon = fs.readFileSync(iconPath);
  check('app icon is a valid PNG of at least 256px', icon.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && icon.readUInt32BE(16) >= 256);

  console.log(`\n${passed}/${passed} desktop assertions passed.`);
  process.exit(0);
})().catch(err => { console.error('TEST FAILURE:', err); process.exit(1); });
