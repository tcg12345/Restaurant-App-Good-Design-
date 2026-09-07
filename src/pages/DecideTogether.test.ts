// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetainedRouteStack } from '../components/RetainedRouteStack';
import type { GroupRoom } from '../lib/group-swipe';

const mocks = vi.hoisted(() => ({ action: vi.fn(), summary: vi.fn(), keys: new Set<string>() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'host' } }) }));
vi.mock('../contexts/SignInModalContext', () => ({ useSignInModal: () => ({ requireSignIn: vi.fn() }) }));
vi.mock('../contexts/HomeLocationContext', () => ({ useHomeLocation: () => ({ location: { label: 'Test city', lat: 40, lng: -74 }, setLocation: vi.fn() }) }));
vi.mock('../lib/haptics', () => ({ homeHaptic: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
vi.mock('../lib/group-swipe', async original => ({ ...await original<object>(), groupAction: mocks.action, groupPlaceSummary: mocks.summary }));
vi.mock('../lib/useMichelinMatch', () => ({ useMichelinMatch: () => ({ michelin: { stars: 2, bibGourmand: false, selected: false, greenStar: true } }) }));
vi.mock('../components/RestaurantPanel', () => ({ RestaurantPanel: ({ snapshot, onClose, headSlot }: any) => snapshot ? React.createElement('div', { role: 'dialog', 'aria-label': snapshot.name }, headSlot, React.createElement('button', { onClick: onClose }, 'Close preview')) : null }));
vi.mock('../components/HomeLocationBar', () => ({ HomeLocationBar: () => null }));
vi.mock('../components/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../components/GroupDiscovery', () => ({ GroupDiscovery: () => null }));
vi.mock('../components/GroupPairwise', () => ({ GroupPairwise: () => null }));
vi.mock('../components/GroupCuisinePicker', () => ({ GroupCuisinePicker: () => null }));
vi.mock('motion/react', async () => {
  const { createElement } = await import('react');
  const elements = new Map();
  return {
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: any) => children,
    motion: new Proxy({}, { get: (_, tag: string) => {
      if (!elements.has(tag)) elements.set(tag, ({ children, initial, animate, exit, transition, custom, variants, whileTap, drag, dragConstraints, dragElastic, onDragEnd, ...props }: any) => createElement(tag, props, children));
      return elements.get(tag);
    } }),
  };
});
import { DecideTogether } from './DecideTogether';

let root: Root;
let container: HTMLDivElement;
let room: GroupRoom;
function HistoryStack() {
  const location = useLocation();
  mocks.keys.add(location.key);
  // Match App's history-keyed route stack: even a same-URL REPLACE remounts.
  return React.createElement(RetainedRouteStack, {
    entryKey: location.key, index: 0, pathname: location.pathname, pop: false, instant: true,
    children: React.createElement(DecideTogether, { key: location.key }),
  });
}
async function mount(url: string) {
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [url] }, React.createElement(HistoryStack))));
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(el => el.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeDefined();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}
const calls = (action: string) => mocks.action.mock.calls.filter(call => call[0] === action).length;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.keys.clear(); mocks.action.mockReset();
  room = { id: 'room-1', code: 'TEST1234', host: 'host', status: 'lobby', round: 1,
    location: { label: 'Test city', lat: 40, lng: -74 }, count: 8, radius: 5000,
    deck: [], results: [], vetoed: [], members: { host: { name: 'Host', ready: false, preferences: {}, votes: {}, vetoUsed: false } } };
  mocks.action.mockImplementation(async (action, payload) => {
    if (action === 'list') return [];
    // Bound the old infinite loop so a regression fails instead of hanging CI.
    if (calls('join') > 5) throw new Error('Repeated room join');
    if (action === 'preferences') room = { ...room, members: { host: { ...room.members.host, ready: true, preferences: payload.preferences } } };
    return structuredClone(room);
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('Decide Together room navigation', () => {
  it('creates once, settles in the lobby, and saves preferences without another navigation', async () => {
    await mount('/decide');
    await click('Create a room'); await click('Create room');
    expect(calls('create')).toBe(1);
    expect(calls('join')).toBe(1); // Resume once after adding the new code to the URL.
    expect(mocks.keys.size).toBe(2);
    expect(container.textContent).toContain('Your mood tonight.');
    await click('I’m ready');
    expect(calls('preferences')).toBe(1);
    expect(calls('join')).toBe(1);
    expect(mocks.keys.size).toBe(2);
    expect(container.textContent).toContain('Everyone’s here.');
  });
  it('opens an invitation once and keeps that history entry while saving mood', async () => {
    await mount('/decide?code=TEST1234&source=invite');
    expect(calls('join')).toBe(1);
    expect(calls('create')).toBe(0);
    expect(mocks.keys.size).toBe(1);
    expect(container.textContent).toContain('Your mood tonight.');
    await click('I’m ready');
    expect(calls('join')).toBe(1);
    expect(mocks.keys.size).toBe(1);
    expect(container.textContent).toContain('Everyone’s here.');
  });
});

it('opens details and AI overviews without voting, navigating or rejoining the live room', async () => {
  room.status = 'swiping'; room.members.host.ready = true;
  room.deck = [{ id: 'restaurant-one', name: 'Test restaurant', cuisine: 'Italian', address: '1 Main Street, New York', photoUrl: null, rating: 4.5, priceLevel: 2, fit: 85, reason: 'Matches your mood', distance: 1000 }];
  mocks.summary.mockResolvedValue({ summary: 'Italian cooking in a relaxed dining room.' });
  await mount('/decide?code=TEST1234');
  expect(container.textContent).toContain('1 Main Street, New York');
  expect(container.querySelector('[aria-label="2 Michelin Stars, Michelin Green Star"]')).toBeTruthy();
  await click('Restaurant details');
  expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  expect(calls('vote')).toBe(0); expect(calls('join')).toBe(1); expect(mocks.keys.size).toBe(1);
  await click('Close preview');
  await click('AI overview');
  expect(container.textContent).toContain('Italian cooking in a relaxed dining room.');
  expect(mocks.summary).toHaveBeenCalledWith('room-1', 'restaurant-one');
  await click('Restaurant details'); await click('AI overview');
  expect(mocks.summary).toHaveBeenCalledTimes(1);
  await click('Close preview');
  expect(container.querySelector('.gs-swipe-card')?.textContent).toContain('Test restaurant');
  expect(calls('vote')).toBe(0); expect(mocks.keys.size).toBe(1);
});
it('creates a custom room with the chosen guest policy and skips the mood/generation flow', async () => {
  room.source='custom';room.allowGuestAdds=true;room.shortlistVersion=0;room.count=0;
  await mount('/decide');await click('Create a room');
  await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Choose our own places"]')!.click());
  expect(container.querySelector('#gs-count')).toBeNull();
  const everyone=Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.textContent?.includes('Everyone can suggest'))!;
  await act(async()=>everyone.click());await click('Create room');
  const create=mocks.action.mock.calls.find(([action])=>action==='create');
  expect(create?.[1]).toMatchObject({source:'custom',allowGuestAdds:true});
  expect(container.textContent).toContain('YOUR OWN SHORTLIST');
  expect(container.textContent).not.toContain('Your mood tonight.');
  expect(calls('generate')).toBe(0);
});
