import { instrumentedFetch as fetch, withRequestTelemetry } from '../_shared/api-telemetry.ts';
// Owner-authorized privacy changes reconcile hosted media before publishing the
// database visibility change. Missing configuration and partial failures are errors.
// Older clients may omit isPublic; their already-written row remains authoritative.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';
import { readJsonBody } from '../_shared/limits.ts';
import { muxApiAuth, muxSigningConfig } from '../_shared/mux.ts';
import { getOwnedMuxAsset } from '../_shared/mux-ownership.ts';

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
  ownerId: string,
  rowId: string,
  allowLegacyReel: boolean,
  policy: 'public' | 'signed',
): Promise<{ playbackId: string; policy: 'public' | 'signed' } | null> {
  const asset = await getOwnedMuxAsset(authHeader, assetId, ownerId, rowId, allowLegacyReel);
  if (!asset) return null;
  const playbackIds = asset.playback_ids ?? [];

  // Never recreate public URLs during a visibility change. Once secured, an
  // asset stays signed even when its post becomes public; public viewers can
  // receive tokens through the same authorization endpoint. This also keeps
  // an overlapping request from restoring a URL another request just revoked.
  if (policy === 'public' && !playbackIds.some(p => p.policy === 'public')) policy = 'signed';
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
    if (policy === 'public' || p.policy === policy) continue;
    const delRes = await fetch(`${MUX_API}/assets/${assetId}/playback-ids/${p.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    });
    if (!delRes.ok && delRes.status !== 404) {
      console.error('[mux-set-visibility] playback-id delete failed', delRes.status);
      return null;
    }
  }
  return { playbackId: keep, policy };
}

Deno.serve(withRequestTelemetry('mux-set-visibility', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;

  const authHeader = muxApiAuth();
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[mux-set-visibility] missing Mux/Supabase configuration');
    return json({ error: 'Video hosting is not configured.' }, 500);
  }

  const parsed = await readJsonBody<{ kind?: string; id?: string; isPublic?: boolean }>(req, 4 * 1024);
  if ('response' in parsed) return parsed.response;
  const kind = parsed.body?.kind;
  const id = String(parsed.body?.id || '');
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

  if (parsed.body.isPublic !== undefined && typeof parsed.body.isPublic !== 'boolean') return json({ error: 'Invalid visibility.' }, 400);
  isPublic = parsed.body.isPublic ?? isPublic;
  const policy: 'public' | 'signed' = isPublic ? 'public' : 'signed';
  if (targets.length && !authHeader) return json({ error: 'Video hosting is unavailable.' }, 503);
  if (targets.length && policy === 'signed' && !muxSigningConfig()) {
    return json({ error: 'Private video playback is temporarily unavailable.', code: 'private_video_unavailable' }, 503);
  }

  const updated: Array<{ rowId: string; playbackId: string; policy: string }> = [];
  for (const t of targets) {
    const reconciled = await reconcileAsset(authHeader!, t.assetId, auth.userId, t.rowId, t.table === 'reels', policy);
    if (!reconciled) return json({ error: 'Could not secure every video. Please retry.' }, 502);
    const { playbackId, policy: actualPolicy } = reconciled;
    const { error } = await sb.from(t.table)
      .update({ mux_playback_id: playbackId, mux_playback_policy: actualPolicy })
      .eq('id', t.rowId);
    if (error) {
      console.error('[mux-set-visibility] playback metadata update failed', error.message);
      return json({ error: 'Could not save video privacy. Please retry.' }, 500);
    }
    updated.push({ rowId: t.rowId, playbackId, policy: actualPolicy });
  }

  const { data: saved, error: saveError } = await sb.from(kind === 'reel' ? 'reels' : 'posts')
    .update({ is_public: isPublic }).eq('id', id).eq('user_id', auth.userId).select('id').maybeSingle();
  if (saveError || !saved) return json({ error: 'Could not save visibility. Please retry.' }, 500);
  return json({ updated, isPublic });
}));
