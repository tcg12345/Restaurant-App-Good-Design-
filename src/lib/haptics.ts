import { readDevicePreference } from './device-preferences';
import { Capacitor } from '@capacitor/core';
import { LiquidGlass } from './native-glass';

/** UIKit feedback on device; browsers that support vibration get a light tick. */
export function homeHaptic(): void {
  if (!readDevicePreference('haptics')) return;
  if (Capacitor.isNativePlatform()) {
    void LiquidGlass.selectionHaptic().catch(() => {});
  } else {
    try { navigator.vibrate?.(8); } catch { /* Unsupported browser. */ }
  }
}
