import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,beforeEach,expect,it } from 'vitest';
const migration=readFileSync(new URL('../../supabase/migrations/20260910134232_audit_photo_access_preparation.sql',import.meta.url),'utf8');
const profileMigration=readFileSync(new URL('../../supabase/migrations/036_public_profile_data_rpcs.sql',import.meta.url),'utf8');
const owner='00000000-0000-0000-0000-000000000001', stranger='00000000-0000-0000-0000-000000000002', follower='00000000-0000-0000-0000-000000000003';
const url=(file:string,bucket='photos')=>`https://photos-test.supabase.co/storage/v1/object/public/${bucket}/${bucket==='avatars'?'restaurant-photos/':''}${owner}/${file}.jpg`;
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`
  create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create schema storage;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table user_profiles(user_id uuid primary key,is_public boolean,is_verified boolean,avatar_url text);
  create table user_friends(user_id uuid,friend_id uuid,status text);
  create table user_app_data(user_id uuid primary key,restaurant_meta jsonb);
  alter table user_app_data enable row level security;
  create policy own_data on user_app_data using(user_id=auth.uid());
  create table community_photos(user_id uuid,url text);
  create table community_ratings(user_id uuid,photo_url text);
  create table recipes(id uuid primary key,user_id uuid,is_public boolean,photos text[],steps jsonb);
  create table recipe_reviews(user_id uuid,recipe_id uuid,photo text);
  create table guides(user_id uuid,is_published boolean,visibility text,cover_photo text,entries jsonb);
  create table expert_recommendations(user_id uuid,photo_url text);
  create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(bucket_id text,name text);
  alter table storage.objects enable row level security;
  alter table recipes enable row level security;
  alter table community_photos enable row level security;
  alter table community_ratings enable row level security;
  alter table expert_recommendations enable row level security;
  create policy recipe_read on recipes for select using(is_public or user_id=auth.uid());
  create policy expert_read on expert_recommendations for select using(exists(select 1 from user_profiles p where p.user_id=expert_recommendations.user_id and p.is_verified));
  grant usage on schema auth,storage to anon,authenticated;
  grant select on all tables in schema public,storage to anon,authenticated;
  grant update on storage.objects to authenticated;
  insert into storage.buckets values('photos',true,null,null),('avatars',true,null,null);
  insert into user_profiles values('${owner}',true,false,null),('${stranger}',true,false,null),('${follower}',true,false,null);
  insert into user_friends values('${follower}','${owner}','accepted');
 `);
 for(const name of ['can_view_user_content','public_home_meals_impl','get_public_home_meals']){
  const start=profileMigration.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');const end=profileMigration.indexOf('$$;',profileMigration.indexOf('AS $$',start))+3;await db.exec(profileMigration.slice(start,end));
 }
 await db.exec(`revoke all on function can_view_user_content(uuid,uuid),public_home_meals_impl(uuid[],uuid) from public;
 create function can_view_author(target uuid) returns boolean language sql stable security definer set search_path='' as $$select public.can_view_user_content(auth.uid(),target)$$;
 create policy visible_photos on community_photos for select using(can_view_author(user_id));
 create policy visible_ratings on community_ratings for select using(can_view_author(user_id));`);
 await db.exec(migration);
},30000);
beforeEach(async()=>{
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);
 truncate storage.objects,community_photos,community_ratings,recipes,recipe_reviews,guides,expert_recommendations,user_app_data;
 update user_profiles set avatar_url=null,is_public=true,is_verified=false;
 update user_friends set status='accepted';
 insert into storage.objects select 'photos','${owner}/'||name||'.jpg' from unnest(array['private','avatar','community','rating','recipe','step','guide','entry','review','expert','meal','mealstep']) name;
 insert into storage.objects values('avatars','restaurant-photos/${owner}/legacy.jpg');`);
});
afterAll(async()=>{await db?.close();});
async function viewer(id=''){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role ${id?'authenticated':'anon'}`);}
async function visible(){return (await db.query<{name:string}>('select name from storage.objects order by name')).rows.map(r=>r.name);}
it('a public profile alone cannot expose private/unpublished uploads; owner previews work',async()=>{
 await viewer();expect(await visible()).toEqual([]);await viewer(stranger);expect(await visible()).toEqual([]);await viewer(owner);expect(await visible()).toHaveLength(13);
});
it('authorizes explicit avatars, community/legacy photos and rating covers',async()=>{
 await db.exec(`update user_profiles set avatar_url='${url('avatar')}' where user_id='${owner}';
 insert into community_photos values('${owner}','${url('community')}'),('${owner}','${url('legacy','avatars')}');
 insert into community_ratings values('${owner}','${url('rating')}');`);
 await viewer();expect(await visible()).toHaveLength(4);
 await db.exec(`reset role;update user_profiles set is_public=false where user_id='${owner}';`);
 await viewer();expect(await visible()).toEqual([`${owner}/avatar.jpg`]);
 await viewer(follower);expect(await visible()).toHaveLength(4);
 await db.exec("reset role;update user_friends set status='pending'");await viewer(follower);expect(await visible()).toHaveLength(1);
});
it('published recipes, steps, guides, entries and verified recommendations grant only referenced objects',async()=>{
 await db.exec(`insert into recipes values('${owner}','${owner}',true,array['${url('recipe')}'],'[{"photos":[{"url":"${url('step')}"}]}]');
 insert into guides values('${owner}',true,'public','${url('guide')}','[{"photos":["${url('entry')}"]}]');
 insert into expert_recommendations values('${owner}','${url('expert')}');update user_profiles set is_verified=true where user_id='${owner}';`);
 await viewer();expect(await visible()).toHaveLength(5);
 await db.exec("reset role;update recipes set is_public=false;update guides set is_published=false;update user_profiles set is_verified=false;");await viewer();expect(await visible()).toEqual([]);
});
it('review photo access requires visibility of its parent recipe',async()=>{
 await db.exec(`insert into recipes values('${owner}','${stranger}',true,'{}','[]');insert into recipe_reviews values('${owner}','${owner}','${url('review')}');`);
 await viewer();expect(await visible()).toEqual([`${owner}/review.jpg`]);
 await db.exec('reset role;update recipes set is_public=false');await viewer();expect(await visible()).toEqual([]);
 await viewer(stranger);expect(await visible()).toEqual([`${owner}/review.jpg`]);
});
it('home recipe projection includes step photos but respects private flags, profile visibility and tombstones',async()=>{
 const meal={id:'meal-1',isPublic:true,coverPhoto:url('meal'),stepGroups:[{steps:[{photo:url('mealstep')}]}]};
 await db.query('insert into user_app_data values($1,$2)',[owner,JSON.stringify({__home_meals__:[meal]})]);
 await viewer();expect(await visible()).toHaveLength(2);
 await db.exec(`reset role;update user_profiles set is_public=false where user_id='${owner}';`);await viewer();expect(await visible()).toEqual([]);
 await viewer(follower);expect(await visible()).toHaveLength(2);
 await db.exec(`reset role;update user_app_data set restaurant_meta=restaurant_meta||'{"__deleted_meals__":["meal-1"]}';`);await viewer(follower);expect(await visible()).toEqual([]);
});
it('copied private paths in another author’s public records cannot publish the victim’s photo',async()=>{
 await db.exec(`update user_profiles set avatar_url='${url('private')}',is_verified=true where user_id='${stranger}';
 insert into community_photos values('${stranger}','${url('private')}');
 insert into community_ratings values('${stranger}','${url('private')}');
 insert into recipes values('${stranger}','${stranger}',true,array['${url('private')}'],'[]');
 insert into guides values('${stranger}',true,'public','${url('private')}','[]');
 insert into expert_recommendations values('${stranger}','${url('private')}');`);
 await db.query('insert into user_app_data values($1,$2)',[stranger,JSON.stringify({__home_meals__:[{id:'copy',isPublic:true,coverPhoto:url('private')}]})]);
 await viewer();expect(await visible()).toEqual([]);
});
it('normalizes signed/encoded references and rejects malformed encodings; no definer or public RPC added',async()=>{
 await viewer();
 expect((await db.query<{path:string}>("select media_private.photo_reference_path($1) path",[url('recipe').replace('recipe.jpg','a%20b.jpg?token=ignored')])).rows[0].path).toBe(`photos/${owner}/a b.jpg`);
 expect((await db.query<{path:null}>("select media_private.photo_reference_path($1) path",[url('%ZZ')])).rows[0].path).toBeNull();
 await db.exec('reset role');expect((await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='media_private'")).rows.every(r=>!r.prosecdef)).toBe(true);
 expect((await db.query<{public:boolean}>("select public from storage.buckets where id='photos'")).rows[0].public).toBe(true);
});
