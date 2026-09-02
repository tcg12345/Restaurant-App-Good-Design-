import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadLastSelectedLocation,
  loadPickedLocation,
  saveLastSelectedLocation,
  savePickedLocation,
  subscribeHomeLocation,
  resolveStartupLocation,
  sameHomeLocation,
  geolocationAllowed,
  noteGeolocationGranted,
  type HomeLocation,
} from './home-location-store';

/* ── Harness ───────────────────────────────────────────────────────────── */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const ANCHOR_KEY = 'goodeats-home-last-location';
const PICKED_KEY = 'goodeats-home-picked-location';

let store: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NYC: HomeLocation = { label: 'New York, NY', lat: 40.7128, lng: -74.006 };
const AUSTIN: HomeLocation = { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 };
const DEVICE: HomeLocation = { label: '18 Elm St, Chicago, IL', lat: 41.8781, lng: -87.6298 };

/* ── Which location the app opens on ───────────────────────────────────── */

describe('resolveStartupLocation', () => {
  it('opens on the device location when location is allowed', () => {
    expect(resolveStartupLocation({ allowed: true, device: DEVICE, picked: AUSTIN })).toEqual({
      location: DEVICE,
      source: 'device',
    });
  });

  it('falls back to the last picked location when location is not allowed', () => {
    expect(resolveStartupLocation({ allowed: false, device: null, picked: AUSTIN })).toEqual({
      location: AUSTIN,
      source: 'picked',
    });
  });

  it('falls back to the last picked location when the fix fails despite permission', () => {
    expect(resolveStartupLocation({ allowed: true, device: null, picked: AUSTIN })).toEqual({
      location: AUSTIN,
      source: 'picked',
    });
  });

  it('never uses a device fix that permission does not cover', () => {
    // Belt and braces: a caller that resolved GPS anyway must not be able to
    // override the user's own choice with it.
    expect(resolveStartupLocation({ allowed: false, device: DEVICE, picked: AUSTIN }).location).toBe(AUSTIN);
  });

  it('keeps the anchor when the device has not really moved', () => {
    // ~0.4 mi away: same neighbourhood, same recommendations. Keeping the
    // anchor keeps its label and its rec-cache key.
    const nearby = { label: '400 W 6th St, Austin, TX', lat: AUSTIN.lat + 0.006, lng: AUSTIN.lng };
    expect(resolveStartupLocation({ allowed: true, device: nearby, picked: AUSTIN, anchor: AUSTIN })).toEqual({
      location: AUSTIN,
      source: 'device',
    });
  });

  it('takes the device fix once it is a different place', () => {
    expect(
      resolveStartupLocation({ allowed: true, device: DEVICE, picked: AUSTIN, anchor: AUSTIN }).location,
    ).toBe(DEVICE);
  });

  it('reports none when there is nothing to open on', () => {
    expect(resolveStartupLocation({ allowed: false, device: null, picked: null })).toEqual({
      location: null,
      source: 'none',
    });
  });
});

/* ── Anchor vs. pick ───────────────────────────────────────────────────── */

describe('anchor and pick', () => {
  it('a pick writes both keys, so it survives a launch that resolved GPS', () => {
    savePickedLocation(AUSTIN);
    expect(store.getItem(PICKED_KEY)).toBeTruthy();
    expect(loadLastSelectedLocation()).toEqual(AUSTIN);

    // Next launch, location allowed: the anchor moves to the device…
    saveLastSelectedLocation(DEVICE);
    expect(loadLastSelectedLocation()).toEqual(DEVICE);
    // …but the city they chose is still what a denied launch comes back to.
    expect(loadPickedLocation()).toEqual(AUSTIN);
  });

  it('treats a pre-existing anchor as the pick for installs made before the second key', () => {
    store.setItem(ANCHOR_KEY, JSON.stringify(AUSTIN));
    expect(loadPickedLocation()).toEqual(AUSTIN);
  });

  it('ignores malformed or half-written entries', () => {
    store.setItem(ANCHOR_KEY, '{"label":"Nowhere"}');
    expect(loadLastSelectedLocation()).toBeNull();
    store.setItem(ANCHOR_KEY, 'not json');
    expect(loadLastSelectedLocation()).toBeNull();
  });

  it('notifies subscribers on every write — a same-tab setItem fires no storage event', () => {
    const seen: HomeLocation[] = [];
    const off = subscribeHomeLocation((loc) => seen.push(loc));
    savePickedLocation(AUSTIN);
    saveLastSelectedLocation(DEVICE);
    off();
    savePickedLocation(NYC);
    expect(seen).toEqual([AUSTIN, DEVICE]);
  });
});

describe('sameHomeLocation', () => {
  it('matches through float noise but not across a real move', () => {
    expect(sameHomeLocation(NYC, { ...NYC, lat: NYC.lat + 0.00001 })).toBe(true);
    expect(sameHomeLocation(NYC, AUSTIN)).toBe(false);
    expect(sameHomeLocation(null, null)).toBe(true);
    expect(sameHomeLocation(NYC, null)).toBe(false);
  });

  it('treats a relabelled pin as a change — the label is what the chip shows', () => {
    expect(sameHomeLocation(NYC, { ...NYC, label: 'Manhattan, NY' })).toBe(false);
  });
});

/* ── Permission ────────────────────────────────────────────────────────── */

describe('geolocationAllowed', () => {
  const withNavigator = (nav: Partial<Navigator>) => vi.stubGlobal('navigator', nav);

  it('is false when the browser cannot geolocate at all', async () => {
    withNavigator({});
    expect(await geolocationAllowed()).toBe(false);
  });

  it('is true only for a granted permission, never for an unanswered one', async () => {
    const state = { value: 'granted' as PermissionState };
    withNavigator({
      geolocation: {} as Geolocation,
      permissions: { query: async () => ({ state: state.value }) } as unknown as Permissions,
    });
    expect(await geolocationAllowed()).toBe(true);
    state.value = 'prompt';
    expect(await geolocationAllowed()).toBe(false);
    state.value = 'denied';
    expect(await geolocationAllowed()).toBe(false);
  });

  it('forgets a remembered grant once the permission reads denied', async () => {
    noteGeolocationGranted();
    withNavigator({
      geolocation: {} as Geolocation,
      permissions: { query: async () => ({ state: 'denied' as PermissionState }) } as unknown as Permissions,
    });
    await geolocationAllowed();
    // The remembered flag is the fallback path's only input — a stale one
    // would keep claiming permission on a WKWebView without the API.
    withNavigator({ geolocation: {} as Geolocation });
    expect(await geolocationAllowed()).toBe(false);
  });

  it('falls back to a remembered successful fix where the Permissions API is missing', async () => {
    withNavigator({ geolocation: {} as Geolocation });
    expect(await geolocationAllowed()).toBe(false);
    noteGeolocationGranted();
    expect(await geolocationAllowed()).toBe(true);
  });

  it('falls back the same way when the API throws on the geolocation name', async () => {
    noteGeolocationGranted();
    withNavigator({
      geolocation: {} as Geolocation,
      permissions: { query: async () => { throw new TypeError('unsupported'); } } as unknown as Permissions,
    });
    expect(await geolocationAllowed()).toBe(true);
  });
});
