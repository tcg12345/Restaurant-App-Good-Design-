import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { makeRankingEvent } from './ranking-evidence';
let db: PGlite;
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
const eid = '00000000-0000-4000-8000-000000000003';
const event = makeRankingEvent([], [{ restaurantId: 'A', score: 8 }], { kind: 'rating', source: 'h2h', subjectIds: ['A'] }, 1, eid);
async function asUser(id: string) { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`); }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${a}'),('${b}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260909233047_ranking_preference_events.sql', import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => { await db.exec('reset role; truncate ranking_preference_events;'); });
afterAll(async () => { await db?.close(); });
const insert = (owner: string, payload: unknown = event) => db.query('insert into ranking_preference_events(user_id,id,event) values($1,$2,$3)', [owner, eid, JSON.stringify(payload)]);
it('owners can append/read their events and replay inserts idempotently', async () => {
  await asUser(a); await insert(a);
  await db.query('insert into ranking_preference_events(user_id,id,event) values($1,$2,$3) on conflict(user_id,id) do nothing', [a, eid, JSON.stringify(event)]);
  expect((await db.query('select event from ranking_preference_events')).rows).toEqual([{ event }]);
});
it('blocks cross-account reads/inserts and all client mutation/deletion of history', async () => {
  await asUser(a); await insert(a); await asUser(b);
  expect((await db.query('select * from ranking_preference_events')).rows).toHaveLength(0);
  await expect(insert(a)).rejects.toThrow('row-level security');
  await asUser(a);
  await expect(db.exec("update ranking_preference_events set event='{}'" )).rejects.toThrow('permission denied');
  await expect(db.exec('delete from ranking_preference_events')).rejects.toThrow('permission denied');
});
it('rejects anonymous access, missing/null fields and mismatched IDs', async () => {
  await db.exec('set role anon');
  await expect(db.exec('select * from ranking_preference_events')).rejects.toThrow('permission denied');
  await expect(insert(a)).rejects.toThrow('permission denied');
  await asUser(a);
  for (const payload of [{}, { ...event, kind: null }, { ...event, id: a }, { ...event, order: null }]) await expect(insert(a, payload)).rejects.toThrow('ranking_event_shape');
});
it('account deletion cascades to its private preference records', async () => {
  await asUser(a); await insert(a); await db.exec(`reset role; delete from auth.users where id='${a}'`);
  expect((await db.query('select * from ranking_preference_events')).rows).toHaveLength(0);
});
