/**
 * The app's dining anchor — the "Dining in {city}" that the home feed, the
 * map, the search results and every distance label measure from. One value,
 * shared: changing it on the home page changes the map, and picking a city
 * on the map changes the home page.
 *
 * TWO keys, because "where is the app anchored right now" and "where did the
 * user last CHOOSE to be" are different answers:
 *
 *  - `goodeats-home-last-location` is the live anchor. Every surface reads
 *    it, so it always names the place the app is currently showing —
 *    including a device fix resolved at launch.
 *  - `goodeats-home-picked-location` is the last location a person actually
 *    chose (onboarding, the picker, the map's location chip). It is what a
 *    launch falls back to when the device's location isn't available. Without
 *    the second key that choice would be unrecoverable, because a launch that
 *    resolved GPS has already overwritten the anchor with wherever they were
 *    standing.
 *
 * Writers emit a window event: a same-tab `localStorage.setItem` fires no
 * `storage` event, so without one the surfaces that write directly (the
 * picker sheet, the explore page) leave every other surface stale until it
 * remounts.
 */

export type HomeLocation = { label: string; lat: number; lng: number };

const ANCHOR_KEY = 'goodeats-home-last-location';
const PICKED_KEY = 'goodeats-home-picked-location';
/** Remembered outcome of a real geolocation call. Only consulted where the
 *  Permissions API is missing — see {@link geolocationAllowed}. */
const GEO_GRANTED_KEY = 'goodeats-geo-granted';

const CHANGE_EVENT = 'goodeats:home-location';

function readLoc(key: string): HomeLocation | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.label !== 'string') return null;
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
    return { label: parsed.label, lat: parsed.lat, lng: parsed.lng };
  } catch {
    return null;
  }
}

function writeLoc(key: string, loc: HomeLocation) {
  try {
    localStorage.setItem(key, JSON.stringify(loc));
  } catch {}
}

function emit(loc: HomeLocation) {
  try {
    window.dispatchEvent(new CustomEvent<HomeLocation>(CHANGE_EVENT, { detail: loc }));
  } catch {}
}

/** Where the app is anchored right now. */
export function loadLastSelectedLocation(): HomeLocation | null {
  return readLoc(ANCHOR_KEY);
}

/**
 * The last location the user chose. Falls back to the live anchor for
 * installs that predate the picked key — before it existed the anchor was
 * only ever written by an explicit pick, so it holds exactly that.
 */
export function loadPickedLocation(): HomeLocation | null {
  return readLoc(PICKED_KEY) ?? readLoc(ANCHOR_KEY);
}

/** Move the anchor without claiming the user chose it — the launch-time
 *  device fix, and nothing else. */
export function saveLastSelectedLocation(loc: HomeLocation) {
  writeLoc(ANCHOR_KEY, loc);
  emit(loc);
}

/** A deliberate choice: anchor the app here AND remember it as the place to
 *  come back to when the device's location isn't available. */
export function savePickedLocation(loc: HomeLocation) {
  writeLoc(PICKED_KEY, loc);
  writeLoc(ANCHOR_KEY, loc);
  emit(loc);
}

/** Fires on every write above, in this tab. Returns the unsubscribe. */
export function subscribeHomeLocation(fn: (loc: HomeLocation) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<HomeLocation>).detail;
    if (detail) fn(detail);
  };
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function noteGeolocationGranted() {
  try { localStorage.setItem(GEO_GRANTED_KEY, '1'); } catch {}
}

export function noteGeolocationDenied() {
  try { localStorage.removeItem(GEO_GRANTED_KEY); } catch {}
}

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * What the browser/OS says about location, without asking for it.
 *
 * 'unknown' is its own answer, not a synonym for denied: older WKWebViews
 * don't support the geolocation name and throw, and a surface that renders
 * "location is blocked" from a question it couldn't ask would be telling
 * the user something false about their own phone.
 */
export async function geolocationPermission(): Promise<GeoPermission> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'denied';
  const query = (navigator as Navigator & { permissions?: Permissions }).permissions?.query?.bind(
    navigator.permissions,
  );
  if (!query) return 'unknown';
  try {
    const status = await query({ name: 'geolocation' as PermissionName });
    if (status.state === 'granted') { noteGeolocationGranted(); return 'granted'; }
    if (status.state === 'denied') { noteGeolocationDenied(); return 'denied'; }
    return 'prompt';
  } catch {
    return 'unknown';
  }
}

/**
 * True when we can resolve the device's location WITHOUT surfacing a
 * permission dialog. Deliberately conservative: 'prompt' counts as no.
 * Launching the app is not a moment where an OS location dialog explains
 * itself, and on iOS that dialog is one-shot — a reflexive "Don't Allow"
 * there is unrecoverable in-app.
 *
 * Where the Permissions API can't answer, fall back to remembering that a
 * real call once succeeded, which is the same fact arrived at the only
 * other way available.
 */
export async function geolocationAllowed(): Promise<boolean> {
  const state = await geolocationPermission();
  if (state === 'granted') return true;
  if (state !== 'unknown') return false;
  try {
    return localStorage.getItem(GEO_GRANTED_KEY) === '1';
  } catch {
    return false;
  }
}

export type StartupSource = 'device' | 'picked' | 'none';

/**
 * How far a fresh device fix has to be from the anchor already on this
 * device before it counts as somewhere else. Under it, the launch keeps the
 * anchor it had: the recommendation cache is keyed on rounded coordinates
 * (~1.1 km cells), so replacing "Austin, TX" with a fix 200 m away would
 * miss the cache and re-spend on the Places API for a screen of the same
 * restaurants — every single launch, for anyone who moves at all.
 */
const ANCHOR_MOVE_MI = 1;

function milesBetween(a: HomeLocation, b: HomeLocation): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Which location the app opens on.
 *
 * Every launch starts where the user actually is, when location is allowed —
 * that is what "open the app and see what's around me" means, and a city
 * picked three weeks ago in another timezone is not it. When it isn't
 * allowed (denied, never asked, or the fix failed), the last location they
 * chose takes over: for a new account that is the city from onboarding,
 * which is what makes onboarding's answer the default until they change it.
 *
 * `device` is ignored unless `allowed` — the caller shouldn't have resolved
 * one at all in that case, and honouring a stale fix would quietly defeat
 * the "not allowed → their own choice" half of the rule.
 */
export function resolveStartupLocation(input: {
  allowed: boolean;
  device: HomeLocation | null;
  picked: HomeLocation | null;
  /** Where the app is anchored right now, if anywhere. */
  anchor?: HomeLocation | null;
}): { location: HomeLocation | null; source: StartupSource } {
  const { allowed, device, picked, anchor } = input;
  if (allowed && device) {
    // Same place, so keep the anchor exactly as it is — including its label,
    // which is why the header doesn't flip between "Austin, TX" and a street
    // address depending on which room the app was opened in.
    if (anchor && milesBetween(device, anchor) < ANCHOR_MOVE_MI) {
      return { location: anchor, source: 'device' };
    }
    return { location: device, source: 'device' };
  }
  if (picked) return { location: picked, source: 'picked' };
  return { location: null, source: 'none' };
}

/** Same place, allowing for float noise in a reverse-geocoded fix. */
export function sameHomeLocation(a: HomeLocation | null, b: HomeLocation | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4 && a.label === b.label;
}
