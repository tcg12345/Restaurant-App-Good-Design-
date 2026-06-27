// mux-upload-init — mint a short-lived Mux direct-upload URL.
//
// The browser calls this to get a one-time URL it can PUT the raw video to,
// so the original file goes CLIENT → MUX directly and never touches our
// server. We only make a lightweight authenticated Mux API call here (no
// transcoding). The Mux token id/secret live in Edge Function secrets and
// never reach the client bundle.
//
// Deploy:  supabase functions deploy mux-upload-init
// Secrets: supabase secrets set MUX_TOKEN_ID=... MUX_TOKEN_SECRET=...
//
// `verify_jwt = false` (see config.toml) so the CORS preflight isn't 401'd;
// we verify the caller's Supabase JWT ourselves via requireUser.

import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';

const MUX_TOKEN_ID = Deno.env.get('MUX_TOKEN_ID');
const MUX_TOKEN_SECRET = Deno.env.get('MUX_TOKEN_SECRET');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
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
  try { body = await req.json(); } catch { /* body is optional */ }
  // passthrough rides along on the Mux asset and comes back on every webhook,
  // letting us tie the asset to this exact reel row race-free.
  const passthrough = String(body.passthrough || '').slice(0, 255);
  const corsOrigin = String(body.corsOrigin || '*').slice(0, 255);

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
          passthrough,
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
