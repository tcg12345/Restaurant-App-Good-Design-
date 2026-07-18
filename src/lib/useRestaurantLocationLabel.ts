// Shared location/distance resolution for restaurant cards.
//
// Previously every Pantry restaurant card re-implemented the same pipeline:
// backfill the saved restaurant's address components (one Places call + one
// Mapbox reverse-geocode), derive a Beli-style "Neighborhood, City, ST" label,
// and compute the haversine distance from the user's anchor location. Lifted
// here so any card (Pantry, maps, search, profile) can show the same label with
// a single hook call.

import { useEffect, useMemo } from 'react';
import { useLists, type RestaurantMeta } from '../contexts/ListsContext';
import { formatLocationLabel, fetchLocationDataForPlace } from './places';
import { useDistanceFromHome } from '../contexts/HomeLocationContext';
import { hasFreshHours } from './useWarmHours';

/**
 * Find today's entry in a Google Places `weekdayDescriptions` array.
 * Strings look like "Monday: 10:00 AM – 10:00 PM" or "Monday: Closed";
 * returns the right-hand side, or "" if today isn't published.
 */
export function formatTodayHours(hours: string[] | undefined): string {
  if (!hours || hours.length === 0) return '';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const line = hours.find((entry) => entry.startsWith(`${today}:`));
  if (!line) return '';
  return line.slice(today.length + 1).trim();
}

/**
 * Derive an "Open · until 10:30 PM" / "Closed · opens 5:30 PM" status from a
 * Google Places `weekdayDescriptions` array, computed against the current time
 * so it never goes stale (unlike a cached `openNow`). Returns `open: null` when
 * there's no hours data or the line can't be parsed, so callers can hide the
 * status chip entirely rather than guess.
 *
 * `detail` is ALWAYS the concise next boundary ("closes 2:30 PM" /
 * "opens 5:30 PM") — even on split lunch/dinner days — so status lines never
 * wrap. The full day schedule is returned separately as `schedule` for
 * tooltips/expanded views.
 */
export function getOpenStatus(hours?: string[]): { open: boolean | null; label: string; detail: string; schedule: string } {
  if (!hours || hours.length === 0) return { open: null, label: '', detail: '', schedule: '' };
  const now = new Date();
  const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const line = hours.find((h) => h.startsWith(`${todayName}:`));
  if (!line) return { open: null, label: '', detail: '', schedule: '' };
  // Today's schedule string ("11:30 AM – 3:00 PM, 5:00 PM – 10:00 PM"), with
  // any thin/no-break spaces normalised to regular ones.
  const schedule = line.slice(line.indexOf(':') + 1).trim().replace(/[   ]/g, ' ');

  if (/closed/i.test(schedule)) return { open: false, label: 'Closed', detail: '', schedule: '' };
  if (/(open\s*)?24\s*hours/i.test(schedule)) return { open: true, label: 'Open', detail: '24 hours', schedule: '24 hours' };

  // "10:30 PM" → minutes since midnight (12 AM → 0, 12 PM → 720).
  const parseTime = (s: string): number | null => {
    const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
    if (!m) return null;
    let h = parseInt(m[1], 10) % 12;
    if (/p/i.test(m[3])) h += 12;
    return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  };

  // One or more comma-separated ranges (split lunch/dinner days have several).
  // Google omits the AM/PM on the first time when both share a meridiem
  // ("5:00 – 10:00 PM"), so when the open time won't parse, retry it with the
  // close time's meridiem.
  const ranges = schedule.split(',').map((r) => r.trim()).filter(Boolean).map((r) => {
    const parts = r.split(/–|—|-| to /).map((x) => x.trim());
    if (parts.length < 2) return null;
    const close = parseTime(parts[1]);
    let open = parseTime(parts[0]);
    let openRaw = parts[0];
    if (open == null && close != null && !/[ap]m/i.test(parts[0])) {
      const mer = /pm$/i.test(parts[1]) ? 'PM' : /am$/i.test(parts[1]) ? 'AM' : '';
      if (mer) {
        open = parseTime(`${parts[0]} ${mer}`);
        openRaw = `${parts[0]} ${mer}`;
      }
    }
    if (open == null || close == null) return null;
    return { open, close, openRaw, closeRaw: parts[1] };
  });

  // If anything failed to parse, we can't compute Open/Closed reliably — just
  // surface the raw schedule for the day so the card still shows the hours.
  if (ranges.length === 0 || ranges.some((r) => r == null)) {
    return { open: null, label: '', detail: schedule, schedule };
  }
  const parsed = ranges as { open: number; close: number; openRaw: string; closeRaw: string }[];

  const nowMin = now.getHours() * 60 + now.getMinutes();
  let current: typeof parsed[number] | null = null;
  for (const r of parsed) {
    const overnight = r.close <= r.open; // e.g. 6 PM – 2 AM
    const isOpen = overnight ? nowMin >= r.open || nowMin < r.close : nowMin >= r.open && nowMin < r.close;
    if (isOpen) { current = r; break; }
  }

  // The next boundary is always concise — on a split lunch/dinner day the
  // current window's close ("closes 2:30 PM") or the next window's open
  // ("opens 5:30 PM"); the full schedule rides along for tooltips.
  if (current) return { open: true, label: 'Open', detail: `closes ${current.closeRaw}`, schedule };
  const upcoming = parsed.filter((r) => r.open > nowMin).sort((a, b) => a.open - b.open)[0];
  if (upcoming) return { open: false, label: 'Closed', detail: `opens ${upcoming.openRaw}`, schedule };
  return { open: false, label: 'Closed', detail: '', schedule };
}

/**
 * Backfill location data on saved restaurants so cards can render the Beli-style
 * "Neighborhood, Borough" / "Neighborhood, City, ST" label. One Places call
 * (deduped via inflight + cache) gives the address components; one Mapbox
 * reverse-geocode gives the neighborhood. Once written to the shared
 * restaurantMeta, every card using that meta upgrades to the richer label.
 */
export function useBackfillLocationComponents(restaurantId: string, hasFullData: boolean) {
  const { cacheRestaurantMeta } = useLists();
  useEffect(() => {
    if (!restaurantId || hasFullData) return;
    let cancelled = false;
    fetchLocationDataForPlace(restaurantId).then(({ addressComponents, neighborhood, lat, lng, hours }) => {
      if (cancelled) return;
      // Skip the meta write if every field is empty so we don't pointlessly
      // bump the cache.
      if (!addressComponents?.length && !neighborhood && lat == null && lng == null && hours == null) return;
      cacheRestaurantMeta({
        id: restaurantId,
        ...(addressComponents?.length ? { addressComponents } : {}),
        ...(neighborhood ? { neighborhood } : {}),
        ...(lat != null ? { lat } : {}),
        ...(lng != null ? { lng } : {}),
        // Persist an empty array too — that's the signal "we asked and the place
        // doesn't publish hours"; the timestamp bounds how long either answer
        // is trusted before a refetch.
        ...(hours != null ? { hours, hoursFetchedAt: Date.now() } : {}),
      });
    });
    return () => { cancelled = true; };
  }, [restaurantId, hasFullData, cacheRestaurantMeta]);
}

export interface RestaurantLocationLabel {
  /** Beli-style hierarchical label, e.g. "West Village, Manhattan". */
  location: string;
  /** Formatted distance from the user's anchor location, e.g. "3.2 mi". */
  distance: string;
  /** Today's opening hours (right-hand side of the weekday line). */
  todayHours: string;
  meta: RestaurantMeta | undefined;
}

/**
 * Resolve the display location + distance (+ today's hours) for a saved
 * restaurant, kicking off the address backfill on first use.
 */
export function useRestaurantLocationLabel(
  restaurantId: string,
  addressFallback?: string,
): RestaurantLocationLabel {
  const { restaurantMeta } = useLists();
  const meta = restaurantMeta[restaurantId];

  useBackfillLocationComponents(
    restaurantId,
    // Stale hours count as "not full" so a schedule change eventually
    // reaches cards that only ever hit this backfill path.
    !!meta?.addressComponents && meta?.neighborhood !== undefined && hasFreshHours(meta),
  );

  const fullAddress = addressFallback || meta?.address || '';
  const location = useMemo(
    () => (fullAddress ? formatLocationLabel(meta?.addressComponents, fullAddress, meta?.neighborhood) : ''),
    [fullAddress, meta?.addressComponents, meta?.neighborhood],
  );

  // Reactive to home-location changes (the old loadLastSelectedLocation()
  // read inside a useMemo kept stale distances until remount).
  const distance = useDistanceFromHome(meta?.lat, meta?.lng);

  const todayHours = useMemo(() => formatTodayHours(meta?.hours), [meta?.hours]);

  return { location, distance, todayHours, meta };
}
