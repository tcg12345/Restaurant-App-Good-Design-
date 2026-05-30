// Build script: converts the "Michelin Starred Restaurants Worldwide" export
// into a compact JSON dataset bundled at src/data/michelin.json.
//
// The source spreadsheet/CSV is an uploaded artifact (NOT committed). Re-run
// this only when a refreshed sheet is provided:
//
//   node scripts/build-michelin-data.mjs <path-to.csv|.xlsx>
//
// Accepts either a CSV (preferred — the current source includes Latitude /
// Longitude columns) or the original .xlsx (inline-string worksheet). Depends
// only on Node's stdlib so it works in CI without extra packages.
//
// Output record shape (keys kept short to shrink the bundle):
//   n   = restaurant name
//   c   = city
//   co  = country
//   la  = latitude (number)
//   lng = longitude (number)
//   s   = stars (1 | 2 | 3)
//   pt  = price tier (1-4), derived from the count of currency symbols
//   cu  = cuisine string (verbatim, may be comma-separated)
//   u   = Michelin Guide URL
//   g   = green star (boolean, only present/true when awarded)

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CSV parser (handles quoted fields, escaped quotes, CRLF) ────────────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch === '\r') { /* skip */ }
    else cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ── Minimal ZIP reader (stored + deflate entries) ──────────────────────────
function readZipEntries(buf) {
  const entries = new Map();
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = buf.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = inflateRawSync(comp);
    else throw new Error(`Unsupported zip method ${method} for ${name}`);
    entries.set(name, data);
    i = dataStart + compSize;
  }
  if (entries.size === 0) throw new Error('Could not parse ZIP via local headers.');
  return entries;
}

function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function parseSheet(xml) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let rowM;
  while ((rowM = rowRe.exec(xml))) {
    const rowXml = rowM[1];
    const cells = {};
    let cellM;
    cellRe.lastIndex = 0;
    while ((cellM = cellRe.exec(rowXml))) {
      const attrs = cellM[1] || cellM[3] || '';
      const body = cellM[2] || '';
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      if (!refM) continue;
      const ci = colToIndex(refM[1]);
      let val = '';
      const tMatches = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
      if (tMatches.length > 0) val = tMatches.map((m) => m[1]).join('');
      else { const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body); if (vM) val = vM[1]; }
      cells[ci] = decodeXmlEntities(val);
    }
    const max = Object.keys(cells).length ? Math.max(...Object.keys(cells).map(Number)) : -1;
    const arr = [];
    for (let k = 0; k <= max; k++) arr.push(cells[k] ?? '');
    rows.push(arr);
  }
  return rows;
}

// Read source into a rows array (header + data), from CSV or XLSX.
function loadRows(srcPath) {
  if (/\.csv$/i.test(srcPath)) {
    return parseCSV(readFileSync(srcPath, 'utf8'));
  }
  const entries = readZipEntries(readFileSync(srcPath));
  const sheetXml = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('xl/worksheets/sheet1.xml not found in workbook');
  return parseSheet(sheetXml.toString('utf8'));
}

// ── Main ───────────────────────────────────────────────────────────────────
const srcPath = process.argv[2]
  || '/root/.claude/uploads/c1007693-b945-40a2-aad8-fe85135ec6fa/175b29ca-Michelin_StarredTable_1.csv';
const outPath = resolve(__dirname, '..', 'src', 'data', 'michelin.json');

const rows = loadRows(srcPath);
const header = rows[0].map((h) => h.trim());
const idx = (name) => header.indexOf(name);
const iName = idx('Restaurant');
const iStars = idx('Stars');
const iCity = idx('City');
const iCountry = idx('Country');
const iLat = idx('Latitude');
const iLng = idx('Longitude');
const iCuisine = idx('Cuisine');
const iPrice = idx('Price');
const iGreen = idx('Green Star');
const iUrl = idx('Michelin Guide URL');

for (const [label, i] of [
  ['Restaurant', iName], ['Stars', iStars], ['City', iCity], ['Country', iCountry],
  ['Latitude', iLat], ['Longitude', iLng],
  ['Cuisine', iCuisine], ['Price', iPrice], ['Michelin Guide URL', iUrl],
]) {
  if (i < 0) throw new Error(`Expected column "${label}" not found. Header: ${header.join(', ')}`);
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

const out = [];
let skippedNoCoord = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.length <= 1) continue;
  const name = (row[iName] || '').trim();
  if (!name) continue;
  const stars = parseInt((row[iStars] || '').trim(), 10);
  if (!(stars >= 1 && stars <= 3)) continue; // dataset is 1/2/3-star only
  const la = parseFloat(row[iLat]);
  const lng = parseFloat(row[iLng]);
  const hasCoord = Number.isFinite(la) && Number.isFinite(lng)
    && !(la === 0 && lng === 0) && la >= -90 && la <= 90 && lng >= -180 && lng <= 180;
  if (!hasCoord) skippedNoCoord++;
  const priceStr = (row[iPrice] || '').trim();
  const priceTier = Math.min(4, [...priceStr].length) || 0;
  const rec = {
    n: name,
    c: (row[iCity] || '').trim(),
    co: (row[iCountry] || '').trim(),
    s: stars,
    pt: priceTier,
    cu: (row[iCuisine] || '').trim(),
    u: (row[iUrl] || '').trim(),
  };
  if (hasCoord) { rec.la = round6(la); rec.lng = round6(lng); }
  if (iGreen >= 0 && (row[iGreen] || '').trim()) rec.g = true;
  out.push(rec);
}

writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${out.length} records to ${outPath}`);
const byStars = out.reduce((acc, r) => ((acc[r.s] = (acc[r.s] || 0) + 1), acc), {});
console.log('Stars distribution:', byStars);
console.log('With coordinates:', out.filter((r) => r.la != null).length, '/ rows missing coords:', skippedNoCoord);
