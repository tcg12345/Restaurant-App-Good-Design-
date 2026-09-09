import { clearWidgets } from './native-widgets';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { supabase } from './supabase';
import type { MealNotification } from './notification-policy';

export type NotificationPermission = 'prompt' | 'denied' | 'granted' | 'provisional' | 'unavailable';
export interface NotificationAction { path?: string; userId?: string; notificationId?: string }
interface NativeNotificationsPlugin {
  status(): Promise<{ permission: NotificationPermission; installationId: string }>;
  requestPermission(): Promise<{ permission: NotificationPermission }>;
  register(): Promise<void>;
  setContext(options: { userId: string; path: string; enabled: boolean }): Promise<void>;
  syncMeals(options: { notifications: MealNotification[] }): Promise<void>;
  setBadge(options: { count: number }): Promise<void>;
  reset(): Promise<void>;
  test(): Promise<void>;
  addListener(event: 'registration', listener: (data: { token: string; environment: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'registrationError', listener: (data: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'action', listener: (data: NotificationAction) => void): Promise<PluginListenerHandle>;
  addListener(event: 'received', listener: () => void): Promise<PluginListenerHandle>;
}
export const NativeNotifications = registerPlugin<NativeNotificationsPlugin>('GoodEatsNotifications');
export const supportsIOSNotifications = () => Capacitor.getPlatform() === 'ios';

/** Run before sign-out while the current JWT can still revoke this installation. */
export async function disconnectNotifications(): Promise<void> {
  if (!supportsIOSNotifications()) return;
  await clearWidgets().catch(() => {});
  try {
    const { installationId } = await NativeNotifications.status();
    await supabase.rpc('unregister_push_device', { p_installation_id: installationId });
  } finally {
    // Even offline, unregister APNs and remove scheduled/delivered private content.
    await NativeNotifications.reset().catch(() => {});
  }
}
