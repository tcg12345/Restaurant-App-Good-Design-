// mux-set-visibility — align a Mux asset's playback policy with its row's
// is_public flag after the owner flips a reel / post between public and
// followers-only.
//
// RLS hides the DB row, but a Mux PUBLIC playback id keeps streaming to
// anyone who has (or guesses) the URL. So on every visibility flip the client
// calls this after updating is_public: we re-read the row (the DB value is
// authoritative — the client's intent is never trusted), verify the caller
// OWNS it, then reconcile the asset via the Mux API: create a playback id
// with the desired policy, delete the ones with the wrong policy, and write
// the new playback id + policy back onto the row. The playback id CHANGES in
// this process — the response carries the new one so the client can refresh.
//
// Request:  { kind: 'reel' | 'post', id: '<uuid>' }
// Response: { updated: [{ rowId, playbackId, policy }], skipped?: string }
//
// Flipping to followers-only requires the signing-key secrets (else the new
// signed asset would be unplayable for everyone); without them we leave the
// asset public and report it in `skipped`.
//
// Deploy:  supabase functions deploy mux-set-visibility
// `verify_jwt = false` (config.toml): preflight, same as the other functions.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';
import { readJsonBody } from '../_shared/limits.ts';
import { muxApiAuth, muxSigningConfig } from '../_shared/mux.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUX_API = 'https://api.mux.com/video/v1';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Swap a single asset's playback ids to `policy`. Returns the playback id
 *  that now serves the asset, or null when the Mux API said no. */
async function reconcileAsset(
  authHeader: string,
  assetId: string,
  policy: 'public' | 'signed',
): Promise<string | null> {
  const assetRes = await fetch(`${MUX_API}/assets/${assetId}`, {
    headers: { Authorization: authHeader },
  });
  if (!assetRes.ok) {
    console.error('[mux-set-visibility] asset fetch failed', assetId, assetRes.status);
    return null;
  }
  const asset = await assetRes.json();
  const playbackIds = (asset?.data?.playback_ids ?? []) as Array<{ id: string; policy: string }>;

  let keep = playbackIds.find((p) => p.policy === policy)?.id ?? null;
  if (!keep) {
    const createRes = await fetch(`${MUX_API}/assets/${assetId}/playback-ids`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy }),
    });
    if (!createRes.ok) {
      console.error('[mux-set-visibility] playback-id create failed', assetId, createRes.status);
      return null;
    }
    keep = String((await createRes.json())?.data?.id ?? '');
    if (!keep) return null;
  }

  // Only after the replacement exists do we retire the old-policy ids, so a
  // failure above never leaves the asset with no playback id at all.
  for (const p of playbackIds) {
    if (p.policy === policy) continue;
    const delRes = await fetch(`${MUX_API}/assets/${assetId}/playback-ids/${p.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    });
    if (!delRes.ok) console.error('[mux-set-visibility] playback-id delete failed', assetId, p.id, delRes.status);
  }
  return keep;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;

  const authHeader = muxApiAuth();
  if (!authHeader || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[mux-set-visibility] missing Mux/Supabase configuration');
    return json({ error: 'Video hosting is not configured.' }, 500);
  }

  const parsed = await readJsonBody<{ kind?: string; id?: string }>(req, 4 * 1024);
  if ('response' in parsed) return parsed.response;
  const kind = parsed.body.kind;
  const id = String(parsed.body.id || '');
  if ((kind !== 'reel' && kind !== 'post') || !UUID_RE.test(id)) {
    return json({ error: 'Expected { kind: "reel" | "post", id: uuid }.' }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Load the rows to reconcile — a reel is one row; a post covers every video
  // item under it. Ownership is checked against the row, never the request.
  let isPublic: boolean;
  let targets: Array<{ table: 'reels' | 'post_items'; rowId: string; assetId: string }>;
  if (kind === 'reel') {
    const { data, error } = await sb.from('reels')
      .select('user_id, is_public, mux_asset_id')
      .eq('id', id)
      .maybeSingle();
    if (error) { console.error('[mux-set-visibility] reel lookup failed', error.message); return json({ error: 'Lookup failed' }, 500); }
    if (!data) return json({ error: 'Not found.' }, 404);
    if (String(data.user_id) !== auth.userId) return json({ error: 'Not your video.' }, 403);
    isPublic = !!data.is_public;
    targets = data.mux_asset_id ? [{ table: 'reels', rowId: id, assetId: String(data.mux_asset_id) }] : [];
  } else {
    const { data: post, error: postErr } = await sb.from('posts')
      .select('user_id, is_public')
      .eq('id', id)
      .maybeSingle();
    if (postErr) { console.error('[mux-set-visibility] post lookup failed', postErr.message); return json({ error: 'Lookup failed' }, 500); }
    if (!post) return json({ error: 'Not found.' }, 404);
    if (String(post.user_id) !== auth.userId) return json({ error: 'Not your post.' }, 403);
    isPublic = !!post.is_public;
    const { data: items, error: itemsErr } = await sb.from('post_items')
      .select('id, mux_asset_id')
      .eq('post_id', id);
    if (itemsErr) { console.error('[mux-set-visibility] items lookup failed', itemsErr.message); return json({ error: 'Lookup failed' }, 500); }
    targets = ((items ?? []) as Array<{ id: string; mux_asset_id: string | null }>)
      .filter((it) => it.mux_asset_id)
      .map((it) => ({ table: 'post_items' as const, rowId: String(it.id), assetId: String(it.mux_asset_id) }));
  }

  const policy: 'public' | 'signed' = isPublic ? 'public' : 'signed';
  if (policy === 'signed' && !muxSigningConfig()) {
    console.warn('[mux-set-visibility] signing keys not set — leaving asset(s) on public playback');
    return json({ updated: [], skipped: 'signing-not-configured' });
  }

  const updated: Array<{ rowId: string; playbackId: string; policy: string }> = [];
  for (const t of targets) {
    const playbackId = await reconcileAsset(authHeader, t.assetId, policy);
    if (!playbackId) continue;
    const { error } = await sb.from(t.table)
      .update({ mux_playback_id: playbackId, mux_playback_policy: policy })
      .eq('id', t.rowId);
    if (error) {
      // Column missing (migration 048 not applied) — still record the id.
      if (error.code === 'PGRST204' && /mux_playback_policy/i.test(error.message || '')) {
        await sb.from(t.table).update({ mux_playback_id: playbackId }).eq('id', t.rowId);
      } else {
        console.error(`[mux-set-visibility] ${t.table} update failed`, error.message);
        continue;
      }
    }
    updated.push({ rowId: t.rowId, playbackId, policy });
  }

  return json({ updated });
});
