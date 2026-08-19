#!/usr/bin/env node
/**
 * Phase 4 — verify the OpenStreetMap cuisine lookup against the real
 * Overpass API, and measure what it would actually recover.
 *
 * This exists because the environment the lookup was written in blocks
 * every OSM host, so the one thing that could not be tested there is the
 * live call. Everything either side of it — the query, the name matching,
 * the tag mapping — is covered by src/lib/osm-cuisine.test.ts and shares
 * this script's exact code path (both import
 * supabase/functions/_shared/osm-cuisine.ts). Run this once and the whole
 * chain is confirmed end to end.
 *
 * Usage:
 *   node scripts/probe-overpass.mjs                 # your own blank restaurants
 *   node scripts/probe-overpass.mjs --demo          # no database needed
 *   node scripts/probe-overpass.mjs --limit 40
 *   node scripts/probe-overpass.mjs --name "Falsled Kro" --at 55.126,10.184
 *
 * Env (reads .env.local / .env if present, else the process env):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   — to pick real places
 *
 * Reads only. It never writes to the database; the Edge Function is what
 * publishes results. What you are checking is the hit rate and, more
 * importantly, that the hits are RIGHT — a confidently wrong cuisine is
 * worse than none, so read the matched OSM names, not just the count.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/* ── env ─────────────────────────────────────────────────────────────── */
for (const file of ['.env.local', '.env']) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);

const demo = flag('--demo');
const limit = Number(value('--limit')) || 25;
const oneName = value('--name');
const oneAt = value('--at');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

/* ── the real module, run through the TypeScript stripper ────────────── */
// Node 22.6+ can strip types itself; older versions need --experimental-
// strip-types. Importing the actual file (rather than a copy) is the
// point: this probe must exercise the same code the server does.
let osm;
try {
  osm = await import('../supabase/functions/_shared/osm-cuisine.ts');
} catch (err) {
  console.error(
    'Could not load supabase/functions/_shared/osm-cuisine.ts.\n' +
    'Node needs to strip its types. Try:\n' +
    '  node --experimental-strip-types scripts/probe-overpass.mjs\n' +
    'or upgrade to Node 22.18+, where it is on by default.\n',
    err.message,
  );
  process.exit(1);
}
const { buildOverpassQuery, matchPlace, SEARCH_RADIUS_M, CUISINE_ATTRIBUTION } = osm;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** A handful of real, mapped restaurants — enough to prove the pipeline
 *  works without touching your database. */
const DEMO = [
  { restaurantId: 'demo1', name: 'Noma', lat: 55.682_9, lng: 12.610_3 },
  { restaurantId: 'demo2', name: 'Falsled Kro', lat: 55.126_5, lng: 10.184_5 },
  { restaurantId: 'demo3', name: 'Katz’s Delicatessen', lat: 40.722_2, lng: -73.987_4 },
  { restaurantId: 'demo4', name: 'Franklin Barbecue', lat: 30.270_1, lng: -97.731_2 },
];

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

/** Restaurants your users have rated that still have no usable cuisine,
 *  joined to whatever coordinates the geocode cache holds. */
async function pickBlanks() {
  const ratings = await sb('community_ratings?select=restaurant_id,restaurant_name,cuisine&limit=2000');
  const byId = new Map();
  for (const r of ratings) {
    if (!r.restaurant_id) continue;
    const cuisine = (r.cuisine || '').trim().toLowerCase();
    const usable = cuisine && cuisine !== 'restaurant';
    const seen = byId.get(r.restaurant_id);
    if (usable) { byId.set(r.restaurant_id, { ...(seen || {}), usable: true }); continue; }
    if (!seen?.usable) byId.set(r.restaurant_id, { name: r.restaurant_name || seen?.name || '', usable: false });
  }
  const blanks = [...byId.entries()].filter(([, v]) => !v.usable && v.name);

  // Already answered by the shared cache? Then it is not a gap any more.
  const known = new Set();
  for (let i = 0; i < blanks.length; i += 100) {
    const ids = blanks.slice(i, i + 100).map(([id]) => `"${id}"`).join(',');
    for (const row of await sb(`restaurant_cuisine?select=restaurant_id&restaurant_id=in.(${ids})`)) {
      known.add(row.restaurant_id);
    }
  }

  const open = blanks.filter(([id]) => !known.has(id)).slice(0, limit);
  const out = [];
  for (let i = 0; i < open.length; i += 100) {
    const ids = open.slice(i, i + 100).map(([id]) => `"${id}"`).join(',');
    const geo = new Map(
      (await sb(`restaurant_geo?select=restaurant_id,lat,lng&restaurant_id=in.(${ids})`))
        .map((g) => [g.restaurant_id, g]),
    );
    for (const [id, v] of open.slice(i, i + 100)) {
      const g = geo.get(id);
      if (!g) continue;
      out.push({ restaurantId: id, name: v.name, lat: g.lat, lng: g.lng });
    }
  }
  console.log(`${blanks.length} rated places with no cuisine, ${open.length} not yet cached, ${out.length} with known coordinates.\n`);
  return out;
}

async function ask(query) {
  for (const url of ENDPOINTS) {
    process.stdout.write(`→ ${url} … `);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'GourmetCanvas/1.0 (cuisine lookup probe)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) { console.log(`HTTP ${res.status}`); continue; }
      const body = await res.json();
      console.log(`${body.elements?.length ?? 0} elements in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return body.elements || [];
    } catch (err) {
      console.log(`failed (${err.message})`);
    }
  }
  return null;
}

/* ── run ─────────────────────────────────────────────────────────────── */
let places;
if (oneName) {
  const [lat, lng] = (oneAt || '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('--name needs --at "lat,lng"'); process.exit(1);
  }
  places = [{ restaurantId: 'probe', name: oneName, lat, lng }];
} else if (demo || !SUPABASE_URL || !SUPABASE_KEY) {
  if (!demo) console.log('No VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — running --demo.\n');
  places = DEMO;
} else {
  places = await pickBlanks();
}

if (places.length === 0) {
  console.log('Nothing to look up. Either every rated place already has a cuisine, or none have cached coordinates.');
  process.exit(0);
}

console.log(`Asking Overpass about ${places.length} place(s), ${SEARCH_RADIUS_M}m each.\n`);
const query = buildOverpassQuery(places);
if (flag('--print-query')) console.log(`${query}\n`);

const elements = await ask(query);
if (elements === null) {
  console.error('\nEvery Overpass mirror failed. That is a network or availability problem, not a code one — retry later.');
  process.exit(1);
}
const withCuisine = elements.filter((e) => e.tags?.cuisine).length;
console.log(`  ${withCuisine} of them carry a cuisine tag.\n`);

let hits = 0;
for (const place of places) {
  const m = matchPlace(place, elements);
  if (m) {
    hits++;
    console.log(`  ✓ ${place.name}`);
    console.log(`      → ${m.label}${m.canonical ? '' : '  (outside our taxonomy)'}`);
    console.log(`      matched "${m.osmName}" at ${Math.round(m.distanceM)}m, cuisine=${m.rawCuisine}`);
  } else {
    console.log(`  · ${place.name} — nothing in OSM`);
  }
}

const pct = ((hits / places.length) * 100).toFixed(0);
console.log(`\n${hits}/${places.length} recovered (${pct}%).`);
console.log('Read the matched names above, not just the number: a confidently wrong cuisine is worse than none.');
console.log(`\n${CUISINE_ATTRIBUTION}`);
