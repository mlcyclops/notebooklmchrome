// Tests for tools/package-extension.js (ADR-0012). Dependency-free.
// Validates the per-browser builds AND parses the produced .zip files back,
// recomputing CRC32 for every stored entry to prove the archives are real.
// Run: node tests/packaging.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { build, adaptManifestForFirefox, crc32 } = require('../tools/package-extension');

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed++; console.log('  ok -', name); }

const ROOT = path.join(__dirname, '..');

// ---- manifest adaptation (pure) ----
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
const ff = adaptManifestForFirefox(base);
check('firefox manifest replaces service_worker with background.scripts',
  !ff.background.service_worker && Array.isArray(ff.background.scripts) && ff.background.scripts.includes('background.js'));
check('firefox manifest adds gecko id + min version',
  ff.browser_specific_settings && ff.browser_specific_settings.gecko && ff.browser_specific_settings.gecko.id && ff.browser_specific_settings.gecko.strict_min_version);
check('adaptManifestForFirefox does not mutate the source manifest',
  base.background.service_worker === 'background.js');

// ---- build ----
const summary = build();
check('build produces chrome, edge, firefox targets', summary.map(s => s.target).sort().join(',') === 'chrome,edge,firefox');

for (const t of ['chrome', 'edge', 'firefox']) {
  check(`${t}: unpacked dir + zip exist`,
    fs.existsSync(path.join(ROOT, 'dist', t)) && fs.existsSync(path.join(ROOT, 'dist', t + '.zip')));
  const mPath = path.join(ROOT, 'dist', t, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  if (t === 'firefox') {
    check('firefox built manifest uses background.scripts', Array.isArray(m.background.scripts));
  } else {
    check(`${t} built manifest keeps service_worker (Chromium)`, m.background.service_worker === 'background.js');
  }
}

// ---- minimal ZIP reader: parse central dir, verify every entry's CRC ----
function readZip(buf) {
  // Find End Of Central Directory.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'EOCD found');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < total; n++) {
    assert.strictEqual(buf.readUInt32LE(off), 0x02014b50, 'central header sig');
    const crc = buf.readUInt32LE(off + 16);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // Read local header to find the data start.
    assert.strictEqual(buf.readUInt32LE(localOff), 0x04034b50, 'local header sig');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    entries.push({ name, crc, data });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const zipBuf = fs.readFileSync(path.join(ROOT, 'dist', 'firefox.zip'));
check('firefox.zip starts with PK local-file signature', zipBuf.readUInt32LE(0) === 0x04034b50);
const entries = readZip(zipBuf);
// Count the real source files (recursively) so this stays correct as files are added.
function countFiles(dir) {
  return fs.readdirSync(dir).reduce((n, e) => {
    const abs = path.join(dir, e);
    return n + (fs.statSync(abs).isDirectory() ? countFiles(abs) : 1);
  }, 0);
}
const expected = countFiles(path.join(ROOT, 'extension'));
check('firefox.zip lists every extension file', entries.length === expected && expected >= 4);
check('the manifest icons are bundled (subfolders preserved)',
  entries.some(e => e.name === 'icons/icon128.png'));
check('firefox.zip every stored entry passes a CRC32 round-trip',
  entries.every(e => crc32(e.data) === e.crc));
const zipManifest = entries.find(e => e.name === 'manifest.json');
check('firefox.zip manifest entry is the Gecko-adapted manifest',
  zipManifest && JSON.parse(zipManifest.data.toString('utf8')).browser_specific_settings.gecko.id.length > 0);

console.log(`\n${passed}/${passed} packaging assertions passed.`);
