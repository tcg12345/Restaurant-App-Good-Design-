import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import functions from './__fixtures__/remaining-access-functions.json';
const migration=readFileSync(new URL('../../supabase/migrations/20260911172911_audit_remaining_access_boundaries.sql',import.meta.url),'utf8');
const owner='00000000-0000-0000-0000-000000000001';
const friend='00000000-0000-0000-0000-000000000002';
const stranger='00000000-0000-0000-0000-000000000003';
const publicAuthor='00000000-0000-0000-0000-000000000004';
const legacy=['profiles', 'friends', 'friend_requests', 'restaurants', 'user_reviews', 'restaurant_lists', 'restaurant_list_items', 'friend_profile_cache', 'friend_activity_cache', 'restaurant_shares', 'itineraries', 'trips', 'place_ratings', 'settings', 'review_helpfulness', 'expert_applications', 'user_roles', 'reservations', 'restaurant_staff_assignments', 'chat_rooms', 'chat_room_participants', 'profiles_public_search'];
const relations=[['activity_comments', 'community_ratings', 'rating_id'], ['activity_likes', 'community_ratings', 'rating_id'], ['activity_comment_likes', 'activity_comments', 'comment_id'], ['post_comments', 'posts', 'post_id'], ['post_likes', 'posts', 'post_id'], ['post_saves', 'posts', 'post_id'], ['reel_comments', 'reels', 'reel_id'], ['reel_likes', 'reels', 'reel_id'], ['reel_saves', 'reels', 'reel_id']];
let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();
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
  await db.exec(`alter table restaurants add column cuisine text; alter table profiles add column name text; alter table profiles add column allow_friend_requests boolean; alter table profiles add column home_city text; alter table profiles add column bio text;
    alter table community_ratings add column restaurant_id text default 'same-place';
    create table user_roles(user_id uuid,role text);
    insert into user_roles values('${friend}','expert');
    create table user_friends(id uuid,user_id uuid,friend_id uuid,created_at timestamptz,status text);
    grant select,insert,update,delete on user_friends to authenticated;
    create table ai_usage(user_id uuid,endpoint text,window_kind text,window_start timestamptz,request_count integer,primary key(user_id,endpoint,window_kind,window_start));
    create table plan_limits(plan text,endpoint text,window_kind text,max_count integer);
    insert into plan_limits values('free','fixture','hour',2);
    create function effective_plan() returns text language sql as $$select 'free'::text$$;
    create function ai_window_start(text,timestamptz) returns timestamptz language sql as $$select date_trunc('hour',$2)$$;
    create function ai_window_end(text,timestamptz) returns timestamptz language sql as $$select $2+interval '1 hour'$$;
    create function get_follow_counts(uuid) returns table(followers bigint,following bigint) language sql as $$select 0::bigint,0::bigint$$;
  `);

  for(const t of legacy) await db.exec(`create table if not exists ${t}(id uuid); grant all on ${t} to anon,authenticated,service_role;`);
  for(const t of ['posts','reels']) await db.exec(`create table ${t}(id uuid primary key,user_id uuid,is_public boolean); alter table ${t} enable row level security; create policy visible on ${t} for select using(is_public or user_id=auth.uid()); grant select on ${t} to anon,authenticated; insert into ${t} values('${owner}','${owner}',false),('${publicAuthor}','${publicAuthor}',true);`);
  // community ratings already have RLS; use ids to exercise their children.
  await db.exec(`alter table community_ratings add column id uuid; update community_ratings set id=user_id;
    create policy visible on community_ratings for select using(can_view_author(user_id));`);
  for(const [table,parent,key] of relations) await db.exec(`create table ${table}(id uuid primary key,user_id uuid,${key} uuid); alter table ${table} enable row level security; grant all on ${table} to anon,authenticated;
    create policy public_read on ${table} for select using(true);
    create policy own_insert on ${table} for insert with check(user_id=auth.uid());
    create policy own_update on ${table} for update using(user_id=auth.uid());
    insert into ${table} values('${owner}','${owner}','${owner}'),('${publicAuthor}','${publicAuthor}','${publicAuthor}');`);
  await db.exec(`alter table restaurant_staff_assignments add column staff_user_id uuid; alter table restaurant_staff_assignments add column restaurant_id uuid; alter table restaurant_staff_assignments add column is_active boolean;`);
  // Install exact deployed functions. Unused PL/pgSQL dependencies aren't invoked.
  for(const fn of functions) await db.exec(fn.definition);
  await db.exec('grant execute on all functions in schema public to anon,authenticated,service_role; set role anon;');
  expect((await db.query("select * from get_expert_reviews_for_place('fixture-place',20,0,'Fictional cafe')")).rows).toHaveLength(1);
  expect((await db.query('select * from post_comments')).rows).toHaveLength(2);
  await db.exec('reset role'); await db.exec(migration);
},30000);
afterAll(async()=>{await db?.close();});

it('retires legacy table and function access without deleting data or server grants',async()=>{
  for(const table of legacy) {
    expect((await db.query("select has_table_privilege('authenticated',$1,'SELECT') a,has_table_privilege('service_role',$1,'SELECT') s",[table])).rows[0]).toEqual({a:false,s:true});
  }
  for(const fn of functions.filter(f=>!['get_expert_stats','get_social_suggestions','consume_ai_quota'].includes(f.signature.split('(')[0]))) {
    expect((await db.query("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') u,has_function_privilege('service_role',$1,'EXECUTE') s",[fn.signature])).rows[0]).toEqual({a:false,u:false,s:true});
  }
});
it('hides private-parent reactions, including nested comment likes, while keeping public reads',async()=>{
  await db.exec("select set_config('request.jwt.claim.sub','',false); set role anon");
  for(const [table] of relations) expect((await db.query(`select id from ${table}`)).rows,table).toEqual([{id:publicAuthor}]);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`);
  for(const [table] of relations) expect((await db.query(`select id from ${table}`)).rows,table).toHaveLength(2);
  await db.exec('reset role');
});
it('prevents strangers from adding reactions to private parents or moving their reactions there',async()=>{
  await db.exec(`select set_config('request.jwt.claim.sub','${stranger}',false); set role authenticated;`);
  for(const [table,parent,key] of relations){
    await expect(db.query(`insert into ${table} values($1,$1,$2)`,[stranger,owner])).rejects.toThrow('row-level security');
    await db.query(`insert into ${table} values($1,$1,$2)`,[stranger,publicAuthor]);
    await expect(db.query(`update ${table} set ${key}=$1 where id=$2`,[owner,stranger])).rejects.toThrow('row-level security');
  }
  await db.exec('reset role');
});
it('allows request status updates but not forged follow identities',async()=>{
  const row=(await db.query("select has_column_privilege('authenticated','user_friends','status','UPDATE') status,has_column_privilege('authenticated','user_friends','user_id','UPDATE') sender,has_column_privilege('authenticated','user_friends','friend_id','UPDATE') recipient")).rows[0];
  expect(row).toEqual({status:true,sender:false,recipient:false});
});
it('filters private rating statistics and enforces the configured allowance',async()=>{
  await db.exec(`select set_config('request.jwt.claim.sub','${stranger}',false); set role authenticated;`);
  expect((await db.query('select user_id from get_expert_stats($1)',[[owner,publicAuthor]])).rows).toEqual([{user_id:publicAuthor}]);
  for(const allowed of [true,true,false]) expect((await db.query<{q:{allowed:boolean}}>("select consume_ai_quota('fixture') q")).rows[0].q.allowed).toBe(allowed);
  await db.exec('reset role');
});
it('can be applied again without changing its access decisions',async()=>{ await db.exec(migration); });
