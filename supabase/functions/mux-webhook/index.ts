// mux-webhook — receive Mux asset lifecycle events and record playback ids.
//
// Mux calls this (server-to-server) as it ingests/transcodes an upload. We
// verify the HMAC signature, then write the asset/playback id and status back
// onto the matching reel row using the service-role key (no user session is
// involved, so this bypasses RLS by design).
//
// Correlation is by `passthrough` — mux-upload-init sets it to
// "<ownerUserId>:<rowId>", so every event maps straight to a row by primary
// key, race-free — and because we hold the service-role key, we verify the
// row actually belongs to that user before patching it. Without the check, a
// malicious user could mint a ticket carrying a VICTIM's reel id and have
// this webhook overwrite the victim's published video with their upload.
// mux_upload_id / mux_asset_id are kept as fallbacks; those lookups are
// ownership-safe by construction, since RLS means only a row's owner could
// have recorded the upload id on it.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse the "<ownerUserId>:<rowId>" passthrough mux-upload-init mints.
 *  Anything else (including the legacy bare row id) parses to null, which
 *  drops the event to the ownership-safe upload/asset-id fallback path. */
function parsePassthrough(raw: string): { owner: string; rowId: string } | null {
  const idx = raw.indexOf(':');
  if (idx < 0) return null;
  const owner = raw.slice(0, idx);
  const rowId = raw.slice(idx + 1);
  if (!UUID_RE.test(owner) || !UUID_RE.test(rowId)) return null;
  return { owner, rowId };
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

  // Updates target the row by passthrough ("<ownerUserId>:<rowId>") when
  // present and well-formed, else by the upload/asset id we stored earlier.
  const passthrough = parsePassthrough(typeof data.passthrough === 'string' ? data.passthrough : '');

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

  // Patch the row named by passthrough ONLY if it belongs to the user who
  // minted the upload ticket. The service-role key bypasses RLS, so this
  // check is the only thing standing between a forged/mismatched ticket and
  // someone else's published video.
  const updateOwnedRow = async (owner: string, rowId: string, patch: Record<string, unknown>) => {
    // Reels carry their owner directly — enforce it in the WHERE clause.
    const reel = await sb.from('reels').update(patch).eq('id', rowId).eq('user_id', owner).select('id');
    if (reel.error) console.error('[mux-webhook] reels update failed', reel.error.message);
    else if ((reel.data?.length ?? 0) > 0) return;

    // A post video item's owner lives on the parent post — resolve it first.
    const item = await sb.from('post_items').select('post_id').eq('id', rowId).maybeSingle();
    if (item.error) { console.error('[mux-webhook] post_items lookup failed', item.error.message); return; }
    if (!item.data) { console.warn(`[mux-webhook] no owned row ${rowId} for user ${owner} — ignoring`); return; }
    const post = await sb.from('posts').select('user_id').eq('id', item.data.post_id).maybeSingle();
    if (post.error) { console.error('[mux-webhook] posts lookup failed', post.error.message); return; }
    if (!post.data || post.data.user_id !== owner) {
      console.warn(`[mux-webhook] passthrough owner mismatch on post_item ${rowId} — ignoring`);
      return;
    }
    const upd = await sb.from('post_items').update(patch).eq('id', rowId);
    if (upd.error) console.error('[mux-webhook] post_items update failed', upd.error.message);
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
      // Prefer passthrough (owner-verified, race-free); else fall back to the
      // asset id (covers legacy tickets minted before passthrough carried the
      // owner — safe because only the row's owner could have recorded it).
      if (passthrough) await updateOwnedRow(passthrough.owner, passthrough.rowId, patch);
      else await updateBoth('mux_asset_id', assetId, patch);
    } else if (type === 'video.asset.errored') {
      const assetId = String(data.id || '');
      if (passthrough) await updateOwnedRow(passthrough.owner, passthrough.rowId, { mux_status: 'errored' });
      else await updateBoth('mux_asset_id', assetId, { mux_status: 'errored' });
    } else if (type === 'video.upload.cancelled' || type === 'video.upload.errored') {
      // Upload-level failures: the asset never materializes, so
      // video.asset.errored will never fire for these rows — without this
      // branch an interrupted upload (app killed mid-PUT, Mux timing the
      // upload out) leaves mux_status='processing' forever. Here data.id
      // is the UPLOAD id.
      const uploadId = String(data.id || '');
      if (passthrough) await updateOwnedRow(passthrough.owner, passthrough.rowId, { mux_status: 'errored' });
      else if (uploadId) await updateBoth('mux_upload_id', uploadId, { mux_status: 'errored' });
    }
    // Other event types are acknowledged and ignored.
  } catch (err) {
    console.error('[mux-webhook] handler exception', err);
    return new Response('error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
});
