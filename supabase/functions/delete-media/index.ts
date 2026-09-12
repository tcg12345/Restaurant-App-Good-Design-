import { instrumentedFetch as fetch, withRequestTelemetry } from '../_shared/api-telemetry.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';
import { readJsonBody } from '../_shared/limits.ts';
import { muxApiAuth } from '../_shared/mux.ts';
import { MUX_API, muxBelongsToRow } from '../_shared/mux-ownership.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

async function provider(auth: string, path: string, method = 'GET') {
  return fetch(`${MUX_API}${path}`, { method, headers: { Authorization: auth }, signal: AbortSignal.timeout(10000) });
}
async function removeVideo(auth: string, target: { id: string; mux_asset_id?: string; mux_upload_id?: string }, owner: string, allowLegacyReel: boolean) {
  let assetId = target.mux_asset_id;
  // Resolve pending uploads before deleting the row. Otherwise an upload that
  // finishes after deletion could create an orphaned public asset.
  if (target.mux_upload_id) {
    if (!/^[A-Za-z0-9]+$/.test(target.mux_upload_id)) throw Error('Invalid upload reference');
    const path = `/uploads/${target.mux_upload_id}`;
    const response = await provider(auth, path);
    if (response.status !== 404) {
      if (!response.ok) throw Error('Could not verify upload');
      let upload = (await response.json()).data;
      if (!muxBelongsToRow(upload?.new_asset_settings?.passthrough, owner, target.id, allowLegacyReel)) throw Error('Upload ownership mismatch');
      if (upload.status === 'waiting') {
        const cancelled = await provider(auth, `${path}/cancel`, 'PUT');
        if (cancelled.ok) upload.status = 'cancelled';
        else {
          // Upload completion can race cancellation; re-read and delete the
          // completed asset, or keep the app row for a safe retry.
          const fresh = await provider(auth, path);
          if (!fresh.ok) throw Error('Could not cancel upload');
          upload = (await fresh.json()).data;
          if (!muxBelongsToRow(upload?.new_asset_settings?.passthrough, owner, target.id, allowLegacyReel) || upload.status === 'waiting') throw Error('Could not cancel upload');
        }
      }
      if (!['asset_created', 'cancelled', 'errored', 'timed_out'].includes(upload.status)) throw Error('Upload is not settled');
      if (upload.asset_id) assetId = upload.asset_id;
      if (upload.status === 'asset_created' && !assetId) throw Error('Missing completed asset');
    }
  }
  if (!assetId) return;
  if (!/^[A-Za-z0-9]+$/.test(assetId)) throw Error('Invalid asset reference');
  const path = `/assets/${assetId}`;
  const response = await provider(auth, path);
  if (response.status === 404) return;
  if (!response.ok) throw Error('Could not verify video');
  const asset = (await response.json()).data;
  if (!muxBelongsToRow(asset?.passthrough, owner, target.id, allowLegacyReel)) throw Error('Video ownership mismatch');
  const deleted = await provider(auth, path, 'DELETE');
  if (!deleted.ok && deleted.status !== 404) throw Error('Could not delete hosted video');
}

Deno.serve(withRequestTelemetry('delete-media', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  const parsed = await readJsonBody<{ kind?: string; id?: string }>(req, 4096);
  if ('response' in parsed) return parsed.response;
  const { kind, id = '' } = parsed.body;
  if (!['reel', 'post'].includes(kind ?? '') || !UUID_RE.test(id)) return json({ error: 'Invalid media reference' }, 400);
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Media service is unavailable' }, 503);
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const table = kind === 'reel' ? 'reels' : 'posts';
  const { data: row, error } = await sb.from(table).select(kind === 'reel' ? 'id,user_id,video_path,mux_asset_id,mux_upload_id' : 'id,user_id').eq('id', id).maybeSingle();
  if (error) return json({ error: 'Could not load media' }, 500);
  if (!row) return json({ deleted: true });
  if (row.user_id !== auth.userId) return json({ error: 'Not your media' }, 403);
  let targets = [row];
  if (kind === 'post') {
    const items = await sb.from('post_items').select('id,media_type,media_path,mux_asset_id,mux_upload_id').eq('post_id', id);
    if (items.error) return json({ error: 'Could not load post media' }, 500);
    targets = items.data ?? [];
  }
  const videos = targets.filter(t => t.mux_asset_id || t.mux_upload_id);
  const providerAuth = muxApiAuth();
  if (videos.length && !providerAuth) return json({ error: 'Video deletion is temporarily unavailable' }, 503);
  try {
    for (const target of videos) await removeVideo(providerAuth!, target, auth.userId, kind === 'reel');
  } catch (error) {
    console.error('[delete-media]', error instanceof Error ? error.message : 'Provider failure');
    return json({ error: 'Could not delete every video. Please retry.' }, 502);
  }
  const paths = targets.flatMap(t => {
    const path = String(t.video_path || t.media_path || '');
    if (!path.startsWith(`${auth.userId}/`) || path.includes('..')) return [];
    return kind === 'reel' || t.media_type === 'video' ? [path, `${path}.jpg`] : [path];
  });
  if (paths.length) {
    const removed = await sb.storage.from(kind === 'reel' ? 'reels-videos' : 'post-media').remove(paths);
    if (removed.error) return json({ error: 'Could not delete uploaded files. Please retry.' }, 502);
  }
  const deleted = await sb.from(table).delete().eq('id', id).eq('user_id', auth.userId);
  if (deleted.error) return json({ error: 'Could not finish deleting media. Please retry.' }, 500);
  return json({ deleted: true });
}));
