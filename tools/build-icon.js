// Generates build/icon.png: the Atlas app icon (a violet gradient with the
// "constellation" graph mark). Pure Node, no dependencies. electron-builder
// converts this PNG into .ico / .icns for the installers.
// Run: node tools/build-icon.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const buf = Buffer.alloc(S * S * 4);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const ca = a / 255;
  buf[i] = Math.round(buf[i] * (1 - ca) + r * ca);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - ca) + g * ca);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - ca) + b * ca);
  buf[i + 3] = 255;
}
function lerp(a, b, t) { return a + (b - a) * t; }

// Background: diagonal violet gradient #1e1b4b -> #7c3aed.
const c0 = [30, 27, 75], c1 = [124, 58, 237];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = (x + y) / (2 * S);
    const i = (y * S + x) * 4;
    buf[i] = Math.round(lerp(c0[0], c1[0], t));
    buf[i + 1] = Math.round(lerp(c0[1], c1[1], t));
    buf[i + 2] = Math.round(lerp(c0[2], c1[2], t));
    buf[i + 3] = 255;
  }
}

function disc(cx, cy, r, col, a) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) {
        const edge = Math.min(1, r - d);          // 1px antialias
        setPx(x, y, col[0], col[1], col[2], Math.round(a * edge));
      }
    }
  }
}
function line(x0, y0, x1, y1, w, col, a) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(Math.round(lerp(x0, x1, t)), Math.round(lerp(y0, y1, t)), w, col, a);
  }
}

const root = [256, 256];
const nodes = [[150, 150, 34, [196, 181, 253]], [382, 162, 28, [167, 139, 250]], [360, 384, 30, [244, 114, 182]]];

// edges
for (const n of nodes) line(root[0], root[1], n[0], n[1], 5, [237, 233, 254], 150);
// satellite nodes
for (const n of nodes) disc(n[0], n[1], n[2], n[3], 255);
// root node
disc(root[0], root[1], 50, [237, 233, 254], 255);
disc(root[0], root[1], 38, [167, 139, 250], 255);

// Encode PNG (truecolor + alpha, filter 0 per scanline).
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter type 0
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, y * S * 4 + S * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${(png.length / 1024).toFixed(1)} KB, ${S}x${S})`);
