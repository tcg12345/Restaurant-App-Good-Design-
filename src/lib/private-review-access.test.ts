import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import functions from './__fixtures__/private-review-functions.json';

const migration = readFileSync(new URL('../../supabase/migrations/20260911135801_audit_private_review_reader_access.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const friend = '00000000-0000-0000-0000-000000000002';
const stranger = '00000000-0000-0000-0000-000000000003';
const publicAuthor = '00000000-0000-0000-0000-000000000004';
const targets = functions.filter(f => !['taste_city_of', 'get_taste_leaderboard', 'get_taste_my_ranks'].includes(f.signature.split('(')[0]));
let db: PGlite;
let exposed: { friendStats: number; friendNotes: string; restaurantNotes: string; communityPhotos: unknown; privateStats: number };
let leaderboardBefore: unknown[];
let myRanksBefore: unknown[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid,username text,avatar_url text,is_public boolean);
    create table friends(user1_id uuid,user2_id uuid);
    create table restaurants(id uuid,user_id uuid,name text,rating numeric,is_wishlist boolean,google_place_id text,
      notes text,category_ratings jsonb,photos text[],photo_captions text[],photo_dish_names text[],created_at timestamptz);
    create table user_reviews(id uuid,user_id uuid,restaurant_name text,restaurant_place_id text,overall_rating numeric,
      category_ratings jsonb,review_text text,photos text[],photo_captions text[],photo_dish_names text[],created_at timestamptz,helpful_count integer);
    create table review_helpfulness(review_id uuid,user_id uuid,is_helpful boolean);
    create table user_profiles(user_id uuid,is_public boolean);
    create table community_ratings(user_id uuid,score numeric,cuisine text,address text,notes text,tags text[],price text,created_at timestamptz,rating_method text);
    create table community_photos(user_id uuid);
    alter table restaurants enable row level security;
    alter table community_ratings enable row level security;
    grant select on restaurants,community_ratings to anon,authenticated;
    create function public.can_view_author(target uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.user_profiles p where p.user_id=target and (p.is_public or p.user_id=auth.uid()))
    $$;
    insert into profiles values ('${friend}','private-fixture','',false);
    insert into friends values ('${owner}','${friend}');
    insert into restaurants values ('00000000-0000-0000-0000-000000000010','${friend}','Fictional cafe',8,false,'fixture-place',
      'private fixture note','{}',array['fixture-private-photo'],array['private fixture caption'],array['fixture dish'],now());
    insert into user_profiles values ('${owner}',false),('${stranger}',false),('${publicAuthor}',true);
    insert into community_ratings
      select u.id,8,'French','1 Test St, Test City','private fixture note',array['fixture'],'$$$$',now(),'h2h'
      from (values('${owner}'::uuid),('${stranger}'::uuid),('${publicAuthor}'::uuid)) u(id) cross join generate_series(1,10);
  `);
  // Use exact deployed definitions, creating scalar dependencies before SQL bodies.
  for (const name of ['taste_city_of', 'taste_user_stats_impl']) {
    await db.exec(functions.find(f => f.signature.startsWith(`${name}(`))!.definition);
  }
  for (const fn of functions.filter(f => !['taste_city_of', 'taste_user_stats_impl'].includes(f.signature.split('(')[0]))) await db.exec(fn.definition);
  await db.exec('grant execute on all functions in schema public to anon,authenticated,service_role; set role anon;');
  expect((await db.query('select * from restaurants')).rows).toHaveLength(0);
  expect((await db.query('select * from community_ratings')).rows).toHaveLength(0);
  const friendStats = Number((await db.query<{ total_reviews: number }>(`select total_reviews from get_friend_rating_stats('fixture-place','${owner}'::uuid)`)).rows[0].total_reviews);
  const friendNotes = (await db.query<{ review_text: string }>(`select review_text from get_friend_reviews_for_place('fixture-place',20,0,'${owner}'::uuid)`)).rows[0].review_text;
  const restaurantNotes = (await db.query<{ review_text: string }>("select review_text from get_restaurant_reviews('fixture-place',10,0,'recent',null::uuid)")).rows[0].review_text;
  const communityPhotos = (await db.query<{ recent_photos: unknown }>("select recent_photos from get_restaurant_community_stats('fixture-place','Fictional cafe',null::uuid)")).rows[0].recent_photos;
  const privateStats = (await db.query(`select * from taste_user_stats_impl() where user_id='${owner}'`)).rows.length;
  exposed = { friendStats, friendNotes, restaurantNotes, communityPhotos, privateStats };
  leaderboardBefore = (await db.query('select * from get_taste_leaderboard(25,\'points\')')).rows;
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${stranger}',false); set role authenticated;`);
  myRanksBefore = (await db.query('select * from get_taste_my_ranks()')).rows;
  await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);");
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });

it('reproduces private legacy review and current statistics disclosure on fictional data', () => {
  expect(exposed).toMatchObject({ friendStats: 1, friendNotes: 'private fixture note', restaurantNotes: 'private fixture note', privateStats: 1 });
  expect(JSON.stringify(exposed.communityPhotos)).toContain('fixture-private-photo');
});

it('blocks all nine overloads for anonymous and signed-in clients, retaining server access', async () => {
  expect(targets).toHaveLength(9);
  for (const fn of targets) {
    const row = (await db.query("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [fn.signature])).rows[0];
    expect(row, fn.signature).toEqual({anon:false,authenticated:false,service:true});
  }
  // The legacy one-argument community-stats call is ambiguous because other
  // overloads have defaults. Its exact signature is covered by the ACL check.
  const calls = [
    `get_friend_rating_stats('fixture-place','${owner}'::uuid)`,
    `get_friend_rating_stats('fixture-place','Fictional cafe','${owner}'::uuid)`,
    `get_friend_reviews_for_place('fixture-place',20,0,'${owner}'::uuid)`,
    `get_friend_reviews_for_place('fixture-place',20,0,'Fictional cafe','${owner}'::uuid)`,
    "get_restaurant_community_stats('fixture-place',null::uuid)",
    "get_restaurant_community_stats('fixture-place','Fictional cafe',null::uuid)",
    "get_restaurant_reviews('fixture-place',10,0,'recent',null::uuid)",
    'taste_user_stats_impl()',
  ];
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try { for (const call of calls) await expect(db.query(`select * from ${call}`)).rejects.toThrow('permission denied'); }
    finally { await db.exec('reset role'); }
  }
});

it('preserves the active leaderboard filter and personal ranks through their definer wrappers', async () => {
  await db.exec('set role anon');
  try {
    expect((await db.query("select * from get_taste_leaderboard(25,'points')")).rows).toEqual(leaderboardBefore);
    expect(leaderboardBefore).toHaveLength(1);
    expect(leaderboardBefore[0]).toMatchObject({user_id:publicAuthor});
  } finally { await db.exec('reset role'); }
  await db.exec(`select set_config('request.jwt.claim.sub','${stranger}',false); set role authenticated;`);
  try { expect((await db.query('select * from get_taste_my_ranks()')).rows).toEqual(myRanksBefore); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);"); }
  expect(myRanksBefore[0]).toMatchObject({ranked_users:3});
});

it('preserves exact function bodies and trusted internal statistics calls', async () => {
  await db.exec('set role service_role');
  try { expect((await db.query('select * from taste_user_stats_impl()')).rows).toHaveLength(3); }
  finally { await db.exec('reset role'); }
  for (const fn of functions) expect((await db.query<{body:string}>('select pg_get_functiondef($1::regprocedure) body',[fn.signature])).rows[0].body).toBe(fn.definition);
});

it('is repeatable and skips absent functions on a clean installation', async () => {
  await db.exec(migration);
  const clean = new PGlite();
  try { await clean.exec('create role anon; create role authenticated; create role service_role;'); await expect(clean.exec(migration)).resolves.toBeDefined(); }
  finally { await clean.close(); }
});
