// cuisine-lookup — ask OpenStreetMap what a restaurant actually serves.
//
// Google describes rural restaurants badly. Measured on this app's own
// ratings, every place left with no usable cuisine was outside a metro
// area, and Google returned nothing better than "Restaurant" for it. OSM
// is strongest in exactly that gap: `cuisine=*` is entered by a person who
// went there, and rural coverage is the part volunteers care most about.
//
// Why this runs on a server rather than in the app:
//
//   • Overpass is volunteer-funded and asks callers not to hammer it. One
//     query per batch, a negative cache so a miss is paid for once, and a
//     claim written before the query so a hundred people opening the same
//     list produce one request, not a hundred.
//   • An `osm` cuisine is written at a tier no browser may send (migration
//     070). If the app could produce one, anyone could POST one.
//
// Request:  { places: [{ restaurantId, name, lat?, lng? }] }   ≤ 25
// Response: { cuisines: { [restaurantId]: { cuisine, source } },
//             attribution: string }
//
// `cuisines` carries every id we can answer — from the cache as well as
// from this lookup — so the caller merges one object and is done.
//
// Cuisine data © OpenStreetMap contributors, ODbL.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';
import { enforceRateLimit, readJsonBody } from '../_shared/limits.ts';
import {
  CUISINE_ATTRIBUTION, SEARCH_RADIUS_M,
  buildOverpassQuery, matchPlace,
  type OsmElement, type OsmPlace,
} from '../_shared/osm-cuisine.ts';

/** Overpass mirrors, tried in order. All speak the same API; the first
 *  that answers wins. OVERPASS_URL overrides the list entirely, for anyone
 *  running their own instance. */
const OVERPASS_ENDPOINTS = (Deno.env.get('OVERPASS_URL') || [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
].join(',')).split(',').map((u) => u.trim()).filter(Boolean);

/** Matches migration 070's ranking. A place already at this tier or above
 *  has nothing to gain from a lookup, so it never becomes one. */
const OSM_CONFIDENCE = 55;

/** One Overpass query's worth. Twenty-five 120m circles is a small query;
 *  a list screen asks for its whole viewport in one or two of these. */
const MAX_PLACES = 25;

/** How long a miss stands before we ask again. Mirrors
 *  cuisine_lookup_ttl_days() in 070. */
const MISS_TTL_DAYS = 45;

const PROVIDER = 'osm';
const MAX_BODY_BYTES = 16 * 1024;
/** Generous per user: a browse session legitimately fires several of these,
 *  and each one is capped at 25 places and deduplicated against the cache. */
const MAX_PER_HOUR = 120;

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

interface RequestPlace {
  restaurantId?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Post the query to each mirror in turn. Returns the elements, or null if
 *  every mirror failed — which is a "we didn't ask", not a "we found
 *  nothing", and the caller unwinds its claims accordingly. */
async function queryOverpass(query: string): Promise<OsmElement[] | null> {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass asks for a contactable identifier so it can reach an
          // operator rather than silently blocking them.
          'User-Agent': 'GoodEats/1.0 (restaurant cuisine lookup; +https://github.com/tcg12345/Restaurant-App-Good-Design-)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        console.warn(`[cuisine-lookup] ${url} → ${res.status}`);
        continue;
      }
      const body = await res.json();
      if (Array.isArray(body?.elements)) return body.elements as OsmElement[];
      console.warn(`[cuisine-lookup] ${url} returned no elements array`);
    } catch (err) {
      console.warn(`[cuisine-lookup] ${url} failed:`, err instanceof Error ? err.message : String(err));
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;

  const limited = await enforceRateLimit(
    req, 'cuisine-lookup', MAX_PER_HOUR,
    'Too many cuisine lookups for now — try again shortly.',
  );
  if (limited) return limited;

  const parsed = await readJsonBody<{ places?: RequestPlace[] }>(req, MAX_BODY_BYTES);
  if ('response' in parsed) return parsed.response;

  // ── Normalize the request ──────────────────────────────────────────
  const seen = new Set<string>();
  const requested: Array<{ restaurantId: string; name: string; lat: number | null; lng: number | null }> = [];
  for (const p of parsed.body.places || []) {
    const restaurantId = String(p?.restaurantId || '').trim();
    const name = String(p?.name || '').trim().slice(0, 120);
    if (!restaurantId || !name || seen.has(restaurantId)) continue;
    seen.add(restaurantId);
    requested.push({ restaurantId, name, lat: num(p?.lat), lng: num(p?.lng) });
    if (requested.length >= MAX_PLACES) break;
  }
  if (requested.length === 0) {
    return json(200, { cuisines: {}, attribution: CUISINE_ATTRIBUTION });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[cuisine-lookup] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return json(500, { error: 'Lookup is not configured.' });
  }
  // Service role: `osm` is a server-only tier (070), and the lookup
  // bookkeeping table has RLS on with no policies at all.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ids = requested.map((p) => p.restaurantId);
  const cuisines: Record<string, { cuisine: string; source: string }> = {};

  // ── What we already know ───────────────────────────────────────────
  const { data: cached, error: cacheErr } = await db
    .from('restaurant_cuisine')
    .select('restaurant_id, cuisine, source, confidence')
    .in('restaurant_id', ids);
  if (cacheErr) {
    console.error('[cuisine-lookup] cache read failed:', cacheErr.message);
    return json(500, { error: 'Lookup is unavailable right now.' });
  }
  const settled = new Set<string>();
  for (const row of cached || []) {
    if (row.cuisine) cuisines[row.restaurant_id] = { cuisine: row.cuisine, source: row.source };
    // Only a weaker answer than OSM's leaves anything to gain.
    if ((row.confidence ?? 0) >= OSM_CONFIDENCE) settled.add(row.restaurant_id);
  }

  // ── What we already asked about ────────────────────────────────────
  const cutoff = new Date(Date.now() - MISS_TTL_DAYS * 86_400_000).toISOString();
  const { data: lookups } = await db
    .from('restaurant_cuisine_lookups')
    .select('restaurant_id, checked_at')
    .eq('provider', PROVIDER)
    .in('restaurant_id', ids)
    .gte('checked_at', cutoff);
  const recentlyAsked = new Set((lookups || []).map((r) => r.restaurant_id));

  // ── Coordinates ────────────────────────────────────────────────────
  // The shared geocode cache is preferred over whatever the caller sent:
  // it is the app's own answer for this place id, so a request cannot
  // steer the search somewhere convenient by lying about where a
  // restaurant is.
  const candidates = requested.filter((p) => !settled.has(p.restaurantId) && !recentlyAsked.has(p.restaurantId));
  const geo: Record<string, { lat: number; lng: number }> = {};
  if (candidates.length > 0) {
    const { data: geoRows } = await db
      .from('restaurant_geo')
      .select('restaurant_id, lat, lng')
      .in('restaurant_id', candidates.map((p) => p.restaurantId));
    for (const g of geoRows || []) geo[g.restaurant_id] = { lat: g.lat, lng: g.lng };
  }

  const toLookUp: OsmPlace[] = [];
  for (const p of candidates) {
    const at = geo[p.restaurantId] ?? (p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null);
    if (!at) continue;
    if (Math.abs(at.lat) > 90 || Math.abs(at.lng) > 180) continue;
    toLookUp.push({ restaurantId: p.restaurantId, name: p.name, lat: at.lat, lng: at.lng });
  }

  if (toLookUp.length === 0) {
    return json(200, { cuisines, attribution: CUISINE_ATTRIBUTION, lookedUp: 0 });
  }

  // ── Claim, then ask ────────────────────────────────────────────────
  // Writing the miss BEFORE the query is what collapses a crowd into one
  // request: everyone else arriving in the next few seconds sees these
  // ids as recently asked and skips them. If the query then fails, the
  // claims are withdrawn below so the next attempt retries.
  const claimedAt = new Date().toISOString();
  const { error: claimErr } = await db.from('restaurant_cuisine_lookups').upsert(
    toLookUp.map((p) => ({
      restaurant_id: p.restaurantId, provider: PROVIDER,
      found: false, lat: p.lat, lng: p.lng, checked_at: claimedAt,
    })),
    { onConflict: 'restaurant_id,provider' },
  );
  if (claimErr) console.warn('[cuisine-lookup] could not record claims:', claimErr.message);

  const elements = await queryOverpass(buildOverpassQuery(toLookUp, SEARCH_RADIUS_M));

  if (elements === null) {
    // Nobody answered. A miss we never actually looked for must not stand
    // for 45 days, so withdraw the claims and report what the cache knew.
    await db.from('restaurant_cuisine_lookups')
      .delete()
      .eq('provider', PROVIDER)
      .eq('found', false)
      .in('restaurant_id', toLookUp.map((p) => p.restaurantId));
    return json(503, { error: 'Cuisine lookup is unavailable right now.', cuisines, attribution: CUISINE_ATTRIBUTION });
  }

  // ── Match and publish ──────────────────────────────────────────────
  const found: Array<{ place: OsmPlace; cuisine: string }> = [];
  for (const place of toLookUp) {
    const match = matchPlace(place, elements);
    if (!match) continue;
    found.push({ place, cuisine: match.label });
    cuisines[place.restaurantId] = { cuisine: match.label, source: PROVIDER };
  }

  if (found.length > 0) {
    const { error: writeErr } = await db.from('restaurant_cuisine').upsert(
      found.map((f) => ({ restaurant_id: f.place.restaurantId, cuisine: f.cuisine, source: PROVIDER })),
      { onConflict: 'restaurant_id' },
    );
    if (writeErr) console.warn('[cuisine-lookup] cuisine write failed:', writeErr.message);

    const { error: markErr } = await db.from('restaurant_cuisine_lookups').upsert(
      found.map((f) => ({
        restaurant_id: f.place.restaurantId, provider: PROVIDER,
        found: true, lat: f.place.lat, lng: f.place.lng, checked_at: claimedAt,
      })),
      { onConflict: 'restaurant_id,provider' },
    );
    if (markErr) console.warn('[cuisine-lookup] could not mark hits:', markErr.message);
  }

  console.log(`[cuisine-lookup] asked ${toLookUp.length}, matched ${found.length}, ${elements.length} elements`);
  return json(200, {
    cuisines,
    attribution: CUISINE_ATTRIBUTION,
    lookedUp: toLookUp.length,
    matched: found.length,
  });
});
