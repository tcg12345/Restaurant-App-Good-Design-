import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireUser, CORS_HEADERS } from '../_shared/auth.ts';
import { readJsonBody } from '../_shared/limits.ts';
import { generateSummary, selectSummaryPlace } from './summary.ts';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
// Bounded, short-lived worker cache. No user history is used or cached.
const cache = new Map<string, { expires: number; value: Promise<string> }>();
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  const parsed = await readJsonBody<any>(req, 2048);
  if ('response' in parsed) return parsed.response;
  const { id, place: placeId } = parsed.body?.payload || {};
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || typeof placeId !== 'string' || placeId.length > 300) return json({ error: 'Choose a restaurant in your room.' }, 400);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // Existing RPC enforces membership and room expiry before any cache/provider access.
  const { data: room, error } = await db.rpc('group_room_action', { actor: auth.userId, action: 'snapshot', payload: { id } });
  const place = error ? null : selectSummaryPlace(room, placeId);
  if (!place) return json({ error: 'This restaurant is not available in your room.' }, 403);
  const key = `${id}:${placeId}`;
  const cached = cache.get(key);
  try {
    if (cached && cached.expires > Date.now()) return json({ summary: await cached.value });
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get('Authorization')! } } });
    const quota = await caller.rpc('consume_ai_rate_limit', { p_endpoint: 'group-place-summary', p_max_per_hour: 60 });
    if (quota.error) return json({ error: 'The overview is temporarily unavailable. Try again shortly.' }, 503);
    if (quota.data !== true) return json({ error: 'You’ve reached the hourly overview limit. Please try again later.' }, 429);
    const anthropic = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropic) return json({ error: 'The AI overview is unavailable right now.' }, 503);
    // Recheck after quota I/O to coalesce simultaneous requests from room members.
    const pending = cache.get(key);
    if (pending && pending.expires > Date.now()) return json({ summary: await pending.value });
    const value = generateSummary(place, { anthropic, places: Deno.env.get('GOOGLE_PLACES_API_KEY') }).catch(e => { cache.delete(key); throw e; });
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 60 * 60_000, value });
    return json({ summary: await value });
  } catch {
    return json({ error: 'Couldn’t write the overview right now. Please try again.' }, 503);
  }
});
