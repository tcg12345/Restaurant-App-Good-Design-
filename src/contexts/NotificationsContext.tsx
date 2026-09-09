import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  clearNotifications,
  rowToNotification,
  type AppNotification,
} from '../lib/supabase-notifications';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';

/**
 * The notification centre's state.
 *
 * Shaped after ChatContext: one fetch on sign-in, then a realtime
 * channel keeps the list live. postgres_changes runs RLS per subscriber,
 * so this stream only ever carries rows addressed to this user — no
 * server-side filter needed, and none would be trustworthy anyway.
 *
 * Actor profiles are resolved separately and cached: the notifications
 * table stores ids, not names, so a renamed user never leaves a stale
 * name behind in the list.
 */
interface NotificationsContextValue {
  notifications: AppNotification[];
  /** Actor profiles keyed by user id — may be missing while loading. */
  actors: Record<string, UserProfile>;
  unreadCount: number;
  loading: boolean;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  clearAll: () => void;
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export const NotificationsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const ownerRef = useRef(userId); ownerRef.current = userId;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [actors, setActors] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const countRevision = useRef(0);
  const refreshUnread = useCallback(async () => {
    const revision = ++countRevision.current;
    if (!userId || !supabaseConfigured) { setUnreadTotal(0); return; }
    try {
      const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
      if (!error && count != null && ownerRef.current === userId && revision === countRevision.current) setUnreadTotal(count);
    } catch { /* Keep the last known count while offline. */ }
  }, [userId]);
  useEffect(() => {
    // The activity list is paginated; the app icon still counts ALL unread updates.
    const timer = window.setTimeout(() => { void refreshUnread(); }, 150);
    return () => window.clearTimeout(timer);
  }, [notifications, refreshUnread]);

  const actorsRef = useRef<Record<string, UserProfile>>({});
  actorsRef.current = actors;
  const notificationsRef = useRef<AppNotification[]>([]);
  notificationsRef.current = notifications;

  /** Fetch any actor we don't already have. Runs after both the initial
   *  load and each realtime insert, so a notification from a stranger
   *  still renders with their name and avatar. */
  const hydrateActors = useCallback(async (ids: string[]) => {
    const missing = Array.from(new Set(ids)).filter((id) => id && !actorsRef.current[id]);
    if (missing.length === 0) return;
    const owner = ownerRef.current;
    const fetched = await getProfilesByIds(missing);
    if (owner !== ownerRef.current) return;
    if (Object.keys(fetched).length === 0) return;
    setActors((prev) => ({ ...prev, ...fetched }));
  }, []);

  const load = useCallback(async () => {
    if (!userId || !supabaseConfigured) { setNotifications([]); return; }
    setLoading(true);
    try {
      const rows = await listNotifications(userId);
      if (userId !== ownerRef.current) return;
      setNotifications(rows);
      void hydrateActors(rows.map((n) => n.actorId));
    } finally {
      if (userId === ownerRef.current) setLoading(false);
    }
  }, [userId, hydrateActors]);

  useEffect(() => {
    if (!userId) { setNotifications([]); setActors({}); setUnreadTotal(0); ++countRevision.current; return; }
    setNotifications([]); setActors({}); setUnreadTotal(null); ++countRevision.current;
    void load();
  }, [userId, load]);

  // ── Live delivery ──
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as Parameters<typeof rowToNotification>[0];
        if (ownerRef.current !== userId || !row?.id || row.user_id !== userId) return;
        const next = rowToNotification(row);
        setNotifications((prev) => (
          prev.some((n) => n.id === next.id)
            ? prev.map((n) => (n.id === next.id ? next : n))
            : [next, ...prev]
        ));
        void hydrateActors([next.actorId]);
      })
      // A re-like refreshes the existing row rather than inserting a new
      // one (the migration's ON CONFLICT), so UPDATEs matter too.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, (payload) => {
        const row = payload.new as Parameters<typeof rowToNotification>[0];
        if (ownerRef.current !== userId || !row?.id || row.user_id !== userId) return;
        const next = rowToNotification(row);
        setNotifications((prev) => {
          const has = prev.some((n) => n.id === next.id);
          const merged = has ? prev.map((n) => (n.id === next.id ? next : n)) : [next, ...prev];
          return merged.sort((a, b) => b.createdAt - a.createdAt);
        });
        void hydrateActors([next.actorId]);
      })
      // An un-like retracts its unread notification server-side.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications' }, (payload) => {
        const old = payload.old as { id?: string } | null;
        if (ownerRef.current !== userId || !old?.id) return;
        setNotifications((prev) => prev.filter((n) => n.id !== old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, hydrateActors]);

  const markRead = useCallback((ids: string[]) => {
    if (!userId || ids.length === 0) return;
    // A cold-launch push can be tapped before its row is loaded (or outside the first page).
    const unread = [...new Set(ids)].filter(id => !notificationsRef.current.some(n => n.id === id && n.readAt != null));
    if (unread.length === 0) return;
    const at = Date.now();
    setNotifications((prev) => prev.map((n) => (unread.includes(n.id) ? { ...n, readAt: at } : n)));
    void markNotificationsRead(userId, unread).then((ok) => {
      if (ownerRef.current !== userId) return;
      void refreshUnread();
      // The write didn't land — put the badge back rather than lie about it.
      if (!ok) setNotifications((prev) => prev.map((n) => (unread.includes(n.id) ? { ...n, readAt: null } : n)));
    });
  }, [userId, refreshUnread]);

  const markAllRead = useCallback(() => {
    if (!userId) return;
    const unread = notificationsRef.current.filter((n) => n.readAt == null).map((n) => n.id);
    const at = Date.now();
    setNotifications((prev) => prev.map((n) => (n.readAt == null ? { ...n, readAt: at } : n)));
    void markAllNotificationsRead(userId).then((ok) => {
      if (ownerRef.current !== userId) return;
      void refreshUnread();
      if (!ok) setNotifications((prev) => prev.map((n) => (unread.includes(n.id) ? { ...n, readAt: null } : n)));
    });
  }, [userId, refreshUnread]);

  const clearAll = useCallback(() => {
    if (!userId) return;
    const snapshot = notificationsRef.current;
    setNotifications([]);
    void clearNotifications(userId).then((ok) => { if (ownerRef.current !== userId) return; if (!ok) setNotifications(snapshot); void refreshUnread(); });
  }, [userId, refreshUnread]);

  const unreadCount = useMemo(
    () => unreadTotal ?? notifications.reduce((n, row) => n + (row.readAt == null ? 1 : 0), 0),
    [notifications, unreadTotal],
  );

  const value = useMemo<NotificationsContextValue>(() => ({
    notifications, actors, unreadCount, loading, markRead, markAllRead, clearAll, refresh: () => { void load(); },
  }), [notifications, actors, unreadCount, loading, markRead, markAllRead, clearAll, load]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

/** Safe outside the provider (guest surfaces, tests): returns an empty,
 *  inert centre rather than throwing. */
export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  return ctx ?? {
    notifications: [], actors: {}, unreadCount: 0, loading: false,
    markRead: () => {}, markAllRead: () => {}, clearAll: () => {}, refresh: () => {},
  };
}
