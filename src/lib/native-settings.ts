/**
 * Deep link into this app's own page in iOS Settings.
 *
 * iOS asks for each permission exactly once. After a denial the app cannot
 * ask again — the only route back is Settings, so any surface that hits a
 * denied permission has to be able to point there rather than just saying
 * no twice.
 *
 * Delegates to the PhotoLibrary plugin's `openSettings`, which opens
 * `UIApplication.openSettingsURLString` — the app's own page, listing every
 * permission it has asked for. That is genuinely the same destination for
 * photos, contacts and location alike, so a second native method per
 * permission would be duplicate Swift for an identical call.
 */
import { Capacitor } from '@capacitor/core';
import { PhotoLibrary } from './native-photos';

/** Only the native shell has an app-settings page to open. A browser's
 *  permission UI can't be deep-linked at all, so callers should offer
 *  words there instead of a button that would do nothing. */
export const canOpenAppSettings = (): boolean => Capacitor.isNativePlatform();

export async function openAppSettings(): Promise<void> {
  try {
    await PhotoLibrary.openSettings();
  } catch { /* web, or an older shell without the plugin */ }
}
