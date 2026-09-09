// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatActivity, ACTIVITY_EXPIRY_MS } from './useChatActivity';

const network = vi.hoisted(() => ({ channels: [] as any[], sent: [] as any[] }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../lib/supabase', () => ({ supabaseConfigured: true, supabase: {
  channel: (topic: string, options: unknown) => {
    const ch: any = { topic, options, callback: undefined, subscribed: false,
      on: (_kind: string, _filter: unknown, callback: Function) => { ch.callback = callback; return ch; },
      subscribe: (status: Function) => { ch.status = status; return ch; },
      send: async (event: any) => {
        network.sent.push({ topic, ...event });
        for (const peer of network.channels) if (peer !== ch && peer.topic === topic && peer.subscribed) peer.callback?.(event);
        return 'ok';
      },
    };
    network.channels.push(ch); return ch;
  },
  removeChannel: async (ch: any) => { ch.subscribed = false; network.channels = network.channels.filter((c) => c !== ch); },
} }));
let root: Root, host: HTMLDivElement;
let alice: ReturnType<typeof useChatActivity>, bob: ReturnType<typeof useChatActivity>;
function Pair({ sending = false, conversation = 'one', showAlice = true }) {
  return <>{showAlice && <Person id="alice" sending={sending} conversation={conversation} />}<Person id="bob" sending={false} conversation={conversation} /></>;
}
function Person({ id, sending, conversation }: { id: string; sending: boolean; conversation: string }) {
  const activity = useChatActivity(conversation, id, ['alice', 'bob'], sending);
  if (id === 'alice') alice = activity; else bob = activity;
  return <div>{id}:{JSON.stringify(activity.peers)}</div>;
}
async function render(props = {}) { await act(async () => root.render(<Pair {...props} />)); }
async function connect() { await act(async () => { for (const ch of network.channels) { ch.subscribed = true; ch.status('SUBSCRIBED'); } }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); network.channels = []; network.sent = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
it('delivers typing and sending between participants, then clears on send completion', async () => {
  await render(); await connect();
  await act(async () => alice.notifyTyping(true));
  expect(bob.peers).toEqual({ alice: 'typing' }); expect(alice.peers).toEqual({});
  await render({ sending: true }); expect(bob.peers).toEqual({ alice: 'sending' });
  await render(); expect(bob.peers).toEqual({});
  expect(network.channels.every((ch) => ch.options.config.private)).toBe(true);
  expect(network.sent.every((event) => Object.keys(event.payload).join() === 'state')).toBe(true);
});
it('waits for channel authorization, throttles typing, and clears abandoned drafts', async () => {
  await render(); await act(async () => alice.notifyTyping(true)); expect(network.sent).toHaveLength(0);
  await connect(); expect(bob.peers).toEqual({}); // receiver had not joined yet
  await act(async () => vi.advanceTimersByTime(1500)); expect(bob.peers).toEqual({ alice: 'typing' });
  const sent = network.sent.length;
  await act(async () => { for (let i = 0; i < 20; i++) alice.notifyTyping(true); });
  expect(network.sent).toHaveLength(sent);
  await act(async () => vi.advanceTimersByTime(2200)); expect(bob.peers).toEqual({});
});
it('clears immediately on empty input, blur, and leaving a conversation', async () => {
  await render(); await connect();
  await act(async () => alice.notifyTyping(true));
  await act(async () => alice.notifyTyping(false)); expect(bob.peers).toEqual({});
  await act(async () => alice.notifyTyping(true));
  await act(async () => alice.stopTyping()); expect(bob.peers).toEqual({});
  await act(async () => alice.notifyTyping(true));
  await render({ showAlice: false }); expect(bob.peers).toEqual({});
  await render({ conversation: 'two' }); expect(bob.peers).toEqual({});
  expect(network.channels.every((ch) => ch.topic.includes(':two:'))).toBe(true);
});
it('expires a sender who disconnects and clears on backgrounding', async () => {
  await render(); await connect(); await render({ sending: true });
  expect(bob.peers).toEqual({ alice: 'sending' });
  await act(async () => network.channels.find((ch) => ch.topic.endsWith(':alice') && !ch.callback).status('CHANNEL_ERROR'));
  await act(async () => vi.advanceTimersByTime(ACTIVITY_EXPIRY_MS)); expect(bob.peers).toEqual({});
  await connect(); await act(async () => vi.advanceTimersByTime(1500));
  await act(async () => window.dispatchEvent(new Event('offline'))); expect(bob.peers).toEqual({});
});
