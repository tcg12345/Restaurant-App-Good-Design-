// Build script: converts the "Michelin Starred Restaurants Worldwide" .xlsx
// export into a compact JSON dataset bundled at src/data/michelin.json.
//
// The source spreadsheet is an uploaded artifact (NOT committed). Re-run this
// only when a refreshed sheet is provided:
//
//   node scripts/build-michelin-data.mjs <path-to.xlsx>
//
// It depends only on Node's stdlib (zlib + manual XLSX parsing) so it works in
// CI without extra packages. The .xlsx stores its rows as inline strings (no
// sharedStrings.xml), which this parser handles.
//
// Output record shape (keys kept short to shrink the bundle):
//   n  = restaurant name
//   c  = city
//   co = country
//   s  = stars (1 | 2 | 3)
//   pt = price tier (1-4), derived from the count of currency symbols
//   cu = cuisine string (verbatim, may be comma-separated)
//   u  = Michelin Guide URL
//   g  = green star (boolean, only present/true when awarded)

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal ZIP reader (stored + deflate entries) ──────────────────────────
function readZipEntries(buf) {
  const entries = new Map();
  // Walk local file headers (signature 0x04034b50).
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
  if (entries.size === 0) {
    throw new Error('Could not parse ZIP via local headers; unexpected format.');
  }
  return entries;
}

// ── XLSX cell helpers ──────────────────────────────────────────────────────
function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// Parse a worksheet XML into an array of rows (each row = array of cell strings).
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
      // inline string <is><t>...</t></is>, shared/str via <v>, etc.
      let val = '';
      const tMatches = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
      if (tMatches.length > 0) {
        val = tMatches.map((m) => m[1]).join('');
      } else {
        const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        if (vM) val = vM[1];
      }
      cells[ci] = decodeXmlEntities(val);
    }
    const max = Object.keys(cells).length ? Math.max(...Object.keys(cells).map(Number)) : -1;
    const arr = [];
    for (let k = 0; k <= max; k++) arr.push(cells[k] ?? '');
    rows.push(arr);
  }
  return rows;
}

// ── Main ───────────────────────────────────────────────────────────────────
const srcPath = process.argv[2]
  || '/root/.claude/uploads/bf38a952-3fb4-4dc3-b91d-e3ef7c81072c/e4eb7836-Michelin_Starred_Restaurants_Worldwide.xlsx';
const outPath = resolve(__dirname, '..', 'src', 'data', 'michelin.json');

const buf = readFileSync(srcPath);
const entries = readZipEntries(buf);

// Find the first worksheet (sheet1 is the data sheet, sheet2 is the summary).
const sheetXml = entries.get('xl/worksheets/sheet1.xml');
if (!sheetXml) throw new Error('xl/worksheets/sheet1.xml not found in workbook');
const rows = parseSheet(sheetXml.toString('utf8'));

const header = rows[0].map((h) => h.trim());
const idx = (name) => header.indexOf(name);
const iName = idx('Restaurant');
const iStars = idx('Stars');
const iCity = idx('City');
const iCountry = idx('Country');
const iCuisine = idx('Cuisine');
const iPrice = idx('Price');
const iGreen = idx('Green Star');
const iUrl = idx('Michelin Guide URL');

for (const [label, i] of [
  ['Restaurant', iName], ['Stars', iStars], ['City', iCity], ['Country', iCountry],
  ['Cuisine', iCuisine], ['Price', iPrice], ['Michelin Guide URL', iUrl],
]) {
  if (i < 0) throw new Error(`Expected column "${label}" not found. Header: ${header.join(', ')}`);
}

const out = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const name = (row[iName] || '').trim();
  if (!name) continue;
  const starsRaw = (row[iStars] || '').trim();
  const stars = parseInt(starsRaw, 10);
  if (!(stars >= 1 && stars <= 3)) continue; // dataset is 1/2/3-star only
  const priceStr = (row[iPrice] || '').trim();
  // Price tier = number of currency symbols (each tier is one repeated glyph).
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
  if (iGreen >= 0 && (row[iGreen] || '').trim()) rec.g = true;
  out.push(rec);
}

writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${out.length} records to ${outPath}`);
const byStars = out.reduce((acc, r) => ((acc[r.s] = (acc[r.s] || 0) + 1), acc), {});
console.log('Stars distribution:', byStars);
