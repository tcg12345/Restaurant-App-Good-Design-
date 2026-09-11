import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import functions from './__fixtures__/security-hardening-functions.json';

const migration = readFileSync(new URL('../../supabase/migrations/20260911012044_audit_function_paths_and_rate_limit_access.sql', import.meta.url), 'utf8');
const user = '00000000-0000-0000-0000-000000000001';
let db: PGlite;
let legacyRowCount: number;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table public.rate_limits(user_id uuid, endpoint text, request_count int, window_start timestamptz);
    create table public.profiles(id uuid,username text,name text,avatar_url text,is_public boolean);
    create table public.friends(user1_id uuid,user2_id uuid);
    create table public.restaurants(user_id uuid,rating numeric,is_wishlist boolean);
    create table public.restaurant_cuisine(restaurant_id text,cuisine text,source text,confidence int,updated_at timestamptz);
    create table public.restaurant_cuisine_tags(restaurant_id text,cuisine text,source text);
    grant all on public.restaurant_cuisine to authenticated,service_role;
    insert into public.rate_limits values ('${user}','protected_endpoint',5,now());`);
  for (const fn of functions) await db.exec(fn.definition);
  // Reproduce against the exact deployed legacy definition using fictional rows.
  await db.exec(`set role anon; select public.check_rate_limit('${user}','arbitrary',10,-1); reset role;`);
  legacyRowCount = Number((await db.query<{ n: number }>("select count(*) n from public.rate_limits where endpoint='protected_endpoint'")).rows[0].n);
  await db.exec(migration);
  await db.exec(`truncate public.rate_limits;
    insert into public.rate_limits values ('${user}','protected_endpoint',5,now());
    create trigger guard_cuisine before insert or update on public.restaurant_cuisine for each row execute function public.guard_restaurant_cuisine();`);
}, 30000);
afterAll(async () => { await db?.close(); });

it('closes the reproduced public rate-limit deletion while retaining server calls', async () => {
  expect(legacyRowCount).toBe(0);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await expect(db.query(`select public.check_rate_limit('${user}','arbitrary',10,-1)`)).rejects.toThrow('permission denied');
    await db.exec('reset role');
  }
  expect(Number((await db.query<{ n: number }>("select count(*) n from public.rate_limits where endpoint='protected_endpoint'")).rows[0].n)).toBe(1);
  await db.exec('set role service_role');
  expect((await db.query<{ allowed: boolean }>(`select public.check_rate_limit('${user}','server_endpoint',10,60) allowed`)).rows[0].allowed).toBe(true);
  await db.exec('reset role');
});
it('pins every reviewed function without dropping or replacing it and is repeatable', async () => {
  await db.exec(migration);
  const rows = (await db.query<{ proname: string; proconfig: string[] }>("select proname,proconfig from pg_proc where pronamespace='public'::regnamespace")).rows;
  for (const fn of functions) expect(rows.find(row => row.proname === fn.signature.split('(')[0])?.proconfig).toContain('search_path=""');
});
it('preserves helper results under an attacker-controlled search path', async () => {
  await db.exec(`create schema attacker;
    create function attacker.lower(text) returns text language sql as 'select ''injected''';
    create function attacker.date_trunc(text,timestamp without time zone) returns timestamp without time zone language sql as 'select timestamp ''1900-01-01''';
    set search_path=attacker,pg_catalog,public;`);
  try {
    const result = (await db.query<{ normalized: string; confidence: number; cap: number; removable: boolean; started: string }>(`select public.normalize_text(' ABC ') normalized, public.cuisine_source_confidence('approved') confidence,
      public.cuisine_max_count() cap, public.cuisine_source_is_removable('approved') removable,
      (public.ai_window_start('day','2026-09-10T12:30:00Z') AT TIME ZONE 'UTC')::text started`)).rows[0];
    expect(result).toMatchObject({ normalized: 'abc', confidence: 100, cap: 3, removable: true });
    expect(result.started).toContain('2026-09-10 00:00:00');
  } finally { await db.exec('reset search_path'); }
});
it('keeps cuisine trigger validation and server-approved writes working', async () => {
  await db.exec(`set role authenticated;
    insert into public.restaurant_cuisine values ('fictional-cafe',' Italian ','google',0,now());
    insert into public.restaurant_cuisine values ('forged-approval','French','approved',100,now());
    reset role;
    set role service_role;
    insert into public.restaurant_cuisine values ('server-approved','French','approved',0,now());
    reset role;`);
  const rows = (await db.query('select restaurant_id,cuisine,confidence from public.restaurant_cuisine order by restaurant_id')).rows;
  expect(rows).toEqual([{ restaurant_id: 'fictional-cafe', cuisine: 'Italian', confidence: 60 }, { restaurant_id: 'server-approved', cuisine: 'French', confidence: 100 }]);
});
