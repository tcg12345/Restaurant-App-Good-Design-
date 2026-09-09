import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCalendar } from '../contexts/CalendarContext';
import { useLists } from '../contexts/ListsContext';
import { useChat } from '../contexts/ChatContext';
import { useTasteProfile } from '../lib/useTasteProfile';
import { buildWidgetSnapshot, widgetDestination, type WidgetSnapshot } from '../lib/widget-data';
import { setWidgetOwner, supportsWidgets, syncWidgets } from '../lib/native-widgets';

const AccountWidgets: React.FC<{ owner: string }> = ({ owner }) => {
  const { profile, pendingRequestCount } = useAuth();
  const { plans } = useCalendar();
  const { ratings, wishlist } = useLists();
  const { unreadCount } = useChat();
  const [tick, setTick] = useState(0);
  const latest = useRef<WidgetSnapshot | null>(null);
  // Refresh the community standing when returning to the app, even when
  // the local rating count is unchanged but other people have moved up.
  const taste = useTasteProfile({ refresh: true, refreshKey: tick });
  useEffect(() => {
    const handle = NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) setTick(v => v + 1);
      // iOS can suspend JavaScript before the debounce expires when someone
      // saves a plan and immediately goes Home. Send the committed snapshot now.
      else if (latest.current) void syncWidgets(latest.current).catch(error => console.warn('[Widgets] Background sync failed', error));
    });
    return () => { void handle.then(h => h.remove()); };
  }, []);
  const snapshot = useMemo(() => buildWidgetSnapshot({ owner, plans, ratings, wishlist, taste, messages: unreadCount, requests: pendingRequestCount }),
    [owner, plans, ratings, wishlist, taste.points, taste.standing, taste.insights, taste.benchmarks, unreadCount, pendingRequestCount, tick]);
  useLayoutEffect(() => {
    latest.current = profile?.user_id === owner ? snapshot : null;
    return () => { latest.current = null; };
  }, [snapshot, profile?.user_id, owner]);
  useEffect(() => {
    if (profile?.user_id !== owner) return;
    // Providers start from this account's local cache. A slow network request
    // for chat or community rankings must not hold the meal widget hostage.
    // AuthContext clears caches and reloads before a different account mounts.
    const timer = setTimeout(() => { void syncWidgets(snapshot).catch(error => console.warn('[Widgets] Sync failed', error)); }, 400);
    return () => clearTimeout(timer);
  }, [snapshot, profile?.user_id, owner]);
  return null;
};

export function WidgetSync() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const owner = user?.id ?? '';
  useEffect(() => {
    if (!supportsWidgets() || loading) return;
    void setWidgetOwner(owner).catch(error => console.warn('[Widgets] Shared storage unavailable', error));
  }, [owner, loading]);
  useEffect(() => {
    if (!supportsWidgets()) return;
    let active = true;
    const open = (url: string) => { const path = widgetDestination(url); if (active && path) setPending(path); };
    const listener = NativeApp.addListener('appUrlOpen', ({ url }) => open(url));
    void NativeApp.getLaunchUrl().then(result => { if (result?.url) open(result.url); });
    return () => { active = false; void listener.then(handle => handle.remove()); };
  }, []);
  useEffect(() => {
    if (loading || !pending || !owner) return;
    navigate(pending); setPending(null);
  }, [pending, loading, owner, navigate]);
  return supportsWidgets() && !loading && owner ? <AccountWidgets key={owner} owner={owner} /> : null;
}
