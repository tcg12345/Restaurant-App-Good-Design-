import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
const owner = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';
let db: PGlite;
async function asUser(id = owner) { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`); }
async function insert(user = owner) { return db.query<{ id: string }>("insert into calendar_plans(user_id,kind,title,starts_at,ends_at,details) values($1,'restaurant','Dinner','2026-09-08T19:00:00Z','2026-09-08T21:00:00Z','{}') returning id", [user]); }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260908142249_calendar_plans.sql', import.meta.url), 'utf8'));
}, 30000);
beforeEach(async () => { await db.exec('reset role; truncate calendar_plans;'); await asUser(); });
afterAll(async () => { await db?.close(); });
it('allows owner CRUD and blocks reads/edits/deletes by another account', async () => {
  const id = (await insert()).rows[0].id;
  expect((await db.query('select * from calendar_plans')).rows).toHaveLength(1);
  await asUser(other);
  expect((await db.query('select * from calendar_plans')).rows).toHaveLength(0);
  expect((await db.query("update calendar_plans set title='changed' returning id")).rows).toHaveLength(0);
  expect((await db.query('delete from calendar_plans returning id')).rows).toHaveLength(0);
  await asUser();
  await db.query("update calendar_plans set title='Lunch' where id=$1", [id]);
  expect((await db.query<{ title: string }>('select title from calendar_plans')).rows[0].title).toBe('Lunch');
  expect((await db.query('delete from calendar_plans returning id')).rows).toHaveLength(1);
});
it('rejects forged owners, ownership transfers, anonymous access and invalid time ranges', async () => {
  await expect(insert(other)).rejects.toThrow('row-level security');
  await insert();
  await expect(db.query('update calendar_plans set user_id=$1', [other])).rejects.toThrow('row-level security');
  await expect(db.query('update calendar_plans set ends_at=starts_at')).rejects.toThrow('check constraint');
  await db.exec('reset role; set role anon;');
  await expect(db.query('select * from calendar_plans')).rejects.toThrow('permission denied');
  await expect(insert()).rejects.toThrow('permission denied');
});
it('enforces server timestamps and cascades deletion when the account is removed', async () => {
  await insert();
  await db.query("update calendar_plans set updated_at='2000-01-01', created_at='2000-01-01'");
  expect((await db.query<{ good: boolean }>("select updated_at>now()-interval '1 minute' and created_at>now()-interval '1 minute' as good from calendar_plans")).rows[0].good).toBe(true);
  await db.exec(`reset role; delete from auth.users where id='${owner}';`);
  expect((await db.query('select * from calendar_plans')).rows).toHaveLength(0);
});
