import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20260911143112_audit_restore_app_data_privacy.sql', import.meta.url), 'utf8');
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table user_app_data(user_id uuid primary key, restaurant_meta jsonb);
    alter table user_app_data enable row level security;
    grant all on user_app_data to anon,authenticated,service_role;
    create policy "Anyone can read app data" on user_app_data for select using(true);
    create policy "Users can read own data" on user_app_data for select using(auth.uid()=user_id);
    create policy own_update on user_app_data for update using(auth.uid()=user_id);
    insert into user_app_data values('${a}','{"private":"fixture-a"}'),('${b}','{"private":"fixture-b"}');
    set role anon;`);
  // Reproduce only with fictional rows: the broad policy overrides ownership.
  expect((await db.query('select * from user_app_data')).rows).toHaveLength(2);
  await db.exec('reset role');
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });

it('denies anonymous reads and limits authenticated reads and writes to the owner', async () => {
  await db.exec('set role anon');
  expect((await db.query('select * from user_app_data')).rows).toEqual([]);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${a}',false); set role authenticated;`);
  expect((await db.query('select user_id from user_app_data')).rows).toEqual([{user_id:a}]);
  expect((await db.query('update user_app_data set restaurant_meta=\'{}\' where user_id=$1 returning user_id',[b])).rows).toEqual([]);
  expect((await db.query('update user_app_data set restaurant_meta=\'{}\' where user_id=$1 returning user_id',[a])).rows).toEqual([{user_id:a}]);
  await db.exec('reset role');
});

it('preserves server reads and remains safe after reapplication', async () => {
  await db.exec(migration);
  await db.exec('set role service_role');
  expect((await db.query('select * from user_app_data')).rows).toHaveLength(2);
  await db.exec('reset role; set role anon');
  expect((await db.query('select * from user_app_data')).rows).toEqual([]);
  await db.exec('reset role');
});
