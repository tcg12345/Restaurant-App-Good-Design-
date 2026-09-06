import { useSyncExternalStore } from 'react';
export type DevicePreference = 'haptics' | 'homeAutoplay' | 'shareRatings';
const PREFIX = 'goodeats-preference:';
export const PREFERENCES_CHANGED = 'goodeats:preferences-changed';
export function readDevicePreference(key: DevicePreference): boolean {
  try { return localStorage.getItem(PREFIX + key) !== '0'; } catch { return true; }
}
export function setDevicePreference(key: DevicePreference, enabled: boolean): void {
  try { localStorage.setItem(PREFIX + key, enabled ? '1' : '0'); } catch { return; }
  window.dispatchEvent(new Event(PREFERENCES_CHANGED));
}
function subscribe(listener: () => void) {
  window.addEventListener(PREFERENCES_CHANGED, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(PREFERENCES_CHANGED, listener); window.removeEventListener('storage', listener); };
}
export function useDevicePreference(key: DevicePreference): [boolean, (enabled: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => readDevicePreference(key), () => true), value => setDevicePreference(key, value)];
}
