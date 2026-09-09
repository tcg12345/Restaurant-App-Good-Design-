import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000003';
const conversation = '20000000-0000-4000-8000-000000000001';
let db: PGlite;
const topic = (id: string) => `chat-activity:${conversation}:${id}`;
async function asUser(id: string, channel: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('realtime.topic',$2,false)", [id, channel]);
  await db.exec('set role authenticated');
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema realtime;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
    create table public.conversations(id uuid primary key, participant_ids uuid[]);
    insert into public.conversations values('${conversation}',array['${alice}','${bob}']::uuid[]);
    alter table public.conversations enable row level security;
    create policy participants on public.conversations for select to authenticated using (auth.uid()=any(participant_ids));
    create table realtime.messages(extension text);
    insert into realtime.messages values ('broadcast');
    alter table realtime.messages enable row level security;
    grant usage on schema auth, realtime to authenticated, anon;
    grant select on public.conversations to authenticated;
    grant select, insert on realtime.messages to authenticated, anon;
    create publication supabase_realtime;`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260909164751_live_chat_activity.sql', import.meta.url), 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });
it('lets a member receive a peer’s activity but only publish as themselves', async () => {
  await asUser(bob, topic(alice));
  expect((await db.query('select * from realtime.messages')).rows).toHaveLength(1);
  await expect(db.query("insert into realtime.messages values ('broadcast')")).rejects.toThrow('row-level security');
  await asUser(alice, topic(alice));
  await expect(db.query("insert into realtime.messages values ('broadcast')")).resolves.toBeDefined();
});
it('rejects outsiders, forged sender topics, malformed topics and unrelated event types', async () => {
  for (const [id, channel] of [[outsider, topic(alice)], [alice, topic(outsider)], [alice, `${topic(alice)}:extra`], [alice, 'typing-one']]) {
    await asUser(id, channel);
    expect((await db.query('select * from realtime.messages')).rows).toHaveLength(0);
    await expect(db.query("insert into realtime.messages values ('broadcast')")).rejects.toThrow('row-level security');
  }
  await asUser(alice, topic(alice));
  await expect(db.query("insert into realtime.messages values ('presence')")).rejects.toThrow('row-level security');
  await db.exec('reset role; set role anon');
  expect((await db.query('select * from realtime.messages')).rows).toHaveLength(0);
  await expect(db.query("insert into realtime.messages values ('broadcast')")).rejects.toThrow('row-level security');
});
it('includes conversation lifecycle events in the realtime publication', async () => {
  await db.exec('reset role');
  expect((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows).toEqual([{ tablename: 'conversations' }]);
});
