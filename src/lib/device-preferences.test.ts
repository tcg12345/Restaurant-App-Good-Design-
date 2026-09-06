import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_CHANGED, readDevicePreference, setDevicePreference } from './device-preferences';

describe('device preferences', () => {
  let values: Map<string, string>;
  let events: EventTarget;
  beforeEach(() => {
    values = new Map(); events = new EventTarget();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    vi.stubGlobal('window', events);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('preserves existing behavior until the user changes a setting', () => {
    expect(readDevicePreference('haptics')).toBe(true);
    expect(readDevicePreference('homeAutoplay')).toBe(true);
    expect(readDevicePreference('shareRatings')).toBe(true);
  });
  it('persists independent choices and notifies mounted consumers immediately', () => {
    const listener = vi.fn(); events.addEventListener(PREFERENCES_CHANGED, listener);
    setDevicePreference('shareRatings', false);
    expect(readDevicePreference('shareRatings')).toBe(false);
    expect(readDevicePreference('homeAutoplay')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setDevicePreference('shareRatings', true);
    expect(readDevicePreference('shareRatings')).toBe(true);
  });
});
