// Generates assets/folders-hero.svg: a self-contained, GitHub-renderable hero
// frame that embeds the screenshot (base64) inside a premium app-window chrome.
// Run: node tools/build-hero.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'folders-screenshot.png'); // actually JPEG
const OUT = path.join(__dirname, '..', 'assets', 'folders-hero.svg');

const buf = fs.readFileSync(SRC);
const isPng = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
const mime = isPng ? 'image/png' : 'image/jpeg';
const b64 = buf.toString('base64');

// Layout
const IMG_W = 1456, IMG_H = 928;
const BAR = 64;                 // title bar height
const PAD_X = 80, PAD_T = 72, PAD_B = 88;
const WIN_X = PAD_X, WIN_Y = PAD_T, WIN_W = IMG_W, WIN_H = BAR + IMG_H;
const CANVAS_W = WIN_W + PAD_X * 2;
const CANVAS_H = WIN_Y + WIN_H + PAD_B;
const IMG_X = WIN_X, IMG_Y = WIN_Y + BAR;
const barCY = WIN_Y + BAR / 2;
const pillW = 540, pillH = 38;
const pillX = WIN_X + WIN_W / 2 - pillW / 2, pillY = barCY - pillH / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" role="img" aria-label="NotebookLM Folderizer sidebar inside NotebookLM">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ede9fe"/><stop offset="1" stop-color="#f5d0fe"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2350"/><stop offset="1" stop-color="#1e1b3a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#a78bfa" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="win"><rect x="${WIN_X}" y="${WIN_Y}" width="${WIN_W}" height="${WIN_H}" rx="26"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="30" stdDeviation="40" flood-color="#4c1d95" flood-opacity="0.45"/>
    </filter>
  </defs>

  <!-- soft brand glow behind the window -->
  <rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#glow)"/>

  <!-- window -->
  <g filter="url(#shadow)">
    <g clip-path="url(#win)">
      <rect x="${WIN_X}" y="${WIN_Y}" width="${WIN_W}" height="${WIN_H}" fill="#0f0e1a"/>
      <rect x="${WIN_X}" y="${WIN_Y}" width="${WIN_W}" height="${BAR}" fill="url(#bar)"/>
      <image x="${IMG_X}" y="${IMG_Y}" width="${IMG_W}" height="${IMG_H}" preserveAspectRatio="xMidYMid slice" href="data:${mime};base64,${b64}"/>
    </g>
    <rect x="${WIN_X}" y="${WIN_Y}" width="${WIN_W}" height="${WIN_H}" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="2"/>
  </g>

  <!-- traffic lights -->
  <g>
    <circle cx="${WIN_X + 34}" cy="${barCY}" r="8.5" fill="#ff5f57"/>
    <circle cx="${WIN_X + 60}" cy="${barCY}" r="8.5" fill="#febc2e"/>
    <circle cx="${WIN_X + 86}" cy="${barCY}" r="8.5" fill="#28c840"/>
  </g>

  <!-- url pill -->
  <g font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif">
    <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#ffffff" fill-opacity="0.08"/>
    <path d="M${pillX + 26} ${barCY - 5} v-3 a4 4 0 0 1 8 0 v3 M${pillX + 24} ${barCY - 5} h12 v9 h-12 z" fill="none" stroke="#c4b5fd" stroke-width="1.6" stroke-linejoin="round"/>
    <text x="${pillX + 48}" y="${barCY + 5}" fill="#ddd6fe" font-size="20" font-weight="500">notebooklm.google.com</text>
  </g>

  <!-- extension badge (right) -->
  <g font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif">
    <rect x="${WIN_X + WIN_W - 168}" y="${barCY - 16}" width="148" height="32" rx="16" fill="#7c3aed"/>
    <text x="${WIN_X + WIN_W - 94}" y="${barCY + 5}" fill="#ffffff" font-size="18" font-weight="700" text-anchor="middle">Folderizer</text>
  </g>
</svg>
`;

fs.writeFileSync(OUT, svg);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${OUT} (${kb} KB, ${mime}, canvas ${CANVAS_W}x${CANVAS_H})`);
