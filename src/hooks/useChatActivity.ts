import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { supabase, supabaseConfigured } from '../lib/supabase';

export type ChatActivity = 'idle' | 'typing' | 'sending';
export const ACTIVITY_EXPIRY_MS = 5000;
const HEARTBEAT_MS = 1500;
const IDLE_MS = 2200;

/** Ephemeral status only: draft contents never leave the composer. Each
 * sender has their own RLS-protected topic, so peers cannot impersonate them. */
export function useChatActivity(conversationId: string | null, userId: string | undefined,
  participantIds: string[], sending: boolean) {
  const [peers, setPeers] = useState<Record<string, Exclude<ChatActivity, 'idle'>>>({});
  const control = useRef({ type: (_hasText: boolean) => {}, stop: () => {}, sending: (_value: boolean) => {} });
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const participantKey = [...new Set(participantIds)].sort().join(',');

  useEffect(() => {
    setPeers({});
    if (!conversationId || !userId || !supabaseConfigured) return;
    const ids = participantKey.split(',').filter(Boolean);
    if (!ids.includes(userId)) return;
    let disposed = false;
    let foreground = document.visibilityState !== 'hidden';
    let connected = false;
    let typing = false;
    let isSending = sendingRef.current;
    let lastState: ChatActivity = 'idle';
    let lastSent = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Map<string, ReturnType<typeof setTimeout>>();
    const own = supabase.channel(`chat-activity:${conversationId}:${userId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    const publish = (force = false) => {
      if (!connected || disposed) return;
      const state: ChatActivity = foreground && navigator.onLine ? (isSending ? 'sending' : typing ? 'typing' : 'idle') : 'idle';
      if (!force && state === lastState && (state === 'idle' || Date.now() - lastSent < HEARTBEAT_MS)) return;
      lastState = state;
      lastSent = Date.now();
      // A disconnected channel must never fall back to an HTTP broadcast.
      void own.send({ type: 'broadcast', event: 'activity', payload: { state } }).catch(() => {});
    };
    const stop = () => { typing = false; clearTimeout(idleTimer); publish(); };
    control.current = {
      type: (hasText) => {
        if (!hasText) { stop(); return; }
        typing = true;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(stop, IDLE_MS);
        publish();
      },
      stop,
      sending: (value) => { isSending = value; if (value) typing = false; publish(); },
    };
    own.subscribe((status) => {
      if (disposed) return;
      connected = status === 'SUBSCRIBED';
      if (connected) publish(true);
    });
    const clearPeer = (id: string) => {
      clearTimeout(expiry.get(id));
      expiry.delete(id);
      if (!disposed) setPeers((prev) => { const next = { ...prev }; delete next[id]; return next; });
    };
    const channels = ids.filter((id) => id !== userId).map((id) => {
      const channel = supabase.channel(`chat-activity:${conversationId}:${id}`, { config: { private: true } });
      channel.on('broadcast', { event: 'activity' }, ({ payload }) => {
        if (disposed || !foreground) return;
        const state: unknown = payload?.state;
        if (state !== 'typing' && state !== 'sending') { if (state === 'idle') clearPeer(id); return; }
        clearTimeout(expiry.get(id));
        setPeers((prev) => ({ ...prev, [id]: state }));
        expiry.set(id, setTimeout(() => clearPeer(id), ACTIVITY_EXPIRY_MS));
      }).subscribe((status) => { if (status !== 'SUBSCRIBED') clearPeer(id); });
      return channel;
    });
    const setForeground = (active: boolean) => {
      foreground = active;
      stop();
      for (const id of expiry.keys()) clearPeer(id);
      if (active) publish(true);
    };
    const visibility = () => setForeground(document.visibilityState !== 'hidden');
    const offline = () => setForeground(false);
    const online = () => visibility();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    const appListener = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => setForeground(isActive)) : null;
    const heartbeat = setInterval(() => publish(), HEARTBEAT_MS);
    return () => {
      foreground = false;
      publish(true);
      disposed = true;
      control.current = { type: () => {}, stop: () => {}, sending: () => {} };
      clearTimeout(idleTimer);
      clearInterval(heartbeat);
      for (const timer of expiry.values()) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      void appListener?.then((listener) => listener.remove());
      for (const channel of [own, ...channels]) void supabase.removeChannel(channel);
    };
  }, [conversationId, userId, participantKey]);

  useEffect(() => { control.current.sending(sending); }, [sending]);
  const notifyTyping = useCallback((hasText: boolean) => control.current.type(hasText), []);
  const stopTyping = useCallback(() => control.current.stop(), []);
  return { peers, notifyTyping, stopTyping };
}
