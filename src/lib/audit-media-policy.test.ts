import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
const migration = readFileSync(new URL('../../supabase/migrations/20260910131404_audit_reel_storage_and_expert_schema.sql', import.meta.url), 'utf8');
const owner='00000000-0000-0000-0000-000000000001', follower='00000000-0000-0000-0000-000000000002', stranger='00000000-0000-0000-0000-000000000003';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table user_profiles(user_id uuid primary key,is_verified boolean);
    create table user_friends(user_id uuid,friend_id uuid,status text);
    create table reels(user_id uuid,video_path text,is_public boolean);
    create table posts(id int primary key,user_id uuid,is_public boolean);
    create table post_items(post_id int,media_path text);
    create table storage.buckets(id text primary key,public boolean);
    create table storage.objects(bucket_id text,name text);
    create table restaurant_cuisine(restaurant_id text,cuisine text);
    create table restaurant_cuisine_tags(restaurant_id text,cuisine text);
    alter table storage.objects enable row level security;
    alter table reels enable row level security;
    alter table posts enable row level security;
    alter table post_items enable row level security;
    alter table restaurant_cuisine enable row level security;
    alter table restaurant_cuisine_tags enable row level security;
    create policy reels_read on reels for select using(is_public or user_id=auth.uid() or exists(select 1 from user_friends f where f.user_id=auth.uid() and f.friend_id=reels.user_id and f.status='accepted'));
    create policy posts_read on posts for select using(is_public or user_id=auth.uid() or exists(select 1 from user_friends f where f.user_id=auth.uid() and f.friend_id=posts.user_id and f.status='accepted'));
    create policy items_read on post_items for select using(exists(select 1 from posts where posts.id=post_items.post_id));
    create policy "Reels videos are publicly readable" on storage.objects for select using(bucket_id='reels-videos');
    grant usage on schema storage,auth to anon,authenticated;
    grant select on all tables in schema public,storage to anon,authenticated;
    insert into auth.users values('${owner}'),('${follower}'),('${stranger}');
    insert into user_profiles values('${owner}',true),('${follower}',false),('${stranger}',false);
    insert into storage.buckets values('reels-videos',true),('post-media',false);
    insert into user_friends values('${follower}','${owner}','accepted');
    insert into restaurant_cuisine values('place','Thai');
    insert into restaurant_cuisine_tags values('place','Asian');`);
  await db.exec(migration);
},30000);
beforeEach(async () => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);
    truncate reels,post_items,posts,storage.objects,expert_recommendations;
    update user_friends set status='accepted';
    update user_profiles set is_verified=(user_id='${owner}');
    insert into reels values('${owner}','${owner}/public.mp4',true),('${owner}','${owner}/private.mp4',false),('${stranger}','${owner}/private.mp4',true);
    insert into posts values(1,'${owner}',true),(2,'${owner}',false),(3,'${stranger}',true);
    insert into post_items values(1,'${owner}/public.mp4'),(2,'${owner}/private.mp4'),(3,'${owner}/private.mp4');
    insert into storage.objects select bucket,path from unnest(array['reels-videos','post-media']) bucket cross join unnest(array['${owner}/public.mp4','${owner}/public.mp4.jpg','${owner}/private.mp4','${owner}/private.mp4.jpg','${owner}/unpublished.mp4']) path;
  `);
});
afterAll(async () => { await db?.close(); });
async function viewer(id='') {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${id ? 'authenticated' : 'anon'}`);
}
async function paths() { return (await db.query<{name:string}>('select name from storage.objects order by bucket_id,name')).rows.map(r=>r.name); }
it('guests and strangers see public videos and posters, never private paths copied into another author’s public post',async()=>{
  for(const id of ['',stranger]) { await viewer(id); const visible=await paths(); expect(visible).toHaveLength(4); expect(visible.every(p=>p.includes('/public.mp4'))).toBe(true); }
});
it('owners can preview unpublished uploads; accepted followers see private videos and posters',async()=>{
  await viewer(owner); expect(await paths()).toHaveLength(10);
  await viewer(follower); const visible=await paths(); expect(visible).toHaveLength(8); expect(visible.some(p=>p.includes('unpublished'))).toBe(false);
});
it('pending and removed follows do not retain permission; making media private removes anonymous access',async()=>{
  await db.exec("update user_friends set status='pending'; update reels set is_public=false; update posts set is_public=false;");
  for(const id of ['',follower,stranger]) { await viewer(id); expect(await paths()).toEqual([]); }
  await db.exec("reset role; delete from user_friends;");
  await viewer(follower); expect(await paths()).toEqual([]);
});
it('only a verified author can publish expert recommendations',async()=>{
  const insert=(id:string)=>db.query('insert into expert_recommendations(user_id,restaurant_id,rating) values($1,$2,8)',[id,'place']);
  await viewer(stranger); await expect(insert(stranger)).rejects.toThrow('row-level security'); await expect(insert(owner)).rejects.toThrow('row-level security');
  await viewer(owner); await insert(owner);
  await viewer(); expect((await db.query('select * from expert_recommendations')).rows).toHaveLength(1);
  await db.exec(`reset role; update user_profiles set is_verified=false where user_id='${owner}';`);
  await viewer(); expect((await db.query('select * from expert_recommendations')).rows).toHaveLength(0);
});
it('guest cuisine reads work without granting write permissions, and the reel bucket is private',async()=>{
  expect((await db.query<{public:boolean}>("select public from storage.buckets where id='reels-videos'")).rows[0].public).toBe(false);
  await viewer();
  expect((await db.query('select * from restaurant_cuisine')).rows).toHaveLength(1);
  expect((await db.query('select * from restaurant_cuisine_tags')).rows).toHaveLength(1);
  await expect(db.exec("insert into restaurant_cuisine values('fake','fake')")).rejects.toThrow('permission denied');
});
