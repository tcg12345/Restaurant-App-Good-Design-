import { instrumentedFetch as fetch } from './api-telemetry.ts';

export const MUX_API = 'https://api.mux.com/video/v1';
export function muxBelongsToRow(passthrough: unknown, ownerId: string, rowId: string, allowLegacyReel = false): boolean {
  // Bare row IDs support legacy REELS only. Old deployed uploads/webhooks
  // supported reels exclusively; allowing post-item IDs would permit a
  // cross-table UUID collision to claim another owner's legacy reel.
  // The row ID must still be the server-loaded row, never a request-supplied owner.
  return passthrough === `${ownerId}:${rowId}` || (allowLegacyReel && passthrough === rowId);
}
export interface OwnedMuxAsset {
  id: string;
  playback_ids?: Array<{ id: string; policy: string }>;
}
export async function getOwnedMuxAsset(auth: string, assetId: string, ownerId: string, rowId: string, allowLegacyReel = false): Promise<OwnedMuxAsset | null> {
  if (!/^[A-Za-z0-9]+$/.test(assetId)) return null;
  const response = await fetch(`${MUX_API}/assets/${assetId}`, {
    headers: { Authorization: auth }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const asset = (await response.json())?.data;
  if (!muxBelongsToRow(asset?.passthrough, ownerId, rowId, allowLegacyReel)) return null;
  return asset;
}
