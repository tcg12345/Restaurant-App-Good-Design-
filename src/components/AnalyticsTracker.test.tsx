// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, rpc } = vi.hoisted(() => {
  vi.stubEnv('VITE_ANALYTICS_ENABLED', 'true');
  vi.stubEnv('VITE_ANALYTICS_INCLUDE_ADMINS', 'false');
  return {
    auth: { user: { id: 'regular-user' }, isAdmin: false, adminChecked: 'unknown' as boolean | 'unknown', loading: false },
    rpc: vi.fn().mockResolvedValue({ error: null }),
  };
});
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../lib/supabase', () => ({ supabaseConfigured: true, supabase: { rpc } }));
vi.mock('../lib/native-oauth', () => ({ isNativeRuntime: () => false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
import { AnalyticsTracker } from './AnalyticsTracker';
import { useRestaurantAnalytics } from '../lib/useRestaurantAnalytics';
import { flushAnalytics, setAnalyticsIdentity, setAnalyticsOptOut, setAnalyticsPage, trackRestaurant } from '../lib/analytics';

const restaurantId = 'cottage-westport';
let host: HTMLDivElement, root: Root;
let intersections: Array<{ callback: IntersectionObserverCallback; nodes: Set<Element> }>;

function Flow() {
  const route = useLocation();
  const navigate = useNavigate();
  const detail = route.pathname.startsWith('/restaurant/');
  useRestaurantAnalytics(detail ? restaurantId : undefined, 'The Cottage');
  return detail
    ? <button onClick={() => trackRestaurant('restaurant_saved', restaurantId, 'The Cottage')}>Save to wishlist</button>
    : <button data-restaurant-id={restaurantId} data-restaurant-name="The Cottage" onClick={() => {
        trackRestaurant('restaurant_search_selected', restaurantId, 'The Cottage');
        navigate(`/restaurant/${restaurantId}`);
      }}>The Cottage</button>;
}
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/search/main']}><AnalyticsTracker /><Flow /></MemoryRouter>));
}
function exposeResults() {
  for (const observer of intersections) {
    observer.callback([...observer.nodes].map(target => ({ target, isIntersecting: true, intersectionRatio: 1 }) as IntersectionObserverEntry), {} as IntersectionObserver);
  }
}
function events() { return rpc.mock.calls.flatMap(([, args]) => args.events); }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  setAnalyticsOptOut(false);
  // Clear prior buffers and prevent capture until the tracker resolves this account.
  setAnalyticsIdentity('previous-admin', true);
  setAnalyticsPage('/');
  auth.user = { id: 'regular-user' };
  auth.isAdmin = false;
  auth.adminChecked = 'unknown';
  rpc.mockClear();
  intersections = [];
  vi.stubGlobal('IntersectionObserver', class {
    record: typeof intersections[number];
    constructor(callback: IntersectionObserverCallback) { this.record = { callback, nodes: new Set() }; intersections.push(this.record); }
    observe(node: Element) { this.record.nodes.add(node); }
    disconnect() { this.record.nodes.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setAnalyticsIdentity('cleanup-admin', true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('analytics for ordinary signed-in users', () => {
  it('waits for the admin check, then records search visibility, selection, details and save on the correct pages', async () => {
    await render();
    exposeResults();
    await flushAnalytics();
    expect(rpc).not.toHaveBeenCalled();

    auth.adminChecked = false;
    await render();
    exposeResults();
    exposeResults(); // the same visible card is counted once
    await act(async () => host.querySelector('button')!.click());
    await act(async () => host.querySelector('button')!.click());
    await flushAnalytics();
    const rows = events();
    for (const [event, page] of [
      ['restaurant_seen', 'search_main'],
      ['restaurant_search_selected', 'search_main'],
      ['restaurant_opened', 'restaurant_detail'],
      ['restaurant_saved', 'restaurant_detail'],
    ]) {
      expect(rows.filter(row => row.event === event)).toEqual([
        expect.objectContaining({ restaurant_id: restaurantId, user_id: 'regular-user', page }),
      ]);
    }
    expect(rows.filter(row => row.event === 'page_view').map(row => row.page)).toEqual(['search_main', 'restaurant_detail']);
  });

  it('records a detail visit when a regular account is already resolved at mount', async () => {
    auth.adminChecked = false;
    await act(async () => root.render(<MemoryRouter initialEntries={[`/restaurant/${restaurantId}`]}><AnalyticsTracker /><Flow /></MemoryRouter>));
    await flushAnalytics();
    expect(events()).toContainEqual(expect.objectContaining({ event: 'restaurant_opened', user_id: 'regular-user', page: 'restaurant_detail' }));
  });

  it('continues to exclude administrator activity', async () => {
    auth.user = { id: 'owner' }; auth.isAdmin = true; auth.adminChecked = true;
    await render(); exposeResults();
    await act(async () => host.querySelector('button')!.click());
    await act(async () => host.querySelector('button')!.click());
    await flushAnalytics();
    expect(rpc).not.toHaveBeenCalled();
  });
});
