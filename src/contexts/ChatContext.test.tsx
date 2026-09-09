// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatProvider, useChat } from './ChatContext';
const mock = vi.hoisted(() => ({ uid: 'alice', rows: {} as Record<string, any[]>, channels: [] as any[], holdMessages: false, deferred: [] as (() => void)[], holdInsert: false, insertError: null as any, inserts: [] as (() => void)[] }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mock.uid ? { id: mock.uid } : null }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../lib/supabase', () => ({ supabaseConfigured: true, supabase: {
  from: (table: string) => {
    let equal: [string, unknown] | undefined;
    let inserted: any;
    const query: any = {
      select: () => query, contains: () => query, order: () => query, in: () => query,
      eq: (field: string, value: unknown) => { equal = [field, value]; return query; },
      insert: (value: unknown) => { inserted = value; return query; },
      upsert: async () => ({ error: null }),
      single: async () => {
        if (mock.holdInsert) await new Promise<void>((resolve) => mock.inserts.push(resolve));
        return { data: { created_at: '2026-09-09T12:01:00Z' }, error: mock.insertError };
      },
      maybeSingle: async () => ({ data: mock.rows[table].find((row) => row[equal![0]] === equal![1]), error: null }),
      then: (resolve: Function, reject: Function) => {
        const data = (mock.rows[table] || []).filter((row) => !equal || row[equal[0]] === equal[1]).map((row) => ({ ...row }));
        const result = { data, error: null };
        const pending = table === 'messages' && !inserted && mock.holdMessages
          ? new Promise((done) => mock.deferred.push(() => done(result))) : Promise.resolve(result);
        return pending.then(resolve as any, reject as any);
      },
    }; return query;
  },
  rpc: async () => ({ error: null }),
  channel: () => {
    const ch: any = { handlers: [] as any[], on: (_: unknown, filter: any, callback: Function) => { ch.handlers.push({ filter, callback }); return ch; }, subscribe: (status: Function) => { ch.status = status; return ch; } };
    mock.channels.push(ch); return ch;
  }, removeChannel: async () => {},
} }));
const conversation = (id = 'one') => ({ id, participant_ids: ['alice', 'bob'], is_group: false, name: null, created_at: '2026-09-09T12:00:00Z', last_message_at: '2026-09-09T12:00:00Z', hidden_by: [] });
const message = (id: string, conv = 'one') => ({ id, conversation_id: conv, sender_id: 'bob', text: id, created_at: '2026-09-09T12:01:00Z', shared_payload: null });
let root: Root, host: HTMLDivElement, chat: ReturnType<typeof useChat>;
function Probe() { chat = useChat(); return null; }
async function render() { await act(async () => root.render(<ChatProvider><Probe /></ChatProvider>)); }
async function event(table: string, value: any, channel = mock.channels.at(-1), kind = 'INSERT') {
  await act(async () => channel.handlers.filter((h: any) => h.filter.table === table && h.filter.event === kind).forEach((h: any) => h.callback({ new: value })));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); mock.uid = 'alice'; mock.rows = { conversations: [conversation()], messages: [], conversation_reads: [] }; mock.channels = []; mock.holdMessages = false; mock.deferred = []; mock.holdInsert = false; mock.insertError = null; mock.inserts = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('updates an open thread live and deduplicates a sender’s optimistic echo', async () => {
  await render(); await event('messages', message('incoming'));
  expect(chat.conversations[0].messages.map((m) => m.id)).toEqual(['incoming']);
  mock.holdInsert = true;
  await act(async () => chat.sendMessage('one', 'hello'));
  const outgoing = chat.conversations[0].messages.find((m) => m.text === 'hello')!;
  expect(outgoing.status).toBe('sending');
  await event('messages', { ...message(outgoing.id), sender_id: 'alice', text: 'hello' });
  expect(chat.conversations[0].messages).toHaveLength(2);
  expect(chat.conversations[0].messages.find((m) => m.id === outgoing.id)?.status).toBe('sent');
  await act(async () => mock.inserts.splice(0).forEach((done) => done()));
});
it('catches up on reconnect without losing a live arrival during the history request', async () => {
  await render(); await act(async () => mock.channels[0].status('CHANNEL_ERROR'));
  expect(chat.connectionState).toBe('reconnecting');
  mock.rows.messages = [message('missed')]; mock.holdMessages = true;
  await act(async () => mock.channels[0].status('SUBSCRIBED'));
  await event('messages', message('arrived-during-query'));
  mock.holdMessages = false;
  await act(async () => mock.deferred.splice(0).forEach((done) => done()));
  expect(chat.conversations[0].messages.map((m) => m.id).sort()).toEqual(['arrived-during-query', 'missed']);
  expect(chat.connectionState).toBe('connected');
});
it('buffers every incoming message while discovering a new conversation', async () => {
  await render(); mock.rows.conversations.push(conversation('two')); mock.holdMessages = true;
  await event('messages', message('first', 'two'));
  await event('messages', message('second', 'two'));
  mock.holdMessages = false;
  await act(async () => mock.deferred.splice(0).forEach((done) => done()));
  expect(chat.conversations.find((c) => c.id === 'two')?.messages.map((m) => m.id)).toEqual(['first', 'second']);
});
it('ignores late history and realtime callbacks after the account changes', async () => {
  mock.holdMessages = true; await render(); const old = mock.channels[0];
  mock.uid = ''; await render(); mock.holdMessages = false;
  await act(async () => mock.deferred.splice(0).forEach((done) => done()));
  await event('messages', message('late'), old);
  expect(chat.conversations).toEqual([]);
});
it('catches up when the app returns to the foreground', async () => {
  await render(); mock.rows.messages = [message('background')];
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(chat.conversations[0].messages[0].id).toBe('background');
});

it('does not turn a confirmed message into a failure when the HTTP response is lost', async () => {
  await render(); mock.holdInsert = true;
  await act(async () => chat.sendMessage('one', 'hello'));
  const outgoing = chat.conversations[0].messages[0];
  await event('messages', { ...message(outgoing.id), sender_id: 'alice', text: 'hello' });
  mock.insertError = { message: 'connection lost' };
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await act(async () => mock.inserts.splice(0).forEach((done) => done()));
  expect(chat.conversations[0].messages[0].status).toBe('sent');
  warning.mockRestore();
});
