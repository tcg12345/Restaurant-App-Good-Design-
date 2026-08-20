#!/usr/bin/env node
/**
 * Phase 0 — measure the cuisine gap before spending anything on fixing it.
 *
 * Two questions, answered with real data rather than a guess:
 *
 *   1. How many rated restaurants have no usable cuisine today?
 *      Counted from community_ratings, split by whether the address looks
 *      rural or metro — the whole premise is that rural places are worse,
 *      and that's worth confirming.
 *
 *   2. How many of those would the Phase 1 field-mask change alone fix?
 *      Re-fetches a sample from Google Places with primaryType,
 *      primaryTypeDisplayName and editorialSummary added to the mask, and
 *      reports how many resolve to a real cuisine with the new fields that
 *      did not with `types` alone.
 *
 * Usage:
 *   node scripts/measure-cuisine-gap.mjs            # both steps
 *   node scripts/measure-cuisine-gap.mjs --db-only  # skip the paid calls
 *   node scripts/measure-cuisine-gap.mjs --sample 40
 *
 * Env (reads .env.local / .env if present, else the process env):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   — step 1
 *   VITE_GOOGLE_PLACES_KEY                      — step 2
 *
 * Step 2 costs one Place Details call per sampled place. The default
 * sample of 25 is deliberately small: it is a ratio estimate, not a
 * backfill.
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
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

const args = process.argv.slice(2);
const dbOnly = args.includes('--db-only');
const sampleSize = Number(args[args.indexOf('--sample') + 1]) || 25;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const GOOGLE_KEY = process.env.VITE_GOOGLE_PLACES_KEY;

/* ── the cuisine taxonomy, mirrored from src/lib/places.ts ───────────── */
// Kept as a literal rather than imported: this script runs under plain
// node with no bundler, and the TS module pulls in the whole app graph.
const KNOWN_TYPES = new Set([
  'afghani_restaurant', 'african_restaurant', 'american_restaurant', 'asian_restaurant',
  'asian_fusion_restaurant', 'barbecue_restaurant', 'bagel_shop', 'bakery', 'bar',
  'bar_and_grill', 'brazilian_restaurant', 'breakfast_restaurant', 'brunch_restaurant',
  'buffet_restaurant', 'hamburger_restaurant', 'cafe', 'cafeteria', 'cajun_restaurant',
  'caribbean_restaurant', 'chinese_restaurant', 'coffee_shop', 'cuban_restaurant', 'deli',
  'dessert_restaurant', 'dim_sum_restaurant', 'diner', 'donut_shop', 'ethiopian_restaurant',
  'fast_food_restaurant', 'filipino_restaurant', 'fine_dining_restaurant', 'food_court',
  'french_restaurant', 'fried_chicken_restaurant', 'german_restaurant', 'greek_restaurant',
  'halal_restaurant', 'hawaiian_restaurant', 'hot_pot_restaurant', 'ice_cream_shop',
  'indian_restaurant', 'indonesian_restaurant', 'irish_restaurant', 'italian_restaurant',
  'japanese_restaurant', 'juice_shop', 'kebab_restaurant', 'korean_restaurant',
  'kosher_restaurant', 'latin_american_restaurant', 'lebanese_restaurant',
  'malaysian_restaurant', 'mediterranean_restaurant', 'mexican_restaurant',
  'middle_eastern_restaurant', 'mongolian_restaurant', 'moroccan_restaurant',
  'noodle_restaurant', 'peruvian_restaurant', 'pizza_restaurant', 'polish_restaurant',
  'portuguese_restaurant', 'pub', 'ramen_restaurant', 'russian_restaurant',
  'salad_restaurant', 'sandwich_shop', 'seafood_restaurant', 'soul_food_restaurant',
  'soup_restaurant', 'southern_restaurant', 'spanish_restaurant', 'steak_house',
  'sushi_restaurant', 'taco_restaurant', 'tapas_restaurant', 'tea_house',
  'tex_mex_restaurant', 'thai_restaurant', 'turkish_restaurant', 'vegan_restaurant',
  'vegetarian_restaurant', 'vietnamese_restaurant', 'wine_bar',
]);

/** What the app resolves TODAY: first known entry in `types`, else nothing. */
const todaysAnswer = (types = []) => types.find((t) => KNOWN_TYPES.has(t)) ?? null;

const UNKNOWN = new Set(['', 'restaurant', 'Restaurant', 'point_of_interest', 'establishment', 'food']);

/* ── step 1: the baseline, from our own ratings ──────────────────────── */
// A US address ending in a big-metro city is "metro"; everything else is
// treated as non-metro. Crude, but it only has to separate two buckets
// well enough to see whether the rural premise holds.
const METRO = /(new york|brooklyn|queens|manhattan|los angeles|san francisco|chicago|boston|seattle|miami|washington|philadelphia|austin|london|paris|tokyo|hong kong)/i;

async function baseline() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('! Skipping step 1 — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY\n');
    return [];
  }
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/community_ratings?select=restaurant_id,restaurant_name,cuisine,address&limit=${PAGE}&offset=${from}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) {
      console.log(`! community_ratings read failed (${res.status}) — is the anon key allowed to read it?\n`);
      return [];
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const seen = new Map();
  for (const r of rows) if (r.restaurant_id && !seen.has(r.restaurant_id)) seen.set(r.restaurant_id, r);
  const places = [...seen.values()];

  const bucket = (r) => (METRO.test(r.address || '') ? 'metro' : 'non-metro');
  const stats = { metro: { total: 0, unknown: 0 }, 'non-metro': { total: 0, unknown: 0 } };
  const unknowns = [];
  for (const r of places) {
    const b = bucket(r);
    stats[b].total++;
    if (UNKNOWN.has((r.cuisine || '').trim())) {
      stats[b].unknown++;
      unknowns.push(r);
    }
  }

  const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
  const total = places.length;
  const unknownTotal = unknowns.length;

  console.log('── Step 1 · baseline from your own ratings ──────────────────');
  console.log(`  ${rows.length} ratings over ${total} distinct restaurants`);
  console.log(`  no usable cuisine: ${unknownTotal} (${pct(unknownTotal, total)})`);
  for (const b of ['metro', 'non-metro']) {
    console.log(`    ${b.padEnd(9)} ${String(stats[b].unknown).padStart(4)} / ${String(stats[b].total).padEnd(4)}  ${pct(stats[b].unknown, stats[b].total)}`);
  }
  console.log('');
  return unknowns;
}

/* ── step 2: what Phase 1 would recover, from Google ─────────────────── */
const FIELDS = 'id,displayName,types,primaryType,primaryTypeDisplayName,editorialSummary';

async function probe(unknowns) {
  if (dbOnly) return;
  if (!GOOGLE_KEY) {
    console.log('! Skipping step 2 — set VITE_GOOGLE_PLACES_KEY\n');
    return;
  }
  const sample = unknowns.filter((r) => /^ChI/.test(r.restaurant_id)).slice(0, sampleSize);
  if (sample.length === 0) {
    console.log('! Skipping step 2 — no Google place ids among the unknowns\n');
    return;
  }

  console.log(`── Step 2 · re-fetching ${sample.length} of them with the wider field mask ──`);
  const gained = { primaryType: 0, displayName: 0, editorial: 0 };
  let recovered = 0;
  let failed = 0;

  for (const r of sample) {
    let p;
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${r.restaurant_id}`, {
        headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELDS },
      });
      if (!res.ok) { failed++; continue; }
      p = await res.json();
    } catch { failed++; continue; }

    const before = todaysAnswer(p.types);
    if (before) continue; // already resolvable — not part of the gap

    const viaPrimary = p.primaryType && KNOWN_TYPES.has(p.primaryType) ? p.primaryType : null;
    const viaDisplay = p.primaryTypeDisplayName?.text || null;
    const viaEditorial = p.editorialSummary?.text || null;

    if (viaPrimary) gained.primaryType++;
    else if (viaDisplay && !UNKNOWN.has(viaDisplay)) gained.displayName++;
    else if (viaEditorial) gained.editorial++;

    if (viaPrimary || (viaDisplay && !UNKNOWN.has(viaDisplay))) {
      recovered++;
      console.log(`  ✓ ${(p.displayName?.text || r.restaurant_name || '').slice(0, 34).padEnd(34)} → ${viaPrimary || viaDisplay}`);
    } else {
      console.log(`  · ${(p.displayName?.text || r.restaurant_name || '').slice(0, 34).padEnd(34)} → still unknown${viaEditorial ? ' (has editorial summary)' : ''}`);
    }
  }

  const checked = sample.length - failed;
  const pct = checked === 0 ? '—' : `${((recovered / checked) * 100).toFixed(0)}%`;
  console.log('');
  console.log(`  recovered by the wider mask: ${recovered} / ${checked}  (${pct})`);
  console.log(`    via primaryType            ${gained.primaryType}`);
  console.log(`    via primaryTypeDisplayName ${gained.displayName}`);
  console.log(`    editorial summary only     ${gained.editorial}  ← reachable in Phase 6, not Phase 1`);
  if (failed) console.log(`  ${failed} lookups failed (stale place ids or quota)`);
  console.log('');
}

const unknowns = await baseline();
if (unknowns.length > 0) await probe(unknowns);
