/**
 * A dark page in a light app: the status-bar text has to go light while
 * the page is up and come back when it leaves. Only the status bar — the
 * window's own theme (tab bar, sheets) stays whatever the person chose.
 */
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useSettings } from '../contexts/SettingsContext';

export function useNightStatusBar(active = true): void {
  const { darkMode } = useSettings();
  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    return () => { void StatusBar.setStyle({ style: darkMode ? Style.Dark : Style.Light }).catch(() => {}); };
  }, [active, darkMode]);
}
