// mux-upload-init — mint a short-lived Mux direct-upload URL.
//
// The browser calls this to get a one-time URL it can PUT the raw video to,
// so the original file goes CLIENT → MUX directly and never touches our
// server. We only make a lightweight authenticated Mux API call here (no
// transcoding). The Mux token id/secret live in Edge Function secrets and
// never reach the client bundle.
//
// The client sends `passthrough` = the reel / post-item row id (a UUID it
// mints up-front; the row is inserted right after this call). We bind the
// caller's identity into the value actually sent to Mux —
// "<callerUserId>:<rowId>" — and mux-webhook verifies that the row it is
// about to patch belongs to that user. Without the binding, any signed-in
// user could pass someone ELSE's reel id here and have the webhook overwrite
// the victim's video with their own upload.
//
// Deploy:  supabase functions deploy mux-upload-init   (together with
//          mux-webhook — the passthrough format is shared between them)
// Secrets: supabase secrets set MUX_TOKEN_ID=... MUX_TOKEN_SECRET=...
//
// `verify_jwt = false` (see config.toml) so the CORS preflight isn't 401'd;
// we verify the caller's Supabase JWT ourselves via requireUser.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';

const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID');
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/**
 * If a row with this id ALREADY exists (a re-upload), it must belong to the
 * caller. Normally the row doesn't exist yet — the client inserts it right
 * after this call — and that's fine: the webhook re-verifies ownership at
 * write time, so a ticket minted against a not-yet-used id can never patch
 * somebody else's row. Returns an error Response to send, or null to proceed.
 */
async function rejectForeignRow(rowId: string, callerId: string): Promise<Response | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[mux-upload-init] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return json({ error: 'Video uploads are not configured yet.' }, 500);
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const reel = await sb.from('reels').select('user_id').eq('id', rowId).maybeSingle();
  if (reel.error) {
    console.error('[mux-upload-init] reels ownership lookup failed', reel.error.message);
    return json({ error: 'Could not start the upload. Please try again.' }, 500);
  }
  if (reel.data && reel.data.user_id !== callerId) return json({ error: 'Not your video.' }, 403);

  const item = await sb.from('post_items').select('post_id').eq('id', rowId).maybeSingle();
  if (item.error) {
    console.error('[mux-upload-init] post_items ownership lookup failed', item.error.message);
    return json({ error: 'Could not start the upload. Please try again.' }, 500);
  }
  if (item.data) {
    const post = await sb.from('posts').select('user_id').eq('id', item.data.post_id).maybeSingle();
    if (post.error) {
      console.error('[mux-upload-init] posts ownership lookup failed', post.error.message);
      return json({ error: 'Could not start the upload. Please try again.' }, 500);
    }
    if (!post.data || post.data.user_id !== callerId) return json({ error: 'Not your video.' }, 403);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Require a signed-in user — only members upload reels.
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;

  if (!MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
    console.error('[mux-upload-init] missing MUX_TOKEN_ID / MUX_TOKEN_SECRET');
    return json({ error: 'Video uploads are not configured yet.' }, 500);
  }

  let body: { passthrough?: string; corsOrigin?: string } = {};
  try { body = await req.json(); } catch { /* handled by validation below */ }
  // passthrough rides along on the Mux asset and comes back on every webhook,
  // letting us tie the asset to this exact reel row race-free.
  const rowId = String(body.passthrough || '').trim();
  const corsOrigin = String(body.corsOrigin || '*').slice(0, 255);
  if (!UUID_RE.test(rowId)) {
    return json({ error: 'passthrough must be the video row id (a UUID).' }, 400);
  }

  const rejected = await rejectForeignRow(rowId, auth.userId);
  if (rejected) return rejected;

  try {
    const basic = btoa(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`);
    const muxRes = await fetch('https://api.mux.com/video/v1/uploads', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cors_origin: corsOrigin,
        new_asset_settings: {
          playback_policy: ['public'], // public ids to start; signed is a future option
          video_quality: 'basic',      // cheapest tier — fine for short vertical reels
          // Owner-bound: the webhook only patches the row if it belongs to
          // this user, so a ticket can never overwrite someone else's video.
          passthrough: `${auth.userId}:${rowId}`,
        },
      }),
    });

    if (!muxRes.ok) {
      const text = await muxRes.text();
      console.error('[mux-upload-init] Mux API error', muxRes.status, text);
      return json({ error: 'Could not start the upload. Please try again.' }, 502);
    }

    const payload = await muxRes.json();
    const uploadUrl = payload?.data?.url;
    const uploadId = payload?.data?.id;
    if (!uploadUrl || !uploadId) {
      console.error('[mux-upload-init] unexpected Mux response', JSON.stringify(payload));
      return json({ error: 'Upload service returned an unexpected response.' }, 502);
    }
    return json({ uploadUrl, uploadId });
  } catch (err) {
    console.error('[mux-upload-init] exception', err);
    return json({ error: 'Could not start the upload. Please try again.' }, 500);
  }
});
