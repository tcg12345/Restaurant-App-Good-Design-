import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as NativeApp } from '@capacitor/app';
import { useAuth } from './AuthContext';
import { track } from '../lib/analytics';
import { permissionOutcome, type NotificationPermissionSource } from '../lib/notification-analytics';
import { useCalendar } from './CalendarContext';
import { useLists } from './ListsContext';
import { useNotifications } from './NotificationsContext';
import { supabase } from '../lib/supabase';
import { hasPlanReview } from '../lib/calendar';
import { NativeNotifications, supportsIOSNotifications, disconnectNotifications, type NotificationAction, type NotificationPermission } from '../lib/native-notifications';
import { defaultNotificationPreferences, normalizeNotificationPreferences, mealNotifications, safeNotificationPath, type NotificationPreferences } from '../lib/notification-policy';

interface PushValue {
  preferences: NotificationPreferences; permission: NotificationPermission; native: boolean;
  loading: boolean; busy: boolean; error: string; registered: boolean;
  update: (patch: Partial<NotificationPreferences>) => Promise<void>;
  enable: (source?: NotificationPermissionSource) => Promise<void>; skipPermission: () => void; refresh: () => Promise<void>; test: () => Promise<void>;
}
const Context = createContext<PushValue | null>(null);
export const usePushNotifications = () => { const value = useContext(Context); if (!value) throw new Error('PushNotificationsProvider missing'); return value; };
export function PushNotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, adminChecked } = useAuth();
  const { plans } = useCalendar();
  const { ratings } = useLists();
  const { unreadCount, refresh: refreshActivity, markRead } = useNotifications();
  const location = useLocation(), navigate = useNavigate();
  const native = supportsIOSNotifications();
  const uid = user?.id ?? '';
  const owner = useRef(uid); owner.current = uid;
  const [state, setState] = useState({ owner: uid, preferences: defaultNotificationPreferences() });
  const preferences = state.owner === uid ? state.preferences : defaultNotificationPreferences();
  const current = useRef(preferences); current.current = preferences;
  const [permission, setPermission] = useState<NotificationPermission>(native ? 'prompt' : 'unavailable');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [registered, setRegistered] = useState(false);
  const [pendingAction, setPendingAction] = useState<NotificationAction | null>(null);
  const [tick, setTick] = useState(0);
  const refreshActivityRef = useRef(refreshActivity); refreshActivityRef.current = refreshActivity;
  const revision = useRef(0);
  const saveBusy = useRef(false);
  const permissionRequestBusy = useRef(false);
  const observedPermission = useRef<{ owner: string; permission: NotificationPermission } | null>(null);
  const notePermission = useCallback((value: NotificationPermission, source: NotificationPermissionSource) => {
    if (!uid || authLoading || adminChecked === 'unknown') return;
    const previous = observedPermission.current?.owner === uid ? observedPermission.current.permission : undefined;
    if (previous === value) return;
    observedPermission.current = { owner: uid, permission: value };
    track('notification_permission_status', { feature: 'notifications', properties: {
      outcome: permissionOutcome(value), source, action: previous ? 'changed' : 'initial',
      ...(previous ? { reason: permissionOutcome(previous) } : {}),
    } });
  }, [uid, authLoading, adminChecked]);
  const refresh = useCallback(async (source: NotificationPermissionSource = 'app_open') => {
    const request = ++revision.current;
    try {
      if (native) {
        const result = await NativeNotifications.status();
        if (request !== revision.current || uid !== owner.current) return;
        setPermission(result.permission);
        notePermission(result.permission, source);
      }
      if (!uid) { setState({ owner: uid, preferences: defaultNotificationPreferences() }); return; }
      const { data, error: failure } = await supabase.from('notification_preferences').select('*').eq('user_id', uid).maybeSingle();
      if (request !== revision.current || uid !== owner.current) return;
      if (failure) throw failure;
      const next = normalizeNotificationPreferences(data);
      current.current = next; setState({ owner: uid, preferences: next }); setError('');
      setTick(t => t + 1);
    } catch { if (uid === owner.current) setError('Couldn’t sync notification settings. Please try again.'); }
    finally { if (request === revision.current) setLoading(false); }
  }, [uid, native, notePermission]);
  useEffect(() => { setLoading(true); setRegistered(false); void refresh(); return () => { ++revision.current; }; }, [refresh]);
  useEffect(() => {
    const onResume = () => { if (!saveBusy.current && !permissionRequestBusy.current) void refresh('app_resume'); refreshActivity(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onResume(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onResume);
    const handle = native ? NativeApp.addListener('appStateChange', ({ isActive }) => { if (isActive) onResume(); }) : null;
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onResume); void handle?.then(h => h.remove()); };
  }, [refresh, native]);
  useEffect(() => {
    if (!native || authLoading) return;
    void NativeNotifications.setContext({ userId: uid, path: location.pathname + location.search, enabled: preferences.enabled }).catch(() => {});
  }, [native, uid, authLoading, location.pathname, location.search, preferences.enabled]);
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    const handles = [
      NativeNotifications.addListener('action', action => setPendingAction(action)),
      NativeNotifications.addListener('received', () => refreshActivityRef.current()),
      NativeNotifications.addListener('registrationError', () => { if (!cancelled) { setRegistered(false); setError('Meal reminders are ready. Remote notifications couldn’t connect; try enabling again.'); } }),
      NativeNotifications.addListener('registration', async ({ token, environment }) => {
        const recipient = owner.current;
        if (!recipient || !current.current.enabled || cancelled) return;
        try {
          const status = await NativeNotifications.status();
          if (recipient !== owner.current || !current.current.enabled || cancelled) return;
          const { error: failure } = await supabase.rpc('register_push_device', { p_installation_id: status.installationId, p_token: token, p_environment: environment });
          if (recipient !== owner.current || cancelled) return;
          if (failure) throw failure;
          setRegistered(true); setError('');
        } catch { if (recipient === owner.current && !cancelled) setError('Meal reminders are ready. Couldn’t connect remote notifications. Please try again.'); }
      }),
    ];
    return () => { cancelled = true; handles.forEach(h => void h.then(listener => listener.remove())); };
  }, [native]);
  useEffect(() => {
    if (!native || loading || !uid || !preferences.enabled || !['granted', 'provisional'].includes(permission)) return;
    void NativeNotifications.register().catch(() => setError('Couldn’t connect notifications. Please try again.'));
  }, [native, loading, uid, preferences.enabled, permission, tick]);
  useEffect(() => {
    if (!pendingAction || authLoading) return;
    // A notification belonging to a different account never navigates or marks data read.
    if (!uid) return;
    if (pendingAction.userId === uid) {
      const path = safeNotificationPath(pendingAction.path);
      if (path) { if (pendingAction.notificationId) markRead([pendingAction.notificationId]); navigate(path); }
    }
    setPendingAction(null);
  }, [pendingAction, uid, authLoading, navigate, markRead]);
  const reminders = useMemo(() => mealNotifications(plans.filter(p => !hasPlanReview(p, ratings) || p.status === 'planned').map(p => hasPlanReview(p, ratings) ? { ...p, review_state: 'reviewed' as const } : p), preferences, uid), [plans, ratings, preferences, uid, tick]);
  useEffect(() => {
    if (!native || loading || authLoading) return;
    void NativeNotifications.syncMeals({ notifications: uid && ['granted', 'provisional'].includes(permission) ? reminders : [] })
      .catch(() => setError('Couldn’t update meal reminders. Please reopen notification settings to retry.'));
  }, [native, loading, authLoading, uid, permission, reminders]);
  useEffect(() => { if (native && !authLoading) void NativeNotifications.setBadge({ count: preferences.enabled && uid ? unreadCount : 0 }).catch(() => {}); }, [native, unreadCount, uid, authLoading, preferences.enabled]);
  const update = async (patch: Partial<NotificationPreferences>, source: NotificationPermissionSource = 'settings') => {
    if (!uid || saveBusy.current) return;
    saveBusy.current = true; setBusy(true); setError(''); ++revision.current;
    const next = normalizeNotificationPreferences({ ...current.current, ...patch });
    // Never submit read-only DB fields from a loaded row.
    const { enabled, categories, previews, sound, reminder_minutes, quiet_enabled, quiet_start, quiet_end, timezone } = next;
    try {
      const { error: failure } = await supabase.from('notification_preferences').upsert({ user_id: uid, enabled, categories, previews, sound, reminder_minutes, quiet_enabled, quiet_start, quiet_end, timezone });
      if (failure) throw failure;
      if (uid !== owner.current) return;
      if (current.current.enabled !== enabled) track('notification_preference_changed', {
        feature: 'notifications', properties: { outcome: enabled ? 'enabled' : 'disabled', source },
      });
      current.current = next; setState({ owner: uid, preferences: next });
      if (!enabled && native) { await disconnectNotifications(); setRegistered(false); }
    } catch { if (uid === owner.current) setError('Couldn’t save this change. Your previous settings are still in place.'); }
    finally { saveBusy.current = false; setBusy(false); }
  };
  const enable = async (source: NotificationPermissionSource = 'settings') => {
    if (!native || !uid || loading || busy || permissionRequestBusy.current) return;
    permissionRequestBusy.current = true;
    let stage = 'permission_check';
    try {
      const before = await NativeNotifications.status();
      if (uid !== owner.current) return;
      notePermission(before.permission, source);
      stage = before.permission === 'prompt' ? 'system_prompt' : 'existing_permission';
      track('notification_permission_requested', { feature: 'notifications', properties: { source, stage } });
      const result = await NativeNotifications.requestPermission();
      if (uid !== owner.current) return;
      setPermission(result.permission);
      track('notification_permission_result', { feature: 'notifications', properties: { source, stage, outcome: permissionOutcome(result.permission) } });
      notePermission(result.permission, source);
      if (['granted', 'provisional'].includes(result.permission)) { await update({ enabled: true }, source); setTick(t => t + 1); }
    } catch {
      if (uid !== owner.current) return;
      track('notification_permission_error', { feature: 'notifications', properties: { source, stage, outcome: 'error' } });
      setError('Couldn’t request permission. Please try again.');
    } finally { permissionRequestBusy.current = false; }
  };
  const skipPermission = () => {
    if (!native || !uid || authLoading || adminChecked === 'unknown') return;
    track('notification_prompt_skipped', { feature: 'notifications', properties: { source: 'onboarding', outcome: 'not_now' } });
  };
  const test = async () => { try { await NativeNotifications.test(); } catch { setError('Couldn’t schedule the test notification. Check your iPhone notification permissions.'); } };
  return <Context.Provider value={{ preferences, permission, native, loading, busy, error, registered, update, enable, skipPermission, refresh, test }}>{children}</Context.Provider>;
}
