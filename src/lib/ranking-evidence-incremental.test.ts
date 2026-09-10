import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { makeRankingEvent } from './ranking-evidence';
let db: PGlite;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const id = (n: number) => `00000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}`;
const event = (n: number) => makeRankingEvent([], [{ restaurantId: 'fictional-A', score: 8 }], { kind: 'rating', source: 'h2h', subjectIds: ['fictional-A'] }, n, id(n));
const insert = (who: string, n: number, suppliedPosition = 999999) => db.query<{sync_position:number}>('insert into public.ranking_preference_events(user_id,id,event,sync_position) values($1,$2,$3,$4) on conflict(user_id,id) do nothing returning sync_position', [who, id(n), JSON.stringify(event(n)), suppliedPosition]);
const asUser = (who: string) => db.exec(`reset role; select set_config('request.jwt.claim.sub','${who}',false); set role authenticated;`);
let backfill: unknown;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260909233047_ranking_preference_events.sql', import.meta.url), 'utf8'));
  await db.query('insert into public.ranking_preference_events(user_id,id,event) values($1,$2,$3)', [owner,id(1),JSON.stringify(event(1))]);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260910192158_audit_ranking_incremental_sync.sql', import.meta.url), 'utf8'));
  backfill = (await db.query('select e.sync_position, c.position, e.event from public.ranking_preference_events e join private.ranking_evidence_clocks c using(user_id)')).rows;
}, 30000);
beforeEach(async () => { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); truncate public.ranking_preference_events, private.ranking_evidence_clocks;"); });
afterAll(async () => { await db.close(); });
it('backfills old events without changing their evidence and aligns the owner clock', () => {
  expect(backfill).toEqual([{ sync_position: 1, position: 1, event: event(1) }]);
});
it('assigns trusted increasing positions per owner, including old clients without the new column', async () => {
  await asUser(owner); expect((await insert(owner,1)).rows[0].sync_position).toBe(1);
  await db.query('insert into public.ranking_preference_events(user_id,id,event) values($1,$2,$3)', [owner,id(2),JSON.stringify(event(2))]);
  await insert(owner,1); // duplicate retries can leave harmless clock gaps
  expect((await insert(owner,3,-100)).rows[0].sync_position).toBe(4);
  expect((await db.query('select sync_position from public.ranking_preference_events where sync_position > 1 order by sync_position')).rows).toEqual([{sync_position:2},{sync_position:4}]);
  await asUser(other); expect((await insert(other,1)).rows[0].sync_position).toBe(1);
});
it('retains private owner-only access and prevents direct counter/trigger manipulation', async () => {
  await asUser(owner); await insert(owner,1); await asUser(other);
  expect((await db.query('select * from public.ranking_preference_events')).rows).toEqual([]);
  await expect(insert(owner,2)).rejects.toThrow('owner does not match session');
  await expect(db.exec('select * from private.ranking_evidence_clocks')).rejects.toThrow('permission denied');
  await expect(db.exec('select private.stamp_ranking_evidence_position()')).rejects.toThrow('permission denied');
  await expect(db.exec('update public.ranking_preference_events set sync_position = 100')).rejects.toThrow('permission denied');
  await db.exec('reset role; set role anon');
  await expect(db.exec('select * from public.ranking_preference_events')).rejects.toThrow('permission denied');
});
it('rolls the clock back with a failed transaction, so no committed cursor hides its later retry', async () => {
  await asUser(owner); await insert(owner,1);
  await db.exec('begin'); expect((await insert(owner,2)).rows[0].sync_position).toBe(2); await db.exec('rollback');
  expect((await db.query('select sync_position from public.ranking_preference_events order by sync_position')).rows).toEqual([{sync_position:1}]);
  expect((await insert(owner,3)).rows[0].sync_position).toBe(2);
});
it('uses the owner/cursor index for a small delta after a large fictional history', async () => {
  const template = JSON.stringify(event(1));
  await db.query(`insert into public.ranking_preference_events(user_id,id,event)
    select $1, md5(n::text)::uuid, jsonb_set($2::jsonb,'{id}',to_jsonb(md5(n::text)::uuid::text)) from generate_series(1,5000) n`, [owner,template]);
  await db.exec('analyze public.ranking_preference_events'); await asUser(owner);
  const query = `select id,event,sync_position from public.ranking_preference_events where user_id='${owner}' and sync_position > 4995 order by sync_position limit 500`;
  const result = await db.query(query); expect(result.rows).toHaveLength(5);
  const plan = await db.query(`explain (analyze, buffers, format json) ${query}`);
  expect(JSON.stringify(plan.rows)).toContain('ranking_evidence_owner_position_idx');
}, 30000);
it('removes private clock state along with a deleted account', async () => {
  await asUser(other); await insert(other,1); await db.exec(`reset role; delete from auth.users where id='${other}'`);
  expect((await db.query('select * from private.ranking_evidence_clocks')).rows).toEqual([]);
});
