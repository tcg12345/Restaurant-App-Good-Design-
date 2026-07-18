// mux-playback-token — mint short-lived Mux signed-playback tokens.
//
// Followers-only reels / post videos use Mux's SIGNED playback policy, so
// their stream.mux.com / image.mux.com URLs only work with a JWT minted from
// our signing key. The client batches the ids it is about to render here; we
// verify the caller may actually view each one — the owner, anything public,
// or an accepted follower of the author (the same scope as the tables' RLS
// SELECT policies) — and return per-id video/thumbnail/storyboard tokens.
// Unauthorized or unknown ids are silently omitted from the response.
//
// Request:  { items: [{ kind: 'reel' | 'post_item', id: '<uuid>' }, ...] }
// Response: { tokens: { [id]: { playback, thumbnail, storyboard, expiresAt } } }
//
// Deploy:  supabase functions deploy mux-playback-token
// Secrets: supabase secrets set MUX_SIGNING_KEY_ID=... MUX_SIGNING_PRIVATE_KEY=...
//          (see _shared/mux.ts for how to create the signing key)
//
// `verify_jwt = false` (config.toml) so the CORS preflight gets through; we
// verify the caller's Supabase JWT ourselves via requireUser.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';
import { readJsonBody } from '../_shared/limits.ts';
import { muxSigningConfig, signPlaybackToken } from '../_shared/mux.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const MAX_ITEMS = 60;          // a feed page worth of videos, with headroom
const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_TTL_SECONDS = 4 * 60 * 60; // client refreshes from its cache well before this

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

interface TokenItem { kind: 'reel' | 'post_item'; id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  const viewerId = auth.userId;

  const cfg = muxSigningConfig();
  if (!cfg) {
    // Signed playback isn't provisioned, so no signed assets exist to token.
    console.warn('[mux-playback-token] MUX_SIGNING_KEY_ID / MUX_SIGNING_PRIVATE_KEY not set');
    return json({ tokens: {} });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[mux-playback-token] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Not configured' }, 500);
  }

  const parsed = await readJsonBody<{ items?: TokenItem[] }>(req, MAX_BODY_BYTES);
  if ('response' in parsed) return parsed.response;
  const rawItems = Array.isArray(parsed.body.items) ? parsed.body.items : [];
  const items = rawItems
    .filter((it): it is TokenItem =>
      !!it && (it.kind === 'reel' || it.kind === 'post_item') && UUID_RE.test(String(it.id || '')))
    .slice(0, MAX_ITEMS);
  if (items.length === 0) return json({ tokens: {} });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Resolve each id to { playbackId, authorId, isPublic }.
  const reelIds = items.filter((it) => it.kind === 'reel').map((it) => it.id);
  const itemIds = items.filter((it) => it.kind === 'post_item').map((it) => it.id);
  const rows = new Map<string, { playbackId: string; authorId: string; isPublic: boolean }>();

  type ReelRow = { id: string; user_id: string; is_public: boolean; mux_playback_id: string | null };
  type ItemRow = { id: string; post_id: string; mux_playback_id: string | null };
  type PostRow = { id: string; user_id: string; is_public: boolean };

  if (reelIds.length) {
    const { data, error } = await sb.from('reels')
      .select('id, user_id, is_public, mux_playback_id')
      .in('id', reelIds);
    if (error) { console.error('[mux-playback-token] reels lookup failed', error.message); return json({ error: 'Lookup failed' }, 500); }
    for (const r of (data ?? []) as ReelRow[]) {
      if (r.mux_playback_id) {
        rows.set(String(r.id), { playbackId: String(r.mux_playback_id), authorId: String(r.user_id), isPublic: !!r.is_public });
      }
    }
  }
  if (itemIds.length) {
    const { data, error } = await sb.from('post_items')
      .select('id, post_id, mux_playback_id')
      .in('id', itemIds);
    if (error) { console.error('[mux-playback-token] post_items lookup failed', error.message); return json({ error: 'Lookup failed' }, 500); }
    const withPlayback = ((data ?? []) as ItemRow[]).filter((r) => r.mux_playback_id);
    const postIds = [...new Set(withPlayback.map((r) => String(r.post_id)))];
    if (postIds.length) {
      const { data: posts, error: postsErr } = await sb.from('posts')
        .select('id, user_id, is_public')
        .in('id', postIds);
      if (postsErr) { console.error('[mux-playback-token] posts lookup failed', postsErr.message); return json({ error: 'Lookup failed' }, 500); }
      const postById = new Map(((posts ?? []) as PostRow[]).map((p) => [String(p.id), p]));
      for (const r of withPlayback) {
        const post = postById.get(String(r.post_id));
        if (post) {
          rows.set(String(r.id), { playbackId: String(r.mux_playback_id), authorId: String(post.user_id), isPublic: !!post.is_public });
        }
      }
    }
  }

  // Which authors' followers-only content may this viewer see? Same predicate
  // as the RLS policies: user_friends(user_id = viewer, friend_id = author,
  // status = 'accepted').
  const privateAuthors = [...new Set(
    [...rows.values()].filter((r) => !r.isPublic && r.authorId !== viewerId).map((r) => r.authorId),
  )];
  const followedAuthors = new Set<string>();
  if (privateAuthors.length) {
    const { data, error } = await sb.from('user_friends')
      .select('friend_id')
      .eq('user_id', viewerId)
      .eq('status', 'accepted')
      .in('friend_id', privateAuthors);
    if (error) { console.error('[mux-playback-token] follower lookup failed', error.message); return json({ error: 'Lookup failed' }, 500); }
    for (const f of data ?? []) followedAuthors.add(String(f.friend_id));
  }

  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const tokens: Record<string, { playback: string; thumbnail: string; storyboard: string; expiresAt: number }> = {};
  for (const [id, row] of rows) {
    const allowed = row.isPublic || row.authorId === viewerId || followedAuthors.has(row.authorId);
    if (!allowed) continue;
    const [playback, thumbnail, storyboard] = await Promise.all([
      signPlaybackToken(cfg, row.playbackId, 'v', expiresAt),
      // Image query params must ride as claims on a signed URL; 1080 matches
      // the width the client's muxPosterUrl always requested.
      signPlaybackToken(cfg, row.playbackId, 't', expiresAt, { width: 1080 }),
      signPlaybackToken(cfg, row.playbackId, 's', expiresAt),
    ]);
    tokens[id] = { playback, thumbnail, storyboard, expiresAt };
  }

  return json({ tokens });
});
