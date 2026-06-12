/**
 * Keeps the native iOS chrome in lockstep with the app's manual dark-mode
 * toggle (SettingsContext flips a `.dark` class — it deliberately does NOT
 * follow the OS appearance, so without this the status bar and native
 * surfaces would key off the wrong theme whenever the two disagree):
 *
 *   - Status bar text: explicit StatusBar.setStyle, so it's readable on
 *     the cream page in light mode and the near-black page in dark mode.
 *   - Everything else native (window background behind the keyboard's
 *     rounded corners, keyboard appearance, system sheets): the custom
 *     AppTheme plugin (MainViewController.swift) flips the window's
 *     overrideUserInterfaceStyle, which re-resolves every trait-aware
 *     UIColor to the matching variant.
 *
 * No-ops on the web.
 */

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

interface AppThemePlugin {
  setTheme(options: { dark: boolean }): Promise<void>;
}

export async function applyNativeTheme(dark: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // Style.Dark = light status-bar text (for dark backgrounds), and
    // vice versa.
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch (err) {
    console.warn('[theme] StatusBar.setStyle failed:', err);
  }

  try {
    const plugins = (window as unknown as {
      Capacitor?: { Plugins?: { AppTheme?: AppThemePlugin } };
    }).Capacitor?.Plugins;
    await plugins?.AppTheme?.setTheme({ dark });
  } catch (err) {
    console.warn('[theme] AppTheme.setTheme failed:', err);
  }
}
