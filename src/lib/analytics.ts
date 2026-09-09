import { restaurantDataSource } from './restaurant-provenance';
import { supabase, supabaseConfigured } from './supabase';
import { isNativeRuntime } from './native-oauth';
import { pageName, safeProperties } from '../../supabase/functions/_shared/analytics-schema';

export { pageName, safeProperties };
export const analyticsEnabled = import.meta.env.VITE_ANALYTICS_ENABLED === 'true';
export const searchTermsEnabled = import.meta.env.VITE_ANALYTICS_SEARCH_TERMS === 'true';
export type AnalyticsFields = { page?: string; restaurant_id?: string; restaurant_name?: string; feature?: string; duration_ms?: number; properties?: Record<string, unknown> };
type Event = AnalyticsFields & { user_id: string | null; id: string; event: string; occurred_at: string; anon_id: string; session_id: string; page: string; platform: string; app_version: string };
let queue: Event[] = [];
let posthogQueue: Event[] = [];
let pendingFlush: Promise<boolean> | undefined;
let userId: string | null = null;
let blocked = false;
let identityReady = false;
let currentPage = 'startup';
let sessionId = '';
let lastActivity = 0;
let anonId = '';
let posthog: typeof import('posthog-js').default | undefined;
let started = false;
let memoryOptOut = false;
const immediateEvents = new Set(['notification_permission_result', 'notification_permission_status', 'notification_prompt_skipped', 'notification_preference_changed', 'restaurant_saved', 'restaurant_unsaved', 'restaurant_rated', 'restaurant_list_added']);

// Retain business actions before background traffic when offline or saturated.
function boundedQueue(rows: Event[]) {
  if (rows.length <= 300) return rows;
  const actions = rows.filter(row => immediateEvents.has(row.event)).slice(0, 300);
  const remaining = 300 - actions.length;
  return remaining ? [...actions, ...rows.filter(row => !immediateEvents.has(row.event)).slice(-remaining)] : actions;
}

function optedOut() {
  try { return memoryOptOut || localStorage.getItem('goodeats-analytics-optout') === 'true'; } catch { return memoryOptOut; }
}
export function analyticsOptedOut() { return optedOut(); }
export function setAnalyticsOptOut(value: boolean) {
  memoryOptOut = value;
  try { localStorage.setItem('goodeats-analytics-optout', String(value)); } catch { /* private browsing */ }
  if (value) { queue = []; posthogQueue = []; posthog?.opt_out_capturing(); } else posthog?.opt_in_capturing();
}
function identity() {
  if (!anonId) {
    try { anonId = localStorage.getItem('goodeats-analytics-anon') || crypto.randomUUID(); localStorage.setItem('goodeats-analytics-anon', anonId); } catch { anonId = crypto.randomUUID(); }
  }
  const now = Date.now();
  if (!sessionId || now - lastActivity > 30 * 60_000) sessionId = crypto.randomUUID();
  lastActivity = now;
  return { anon_id: anonId, session_id: sessionId };
}
export function setAnalyticsIdentity(id: string | null, isAdmin: boolean) {
  if (identityReady && userId !== id) {
    // Never send an old account's buffered events under a new JWT.
    queue = []; posthogQueue = []; sessionId = ''; if (userId) anonId = crypto.randomUUID();
    try { localStorage.setItem('goodeats-analytics-anon', anonId); } catch { /* no storage */ }
    if (userId) posthog?.reset();
  }
  userId = id; blocked = isAdmin && import.meta.env.VITE_ANALYTICS_INCLUDE_ADMINS !== 'true'; identityReady = true;
  if (blocked) { queue = []; posthogQueue = []; posthog?.opt_out_capturing(); }
  else if (!optedOut()) {
    posthog?.opt_in_capturing();
    if (id) posthog?.identify(id);
    if (import.meta.env.VITE_POSTHOG_REPLAY === 'true') posthog?.startSessionRecording();
  }
}
export function analyticsContext() { return { ...identity(), page: currentPage, user_id: userId }; }
export function setAnalyticsPage(path: string) { currentPage = pageName(path); }
function enqueue(event: string, fields: AnalyticsFields = {}) {
  if (!analyticsEnabled || !identityReady || blocked || optedOut() || currentPage === 'admin') return;
  const properties = safeProperties(fields.properties);
  if (!searchTermsEnabled) delete properties.query;
  const row: Event = { user_id: userId, id: crypto.randomUUID(), event: event.slice(0, 64), occurred_at: new Date().toISOString(), ...identity(), page: currentPage, platform: isNativeRuntime() ? 'ios' : 'web', app_version: import.meta.env.VITE_APP_VERSION || '1.0.0', ...fields, restaurant_id: fields.restaurant_id?.slice(0,160), restaurant_name: fields.restaurant_name?.slice(0,160), feature: fields.feature?.slice(0,80), properties };
  // Keep business actions ahead of high-volume API telemetry, and start
  // sending them before a back navigation/reload can discard this document.
  if (immediateEvents.has(event)) queue.unshift(row);
  else queue.push(row);
  queue = boundedQueue(queue);
  if (posthog) { try { posthog.capture(event, row); } catch { /* optional sink */ } }
  else { posthogQueue.push(row); if (posthogQueue.length>300) posthogQueue.shift(); }
  if (immediateEvents.has(event) || queue.length >= 40) void flushAnalytics();
}
export function track(event: string, fields: AnalyticsFields = {}) {
  try { enqueue(event, fields); } catch { /* Analytics must never interrupt the product. */ }
}
export function flushAnalytics(): Promise<boolean> {
  if (pendingFlush) return pendingFlush;
  if (!supabaseConfigured || !queue.length || blocked || optedOut()) return Promise.resolve(false);
  // Keep every request within both the collector's payload cap and the
  // browser keepalive budget, including long Google field masks.
  const batch: Event[] = [];
  let bytes = 32;
  while (queue.length && batch.length < 40) {
    const size = new TextEncoder().encode(JSON.stringify(queue[0])).byteLength + 1;
    if (batch.length && bytes + size > 45 * 1024) break;
    batch.push(queue.shift()!); bytes += size;
  }
  const actor = userId;
  let succeeded = false;
  pendingFlush = (async () => {
    try {
      const { error } = await supabase.rpc('analytics_collect', { events: batch });
      if (error && actor === userId && !blocked && !optedOut()) queue = boundedQueue([...batch, ...queue]);
      succeeded = !error;
      return succeeded;
    } catch {
      if (actor === userId && !blocked && !optedOut()) queue = boundedQueue([...batch, ...queue]);
      return false;
    }
  })().finally(() => {
    pendingFlush = undefined;
    // A save may have arrived while another batch was already in flight.
    // Drain it as soon as that request finishes, but do not spin on errors.
    if (succeeded && actor === userId && queue.some(row => immediateEvents.has(row.event))) void flushAnalytics();
  });
  return pendingFlush;
}

/** Send final actions while the current JWT is still available. A slow or
 * offline analytics endpoint must not prevent the user from signing out. */
export async function flushAnalyticsBeforeSignOut(timeoutMs = 1500) {
  const actor = userId;
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const drain = async () => {
    while (!expired && actor === userId && (queue.length || pendingFlush)) {
      if (!await flushAnalytics()) break;
    }
  };
  try {
    await Promise.race([
      drain(),
      new Promise<void>(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer!); }
}
export function startAnalytics() {
  if (started || !analyticsEnabled) return;
  started = true;
  window.setInterval(() => void flushAnalytics(), 10_000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flushAnalytics(); });
  window.addEventListener('pagehide', () => { void flushAnalytics(); });
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (key) void import('posthog-js').then(({ default: ph }) => {
    posthog = ph;
    ph.init(key, { api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com', ip: false, before_send: (event) => {
      if (!event) return event;
      for (const key of Object.keys(event.properties)) if (/url|referr|utm|pathname|host|ip_address/i.test(key)) delete event.properties[key];
      delete event.properties.$set; delete event.properties.$set_once;
      return event;
    }, autocapture: false, capture_pageview: false, capture_pageleave: false, capture_dead_clicks: false, disable_session_recording: true, person_profiles: 'identified_only', opt_out_capturing_by_default: true, session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: '[data-analytics-private], img, video, canvas' } });
    if (identityReady && !blocked && !optedOut()) { ph.opt_in_capturing(); if (userId) ph.identify(userId); }
    // Replay is deliberately an explicit deployment decision, never enabled by merely adding a key.
    if (identityReady && !blocked && !optedOut()) {
      for (const row of posthogQueue.splice(0)) ph.capture(row.event, row);
      if (import.meta.env.VITE_POSTHOG_REPLAY === 'true') ph.startSessionRecording();
    }
  }).catch(() => { /* optional sink */ });
}

const names = new Map<string, string>();
export function rememberRestaurant(id: string, name?: string) { if (name) { names.set(id, name); if (names.size > 2000) names.delete(names.keys().next().value!); } }
export function trackRestaurant(event: string, id: string, name?: string, properties?: Record<string, unknown>) {
  rememberRestaurant(id, name);
  const data_source = restaurantDataSource(id, properties?.data_source);
  // Explicit provenance describes this action, without reclassifying other surfaces.
  track(event, { restaurant_id: id, restaurant_name: name || names.get(id), properties: { ...properties, data_source } });
}
