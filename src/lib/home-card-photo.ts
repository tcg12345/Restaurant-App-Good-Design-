import { GOOGLE_PLACES_KEY } from './keys';

export interface HomeCardPhoto { url: string; authors: { name: string; uri?: string }[] }
interface Photo { name: string; widthPx: number; heightPx: number; authorAttributions?: { displayName?: string; uri?: string }[] }
const base = 'https://places.googleapis.com/v1';
const displayed = new Map<string, Promise<HomeCardPhoto | null>>();

// Explicit exception for the one home spotlight. General search/detail photo
// fetching stays disabled. Keep only this session's displayed result in memory.
export function getHomeCardPhoto(place: { id: string; name: string; address: string }): Promise<HomeCardPhoto | null> {
  const key = `${place.id}:${place.name}:${place.address}`;
  const existing = displayed.get(key);
  if (existing) return existing;
  const request = loadPhoto(place).catch(() => null);
  displayed.set(key, request);
  return request;
}

async function loadPhoto(place: { id: string; name: string; address: string }): Promise<HomeCardPhoto | null> {
  if (!GOOGLE_PLACES_KEY) return null;
  const headers = { 'X-Goog-Api-Key': GOOGLE_PLACES_KEY, 'Content-Type': 'application/json' };
  let photos: Photo[] = [];
  const id = place.id.replace(/^places\//, '');
  if (/^(ChI|Ei|GhI)[\w-]+$/.test(id)) {
    const response = await fetch(`${base}/places/${encodeURIComponent(id)}`, {
      headers: { ...headers, 'X-Goog-FieldMask': 'photos' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    photos = (await response.json()).photos || [];
  } else {
    // Imported/OSM restaurants need a Google match. Never guess from a name
    // alone: use the saved address and reject a different restaurant name.
    if (!place.address?.trim()) return null;
    const response = await fetch(`${base}/places:searchText`, {
      method: 'POST', headers: { ...headers, 'X-Goog-FieldMask': 'places.displayName,places.photos' },
      body: JSON.stringify({ textQuery: `${place.name}, ${place.address}`, maxResultCount: 1 }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const result = (await response.json()).places?.[0];
    const normalize = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!result || normalize(result.displayName?.text || '') !== normalize(place.name)) return null;
    photos = result.photos || [];
  }
  // Prefer a sharp photo that crops naturally into this almost-square tile;
  // preserve Google's ordering for equally suitable photos.
  const score = (p: Photo) => Math.min(p.widthPx, p.heightPx, 1000) / 1000 - Math.abs(Math.log(p.widthPx / p.heightPx));
  const photo = photos.filter(p => /^places\/[^/]+\/photos\/[^/]+$/.test(p.name) && p.widthPx > 0 && p.heightPx > 0)
    .sort((a, b) => score(b) - score(a))[0];
  if (!photo) return null;
  const response = await fetch(`${base}/${photo.name}/media?maxWidthPx=400&maxHeightPx=480&skipHttpRedirect=true`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_PLACES_KEY }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const { photoUri } = await response.json();
  if (typeof photoUri !== 'string' || !photoUri.startsWith('https://')) return null;
  return { url: photoUri, authors: (photo.authorAttributions || []).filter(a => a.displayName).map(a => ({ name: a.displayName!, uri: a.uri })) };
}
