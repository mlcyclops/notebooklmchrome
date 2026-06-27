// Cross-browser packaging for the extension (ADR-0012).
//
// Produces per-browser builds from the single source in extension/:
//   dist/chrome/  + dist/chrome.zip   (also the Edge build; Edge is Chromium)
//   dist/edge/    + dist/edge.zip     (identical to chrome, named for clarity)
//   dist/firefox/ + dist/firefox.zip  (MV3 manifest adapted for Gecko)
//
// Dependency-free: includes a tiny store-only ZIP writer (no external deps, works
// on any OS) so the zips are real, submittable archives.
//
// Run: node tools/package-extension.js   (or: npm run package)

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

const GECKO_ID = 'folderizer@notebooklm.local';
const GECKO_MIN = '115.0';

// ---- Firefox manifest adaptation ---------------------------------------
// Chrome MV3 uses background.service_worker; Firefox MV3 uses background.scripts
// (event page) and requires a browser_specific_settings.gecko id.
function adaptManifestForFirefox(manifest) {
  const m = JSON.parse(JSON.stringify(manifest));
  const worker = m.background && m.background.service_worker;
  m.background = { scripts: [worker || 'background.js'] };
  m.browser_specific_settings = Object.assign(
    { gecko: { id: GECKO_ID, strict_min_version: GECKO_MIN } },
    m.browser_specific_settings || {}
  );
  return m;
}

// ---- Minimal store-only ZIP writer -------------------------------------
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// Fixed DOS timestamp (1980-01-01 00:00) so builds are deterministic.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

function zipStore(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(0, 8);           // method 0 = store
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra len
    ch.writeUInt16LE(0, 32);          // comment len
    ch.writeUInt16LE(0, 34);          // disk number
    ch.writeUInt16LE(0, 36);          // internal attrs
    ch.writeUInt32LE(0, 38);          // external attrs
    ch.writeUInt32LE(offset, 42);     // local header offset
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const localsBuf = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localsBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localsBuf, centralBuf, eocd]);
}

// ---- Build -------------------------------------------------------------
function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function build() {
  const srcFiles = fs.readdirSync(SRC).filter(f => fs.statSync(path.join(SRC, f)).isFile());
  const baseManifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });

  const targets = ['chrome', 'edge', 'firefox'];
  const summary = [];

  for (const target of targets) {
    const outDir = path.join(DIST, target);
    fs.mkdirSync(outDir, { recursive: true });
    const zipFiles = [];

    for (const name of srcFiles) {
      let data;
      if (name === 'manifest.json') {
        const m = target === 'firefox' ? adaptManifestForFirefox(baseManifest) : baseManifest;
        data = Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8');
      } else {
        data = fs.readFileSync(path.join(SRC, name));
      }
      fs.writeFileSync(path.join(outDir, name), data);
      zipFiles.push({ name, data });
    }

    const zipPath = path.join(DIST, target + '.zip');
    fs.writeFileSync(zipPath, zipStore(zipFiles));
    summary.push({ target, dir: outDir, zip: zipPath, files: zipFiles.length, bytes: fs.statSync(zipPath).size });
  }
  return summary;
}

if (require.main === module) {
  const summary = build();
  for (const s of summary) {
    console.log(`${s.target.padEnd(8)} -> ${path.relative(ROOT, s.dir)}/ and ${path.relative(ROOT, s.zip)} (${s.files} files, ${s.bytes} bytes)`);
  }
  console.log('\nChrome & Edge load the same Chromium build. Firefox uses the Gecko-adapted manifest.');
}

module.exports = { build, adaptManifestForFirefox, zipStore, crc32 };
