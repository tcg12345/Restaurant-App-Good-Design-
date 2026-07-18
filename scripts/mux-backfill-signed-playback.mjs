#!/usr/bin/env node
// One-time backfill: convert existing FOLLOWERS-ONLY reels / post videos from
// Mux public playback to SIGNED playback.
//
// Assets uploaded before signed playback shipped all carry public playback
// ids, so a followers-only reel's stream.mux.com / image.mux.com URLs work
// for anyone who has them. For every followers-only row with a Mux asset this
// script: creates a signed playback id on the asset (if missing), deletes the
// public ones, and updates the row's mux_playback_id + mux_playback_policy.
//
// Prerequisites: migration 048 applied, and a Mux signing key provisioned
// (MUX_SIGNING_KEY_ID / MUX_SIGNING_PRIVATE_KEY set as Supabase secrets) so
// the app can actually mint tokens for the converted assets — run this AFTER
// deploying the updated functions, or followers will see broken videos.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   MUX_TOKEN_ID=... MUX_TOKEN_SECRET=... \
//   node scripts/mux-backfill-signed-playback.mjs           # dry run (default)
//   node scripts/mux-backfill-signed-playback.mjs --apply   # actually convert

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID || '';
const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET || '';
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !SERVICE_KEY || !MUX_TOKEN_ID || !MUX_TOKEN_SECRET) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MUX_TOKEN_ID, MUX_TOKEN_SECRET.');
  process.exit(1);
}

const dbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};
const muxAuth = `Basic ${Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString('base64')}`;

async function db(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...dbHeaders, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status} on ${pathAndQuery}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function mux(path, init = {}) {
  const res = await fetch(`https://api.mux.com/video/v1${path}`, {
    ...init,
    headers: { Authorization: muxAuth, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Mux ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

/** Ensure the asset serves ONLY a signed playback id; return that id. */
async function convertAsset(assetId) {
  const asset = await mux(`/assets/${assetId}`);
  const playbackIds = asset?.data?.playback_ids ?? [];
  let signedId = playbackIds.find((p) => p.policy === 'signed')?.id ?? null;
  if (!signedId) {
    const created = await mux(`/assets/${assetId}/playback-ids`, {
      method: 'POST',
      body: JSON.stringify({ policy: 'signed' }),
    });
    signedId = created?.data?.id;
    if (!signedId) throw new Error(`no signed playback id created for asset ${assetId}`);
  }
  // Delete the rest only once the signed replacement exists.
  for (const p of playbackIds) {
    if (p.policy !== 'signed') await mux(`/assets/${assetId}/playback-ids/${p.id}`, { method: 'DELETE' });
  }
  return signedId;
}

async function processRows(label, table, rows) {
  console.log(`\n${label}: ${rows.length} followers-only row(s) still on public playback`);
  let converted = 0;
  for (const row of rows) {
    if (!APPLY) {
      console.log(`  [dry-run] would convert ${table}/${row.id} (asset ${row.mux_asset_id})`);
      continue;
    }
    try {
      const signedId = await convertAsset(row.mux_asset_id);
      await db(`${table}?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ mux_playback_id: signedId, mux_playback_policy: 'signed' }),
      });
      converted += 1;
      console.log(`  converted ${table}/${row.id} → playback ${signedId}`);
    } catch (err) {
      console.error(`  FAILED ${table}/${row.id}:`, err.message);
    }
  }
  if (APPLY) console.log(`${label}: ${converted}/${rows.length} converted`);
}

const reels = await db(
  'reels?select=id,mux_asset_id&is_public=eq.false&mux_asset_id=not.is.null&mux_playback_policy=neq.signed',
);
await processRows('Reels', 'reels', reels);

const items = await db(
  'post_items?select=id,mux_asset_id,posts!inner(is_public)&mux_asset_id=not.is.null&mux_playback_policy=neq.signed&posts.is_public=eq.false',
);
await processRows('Post videos', 'post_items', items);

if (!APPLY) console.log('\nDry run only — re-run with --apply to convert.');
