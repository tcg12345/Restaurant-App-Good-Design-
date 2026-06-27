// mux-webhook — receive Mux asset lifecycle events and record playback ids.
//
// Mux calls this (server-to-server) as it ingests/transcodes an upload. We
// verify the HMAC signature, then write the asset/playback id and status back
// onto the matching reel row using the service-role key (no user session is
// involved, so this bypasses RLS by design).
//
// Correlation is by `passthrough` — we set it to the reel's own id at
// upload-init time, so every event maps straight to a row by primary key,
// race-free. mux_upload_id / mux_asset_id are kept as fallbacks.
//
// Deploy:  supabase functions deploy mux-webhook
// Secret:  supabase secrets set MUX_WEBHOOK_SECRET=...   (the signing secret
//          Mux shows when you register this function's URL as a webhook)
//
// `verify_jwt = false` (config.toml): Mux can't present a Supabase JWT.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBHOOK_SECRET = Deno.env.get('MUX_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Reject events whose signed timestamp is older than this (replay protection).
const TOLERANCE_SECONDS = 5 * 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify Mux's `Mux-Signature: t=<ts>,v1=<hex hmac>` header. */
async function verifyMuxSignature(payload: string, header: string, secret: string): Promise<boolean> {
  if (!secret || !header) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(',')) {
    const idx = piece.indexOf('=');
    if (idx > 0) parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // Drop events that are too old to be a legitimate, timely delivery.
  const ts = Number(t);
  if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, v1);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  const signature = req.headers.get('Mux-Signature') || '';
  const valid = await verifyMuxSignature(raw, signature, WEBHOOK_SECRET || '');
  if (!valid) {
    console.warn('[mux-webhook] rejected: invalid signature');
    return new Response('Invalid signature', { status: 401 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  const type = event.type;
  const data = (event.data || {}) as Record<string, unknown>;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[mux-webhook] missing SUPABASE_URL / SERVICE_ROLE_KEY');
    return new Response('Not configured', { status: 500 });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Updates target the row by passthrough (reel id) when present, else by the
  // upload/asset id we stored earlier.
  const passthrough = typeof data.passthrough === 'string' ? data.passthrough : '';

  // A Mux asset belongs to either a reel or a post video item. Both tables
  // carry the same mux_* columns, and ids/upload-ids/asset-ids are unique, so
  // we apply each update to BOTH — only the one matching row changes.
  const updateBoth = async (col: string, val: string, patch: Record<string, unknown>) => {
    if (!val) return;
    for (const table of ['reels', 'post_items']) {
      const { error } = await sb.from(table).update(patch).eq(col, val);
      if (error) console.error(`[mux-webhook] ${table} update failed`, error.message);
    }
  };

  try {
    if (type === 'video.upload.asset_created') {
      // Earliest event — ties the new asset id to the row we keyed by upload id.
      const uploadId = String(data.id || '');
      const assetId = String((data as { asset_id?: string }).asset_id || '');
      if (uploadId && assetId) await updateBoth('mux_upload_id', uploadId, { mux_asset_id: assetId });
    } else if (type === 'video.asset.ready') {
      const assetId = String(data.id || '');
      const playbackIds = (data.playback_ids as Array<{ id: string; policy: string }> | undefined) || [];
      const playbackId = (playbackIds.find((p) => p.policy === 'public') || playbackIds[0])?.id || '';
      const duration = typeof data.duration === 'number' ? data.duration : null;
      const patch: Record<string, unknown> = {
        mux_status: 'ready',
        mux_asset_id: assetId,
        mux_playback_id: playbackId,
      };
      if (duration != null) patch.duration_seconds = duration;
      // Prefer passthrough (the reel/item id) — race-free; else fall back to asset id.
      if (passthrough) await updateBoth('id', passthrough, patch);
      else await updateBoth('mux_asset_id', assetId, patch);
    } else if (type === 'video.asset.errored') {
      const assetId = String(data.id || '');
      if (passthrough) await updateBoth('id', passthrough, { mux_status: 'errored' });
      else await updateBoth('mux_asset_id', assetId, { mux_status: 'errored' });
    }
    // Other event types are acknowledged and ignored.
  } catch (err) {
    console.error('[mux-webhook] handler exception', err);
    return new Response('error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
});
