import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import functions from './__fixtures__/legacy-data-functions.json';

const migration = readFileSync(new URL('../../supabase/migrations/20260911122353_audit_retire_legacy_data_rpcs.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const friend = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000003';
let db: PGlite;
let before: { email: boolean; cache: number; forgedProfile: boolean; linked: number };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select '${stranger}'::uuid$$;
    create table profiles(id uuid, username text, name text, avatar_url text, is_public boolean, email text);
    create table friends(id uuid, user1_id uuid, user2_id uuid);
    create table restaurants(id uuid, user_id uuid, name text, cuisine text, rating numeric,
      address text, city text, country text, price_range text, michelin_stars integer,
      date_visited timestamptz, created_at timestamptz, notes text, photos text[],
      latitude numeric, longitude numeric, website text, phone_number text, opening_hours jsonb,
      reservable boolean, reservation_url text, is_wishlist boolean, google_place_id text);
    create table user_reviews(restaurant_place_id text, restaurant_name text);
    create table friend_activity_cache(user_id uuid,friend_id uuid,restaurant_id uuid,activity_data jsonb,activity_date timestamptz);
    create table friend_profile_cache(user_id uuid,restaurant_count bigint,wishlist_count bigint);
    alter table profiles enable row level security;
    alter table restaurants enable row level security;
    alter table friend_activity_cache enable row level security;
    grant select on profiles,restaurants,friend_activity_cache to anon,authenticated;
    insert into profiles values ('${owner}','fixture-owner','Owner','',false,'owner@example.invalid'),
      ('${friend}','fixture-friend','Friend','',false,'friend@example.invalid');
    insert into friends values ('00000000-0000-0000-0000-000000000004','${owner}','${friend}');
    insert into restaurants(id,user_id,name,cuisine,rating,address,city,created_at,notes,is_wishlist,google_place_id)
      values ('00000000-0000-0000-0000-000000000010','${owner}','Fictional cafe','French',8,'1 Test St','Test City',now(),'private fixture note',false,null),
      ('00000000-0000-0000-0000-000000000011','${friend}','Fictional cafe','French',9,'1 Test St','Test City',now(),'friend fixture note',false,'fixture-place');
    insert into friend_activity_cache values ('${owner}','${friend}',null,'{"note":"private fixture activity"}',now());
  `);
  for (const fn of functions) await db.exec(fn.definition);
  // Grant explicitly as well as through PUBLIC: the fix must remove both paths.
  await db.exec('grant execute on all functions in schema public to anon,authenticated; set role anon;');
  expect((await db.query('select * from profiles')).rows).toHaveLength(0);
  const email = (await db.query<{ found: boolean }>("select check_email_exists('owner@example.invalid') found")).rows[0].found;
  const cache = (await db.query(`select * from get_cached_friend_activity('${owner}')`)).rows.length;
  const forgedProfile = (await db.query<{ can_view: boolean }>(`select can_view from get_friend_profile_with_all_data('${owner}','${owner}')`)).rows[0].can_view;
  const linked = (await db.query('select * from link_restaurants_to_google_places()')).rows.length;
  before = { email, cache, forgedProfile, linked };
  await db.exec('reset role');
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });

it('reproduces legacy private reads and cross-account maintenance on fictional data', () => {
  expect(before).toEqual({ email: true, cache: 1, forgedProfile: true, linked: 1 });
});

it('removes explicit and inherited client EXECUTE from every retired overload', async () => {
  for (const fn of functions) {
    const row = (await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      "select has_function_privilege('anon',$1,'EXECUTE') anon, has_function_privilege('authenticated',$1,'EXECUTE') authenticated, has_function_privilege('service_role',$1,'EXECUTE') service", [fn.signature])).rows[0];
    expect(row, fn.signature).toEqual({ anon: false, authenticated: false, service: true });
  }
});

it('rejects real anonymous and signed-in calls before they can reach private data or writes', async () => {
  const calls = [
    "check_email_exists('owner@example.invalid')",
    `get_cached_friend_activity('${owner}')`,
    `get_friend_profile_with_all_data('${owner}','${owner}')`,
    `get_friend_profile_with_pagination('${owner}','${owner}')`,
    `get_friends_recent_activity('${owner}')`,
    `rebuild_friend_activity_cache('${owner}')`,
    'link_all_restaurants_systematically()',
    "link_restaurant_by_place_id('forged-place','Fictional cafe')",
    'link_restaurants_to_google_places()',
  ];
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const call of calls) await expect(db.query(`select * from ${call}`)).rejects.toThrow('permission denied');
    } finally { await db.exec('reset role'); }
  }
});

it('preserves trusted service calls and function definitions', async () => {
  await db.exec('set role service_role');
  try {
    expect((await db.query(`select * from get_cached_friend_activity('${owner}')`)).rows).toHaveLength(1);
    expect((await db.query<{ can_view: boolean }>(`select can_view from get_friend_profile_with_all_data('${owner}','${owner}')`)).rows[0].can_view).toBe(true);
  } finally { await db.exec('reset role'); }
  for (const fn of functions) {
    const definition = (await db.query<{ body: string }>('select pg_get_functiondef($1::regprocedure) body', [fn.signature])).rows[0].body;
    expect(definition).toBe(fn.definition);
  }
});

it('is repeatable and works when the legacy functions are absent on a clean installation', async () => {
  await db.exec(migration);
  const clean = new PGlite();
  try {
    await clean.exec('create role anon; create role authenticated; create role service_role;');
    await expect(clean.exec(migration)).resolves.toBeDefined();
  } finally { await clean.close(); }
});
