import { FEATURE_ROUTES } from '../lib/analytics-features';
import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../contexts/AuthContext';
import { analyticsEnabled, setAnalyticsIdentity, setAnalyticsPage, startAnalytics, track, trackRestaurant, pageName, flushAnalytics } from '../lib/analytics';

export function AnalyticsTracker() {
  const { user, isAdmin, adminChecked, loading } = useAuth();
  const location = useLocation();
  const previous = useRef({ key: '', actor: '', page: '', visitId: '' });
  useEffect(() => { startAnalytics(); }, []);
  // `false` is a completed check for a regular user; only 'unknown' is pending.
  useEffect(() => { if (!loading && (!user || adminChecked !== 'unknown')) setAnalyticsIdentity(user?.id ?? null, isAdmin); }, [user?.id, isAdmin, adminChecked, loading]);
  useEffect(() => {
    if (!analyticsEnabled || loading || (user && adminChecked === 'unknown')) return;
    const page = pageName(location.pathname);
    setAnalyticsPage(location.pathname);
    const actor = user?.id || 'anonymous';
    if (previous.current.key !== location.key || previous.current.actor !== actor) {
      const visitId = crypto.randomUUID();
      track('page_view', { feature: page, properties: { visit_id: visitId, source: previous.current.actor === actor ? previous.current.page || 'entry' : 'entry' } });
      previous.current = { key: location.key, actor, page, visitId };
    }
    const visitId = previous.current.visitId;
    let last = Date.now(), lastInput = Date.now(), foreground = !document.hidden;
    const account = () => {
      const now = Date.now();
      const ms = foreground ? Math.max(0, Math.min(now, lastInput + 60_000) - last) : 0;
      last = now;
      if (ms > 0) track('page_engagement', { page, feature: page, properties: { visit_id: visitId }, duration_ms: Math.min(ms, 30_000) });
    };
    const input = () => { account(); lastInput = Date.now(); };
    const visibility = () => { account(); foreground = !document.hidden; last = Date.now(); if (foreground) lastInput = last; };
    const timer = window.setInterval(account, 15_000);
    document.addEventListener('visibilitychange', visibility);
    // Throttle activity updates, never collect key values or input text.
    let tick = 0;
    const activity = () => { if (Date.now() - tick > 5000) { tick = Date.now(); input(); } };
    for (const name of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(name, activity, true);
    const native = Capacitor.isNativePlatform() ? App.addListener('appStateChange', ({ isActive }) => { account(); foreground = isActive; last = Date.now(); if (isActive) lastInput = last; else void flushAnalytics(); }) : null;
    return () => { account(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); for (const name of ['pointerdown', 'keydown', 'scroll']) window.removeEventListener(name, activity, true); void native?.then(h => h.remove()); };
  }, [location.key, location.pathname, loading, user?.id, adminChecked]);
  useEffect(() => {
    if (!analyticsEnabled || loading || (user && adminChecked === 'unknown')) return;
    const seen = new WeakMap<Element, string>();
    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const node = e.target as HTMLElement;
        const signature = `${node.dataset.restaurantId || ''}|${node.dataset.analyticsFeature || ''}`;
        if (!e.isIntersecting || e.intersectionRatio < .5 || document.hidden || !node.getClientRects().length || node.closest('[inert], [aria-hidden="true"]') || seen.get(node) === signature) continue;
        seen.set(node, signature);
        if (node.dataset.restaurantId) trackRestaurant('restaurant_seen', node.dataset.restaurantId, node.dataset.restaurantName, { data_source: node.dataset.restaurantSource });
        if (node.dataset.analyticsFeature) track('feature_seen', { feature: node.dataset.analyticsFeature });
      }
    }, { threshold: .5 });
    const observed = new WeakSet<Element>();
    const watch = (root: Element) => {
      for (const a of [root, ...root.querySelectorAll('a[href]')]) {
        const path = a.getAttribute('href')?.split(/[?#]/)[0] || '';
        if (FEATURE_ROUTES[path]) (a as HTMLElement).dataset.analyticsFeature = FEATURE_ROUTES[path];
      }
      for (const node of [root, ...root.querySelectorAll('[data-restaurant-id], [data-analytics-feature]')]) {
        if (node.matches('[data-restaurant-id], [data-analytics-feature]') && !observed.has(node)) { observed.add(node); observer.observe(node); }
      }
    };
    watch(document.body);
    const mutations = new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target instanceof Element) {
          observer.unobserve(r.target); observed.delete(r.target); watch(r.target);
        }
        for (const node of r.addedNodes) if (node instanceof Element) watch(node);
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-restaurant-id'] });
    const click = (event: MouseEvent) => {
      const target = (event.target as Element)?.closest?.('[data-analytics-feature]') as HTMLElement | null;
      if (target) track('feature_used', { feature: target.dataset.analyticsFeature });
      const outbound = (event.target as Element)?.closest?.('[data-analytics-outbound]') as HTMLElement | null;
      if (outbound?.dataset.analyticsRestaurant) trackRestaurant('restaurant_outbound', outbound.dataset.analyticsRestaurant, undefined, { action: outbound.dataset.analyticsOutbound });
    };
    document.addEventListener('click', click);
    return () => { observer.disconnect(); mutations.disconnect(); document.removeEventListener('click', click); };
  }, [location.key, loading, adminChecked, user?.id]);
  return null;
}
