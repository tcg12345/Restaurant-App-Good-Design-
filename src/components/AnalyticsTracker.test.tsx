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
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../contexts/SignInModalContext', () => ({ useSignInModal: () => ({ requireSignIn: vi.fn() }) }));
vi.mock('../lib/supabase-db', () => ({
  loadUserData: vi.fn().mockResolvedValue(null), saveRatings: vi.fn().mockResolvedValue(true),
  saveLists: vi.fn().mockResolvedValue(true), saveWishlistData: vi.fn().mockResolvedValue(true),
  saveMetaData: vi.fn().mockResolvedValue(true), saveUserData: vi.fn().mockResolvedValue(true),
  saveRecentViews: vi.fn().mockResolvedValue(true), saveTrips: vi.fn().mockResolvedValue(true),
  saveHomeMeals: vi.fn().mockResolvedValue(true), saveCustomOrder: vi.fn().mockResolvedValue(true),
  saveVisitHistoryColumn: vi.fn().mockResolvedValue(true),
}));
vi.mock('../lib/supabase-community', () => ({
  getUserRatings: vi.fn().mockResolvedValue([]), getVisitHistory: vi.fn().mockResolvedValue([]),
  listMyCommunityRestaurantIds: vi.fn().mockResolvedValue([]), getMyCommunityPhotoUrls: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/restaurant-cuisine', () => ({
  getRestaurantCuisineBatch: vi.fn().mockResolvedValue(new Map()), getRestaurantCuisine: vi.fn().mockResolvedValue(null),
  publishRestaurantCuisine: vi.fn().mockResolvedValue(undefined), PERSIST_CONFIDENCE_FLOOR: 0.8,
}));
vi.mock('../lib/cuisine-lookup', () => ({ lookupCuisines: vi.fn().mockResolvedValue([]) }));
import { AnalyticsTracker } from './AnalyticsTracker';
import { ListsProvider, useLists } from '../contexts/ListsContext';
import { saveWishlistData } from '../lib/supabase-db';
import { useRestaurantAnalytics } from '../lib/useRestaurantAnalytics';
import { flushAnalytics, setAnalyticsIdentity, setAnalyticsOptOut, setAnalyticsPage, trackRestaurant } from '../lib/analytics';

const restaurantId = 'cottage-westport';
let host: HTMLDivElement, root: Root;
let intersections: Array<{ callback: IntersectionObserverCallback; nodes: Set<Element> }>;

function Flow() {
  const { toggleWishlist, isWishlisted } = useLists();
  const route = useLocation();
  const navigate = useNavigate();
  const detail = route.pathname.startsWith('/restaurant/');
  useRestaurantAnalytics(detail ? restaurantId : undefined, 'The Cottage');
  return detail
    ? <button onClick={() => toggleWishlist({ id: restaurantId, name: 'The Cottage', image: '', cuisine: 'American', price: '$$', address: 'Westport' })}>{isWishlisted(restaurantId) ? 'Remove from wishlist' : 'Save to wishlist'}</button>
    : <button data-restaurant-id={restaurantId} data-restaurant-name="The Cottage" onClick={() => {
        trackRestaurant('restaurant_search_selected', restaurantId, 'The Cottage');
        navigate(`/restaurant/${restaurantId}`);
      }}>The Cottage</button>;
}
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/search/main']}><AnalyticsTracker /><ListsProvider><Flow /></ListsProvider></MemoryRouter>));
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
    // This is the real provider action used by the detail-page button.
    // Both the wishlist and analytics must be sent without advancing the 10s timer.
    expect(host.querySelector('button')!.textContent).toBe('Remove from wishlist');
    expect(saveWishlistData).toHaveBeenCalledWith('regular-user', expect.arrayContaining([expect.objectContaining({ restaurantId })]));
    expect(events()).toContainEqual(expect.objectContaining({ event: 'restaurant_saved', restaurant_id: restaurantId }));
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
    await act(async () => root.render(<MemoryRouter initialEntries={[`/restaurant/${restaurantId}`]}><AnalyticsTracker /><ListsProvider><Flow /></ListsProvider></MemoryRouter>));
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
