import { instrumentedFetch as fetch } from '../_shared/api-telemetry.ts';
/** Preflight before billable place lookups. The locked SQL mutation rechecks all
 * permissions and counts, so two simultaneous guests cannot bypass the limit. */
export function customAddPreflight(room: any, actor: string, placeId: unknown): 'existing' | 'add' {
  if (room?.error || !room?.members?.[actor]) throw Error('You are not in this room.');
  if (room.source !== 'custom' || room.status !== 'lobby') throw Error('Custom picks can only change before voting starts.');
  if (room.host !== actor && !room.allowGuestAdds) throw Error('Only the host can add restaurants.');
  if (typeof placeId !== 'string' || !/^[A-Za-z0-9_-]{5,300}$/.test(placeId)) throw Error('Choose a restaurant from search.');
  if (room.deck.some((p: any) => p.id === placeId)) return 'existing';
  if (room.deck.length >= 15) throw Error('The shortlist is full: 15 restaurants maximum.');
  if (room.host !== actor && room.deck.filter((p: any) => p.addedBy === actor).length >= 2) throw Error('Each guest can add up to two restaurants. Remove one to choose another.');
  return 'add';
}

export async function resolveCustomPlace(placeId: string, location: { lat: number; lng: number }, key: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,types,primaryType,businessStatus,priceLevel,rating,photos' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error('Couldn’t load this restaurant. Try again.');
  const p = await response.json();
  if (p.id !== placeId || !p.displayName?.text || p.businessStatus !== 'OPERATIONAL' || !p.types?.some((type: string) => type === 'restaurant' || type.endsWith('_restaurant') || type === 'cafe' || type === 'bakery')) throw Error('Choose an open-for-business restaurant, café or bakery.');
  const lat = p.location?.latitude, lng = p.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw Error('This restaurant’s location is unavailable. Try another result.');
  const distance = 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((lat - location.lat) * Math.PI / 360) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(location.lat * Math.PI / 180) * Math.sin((lng - location.lng) * Math.PI / 360) ** 2)));
  let photoUrl: string | null = null;
  if (p.photos?.[0]?.name) {
    try {
      const photo = await fetcher(`https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=1000&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(3000) });
      if (photo.ok) photoUrl = (await photo.json()).photoUri || null;
    } catch { /* Keep the restaurant even if its photo cannot be loaded. */ }
  }
  const priceMap: Record<string, number> = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
  return { id: p.id, name: p.displayName.text, address: p.formattedAddress || '', lat, lng, distance, photoUrl, attributions: p.photos?.[0]?.authorAttributions || [], rating: p.rating || 0, priceLevel: priceMap[p.priceLevel] || 0, cuisine: (p.primaryType || '').replace(/_restaurant$/, '').replaceAll('_', ' '), fit: 0, reason: 'Picked by your group' };
}
