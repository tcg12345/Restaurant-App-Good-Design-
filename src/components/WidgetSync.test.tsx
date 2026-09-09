// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: { id: 'alice' }, profile: { user_id: 'alice' },
  sync: vi.fn().mockResolvedValue(undefined), owner: vi.fn().mockResolvedValue(undefined),
  listeners: new Set<(state: { isActive: boolean }) => void>(),
  lists: { ratings: [], wishlist: [], cloudLoaded: false },
  taste: { standing: { tier: { name: 'Newcomer' }, next: { name: 'Regular' }, progress: 0, toNext: 50 }, points: { total: 0 }, stats: { ratingCount: 0, cuisineCount: 0, cityCount: 0 }, insights: { palate: { archetype: null } }, benchmarks: null, benchmarksLoading: true },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user, profile: state.profile, loading: false, pendingRequestCount: 1 }) }));
vi.mock('../contexts/CalendarContext', () => ({ useCalendar: () => ({ plans: [], loading: true }) }));
vi.mock('../contexts/ListsContext', () => ({ useLists: () => state.lists }));
vi.mock('../contexts/ChatContext', () => ({ useChat: () => ({ unreadCount: 2, loading: true }) }));
vi.mock('../lib/useTasteProfile', () => ({ useTasteProfile: () => state.taste }));
vi.mock('../lib/native-widgets', () => ({ supportsWidgets: () => true, setWidgetOwner: state.owner, syncWidgets: state.sync }));
vi.mock('@capacitor/app', () => ({ App: {
  addListener: vi.fn(async (event, listener) => {
    if (event === 'appStateChange') state.listeners.add(listener);
    return { remove: () => { state.listeners.delete(listener); } };
  }), getLaunchUrl: vi.fn().mockResolvedValue(undefined),
} }));
import { WidgetSync } from './WidgetSync';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); state.listeners.clear(); state.profile.user_id = 'alice'; });
describe('widget sync readiness', () => {
  it('publishes cached account data while network providers are still loading', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<MemoryRouter><WidgetSync /></MemoryRouter>); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(state.owner).toHaveBeenCalledWith('alice');
    expect(state.sync).toHaveBeenCalledWith(expect.objectContaining({ owner: 'alice', social: { messages: 2, requests: 1 } }));
    await act(async () => root.unmount()); host.remove();
  });
  it('flushes a pending edit when the app backgrounds before the debounce fires', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<MemoryRouter><WidgetSync /></MemoryRouter>); });
    expect(state.sync).not.toHaveBeenCalled();
    await act(async () => { state.listeners.forEach(listener => listener({ isActive: false })); });
    expect(state.sync).toHaveBeenCalledWith(expect.objectContaining({ owner: 'alice' }));
    await act(async () => root.unmount()); host.remove();
  });
  it('never flushes data from a profile belonging to another account', async () => {
    vi.useFakeTimers(); state.profile.user_id = 'bob';
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<MemoryRouter><WidgetSync /></MemoryRouter>); });
    await act(async () => { state.listeners.forEach(listener => listener({ isActive: false })); vi.advanceTimersByTime(500); });
    expect(state.sync).not.toHaveBeenCalled();
    await act(async () => root.unmount()); host.remove();
  });
});
