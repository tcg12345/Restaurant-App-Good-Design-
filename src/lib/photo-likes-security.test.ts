import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
const alice='10000000-0000-4000-8000-000000000001', bob='10000000-0000-4000-8000-000000000002';
const first='20000000-0000-4000-8000-000000000001', second='20000000-0000-4000-8000-000000000002', hidden='20000000-0000-4000-8000-000000000003';
let db:PGlite;
async function asUser(id:string) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); }
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create table auth.users(id uuid primary key); insert into auth.users values('${alice}'),('${bob}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon;
 create table public.community_photos(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,restaurant_id text,url text,caption text,is_favorite boolean,created_at timestamptz default now());
 insert into public.community_photos values('${first}','${alice}','place','first.jpg','',false,now()),('${second}','${alice}','place','second.jpg','',true,now()),('${hidden}','${alice}','hidden','private.jpg','',false,now());
 alter table public.community_photos enable row level security;
 grant select,insert,update,delete on public.community_photos to authenticated;
 grant select on public.community_photos to anon;
 create policy visible on public.community_photos for select using(restaurant_id<>'hidden' or user_id=auth.uid());
 create policy own_insert on public.community_photos for insert with check(user_id=auth.uid());
 create policy own_delete on public.community_photos for delete using(user_id=auth.uid());`);
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260909212919_community_photo_likes.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
it('uses actual likes for ranking and allows only one vote per account',async()=>{
 await asUser(bob);
 await db.query('insert into public.community_photo_likes(photo_id,user_id) values($1,$2)',[first,bob]);
 await expect(db.query('insert into public.community_photo_likes(photo_id,user_id) values($1,$2)',[first,bob])).rejects.toThrow('duplicate');
 expect((await db.query('select id from public.popular_restaurant_photo($1)',['place'])).rows).toEqual([{id:first}]);
 const stats=(await db.query('select * from public.community_photo_like_stats($1)',[[first]])).rows[0] as any;
 expect(Number(stats.like_count)).toBe(1); expect(stats.liked).toBe(true);
});
it('rejects forged votes and hidden photos, and cannot delete another person’s vote',async()=>{
 await asUser(bob);
 await expect(db.query('insert into public.community_photo_likes(photo_id,user_id) values($1,$2)',[second,alice])).rejects.toThrow('row-level security');
 await expect(db.query('insert into public.community_photo_likes(photo_id,user_id) values($1,$2)',[hidden,bob])).rejects.toThrow('row-level security');
 expect((await db.query('select * from public.community_photo_like_stats($1)',[[hidden]])).rows).toHaveLength(0);
 expect((await db.query('select * from public.popular_restaurant_photo($1)',['hidden'])).rows).toHaveLength(0);
 await asUser(alice);
 await db.query('delete from public.community_photo_likes where user_id=$1',[bob]);
 expect((await db.query('select * from public.community_photo_likes')).rows).toHaveLength(1);
});
it('preserves votes through review edits, removes deleted photos, and rolls invalid edits back',async()=>{
 await asUser(alice);
 await db.query('select public.sync_community_photos($1,$2,$3)',[alice,'place',JSON.stringify([{url:'first.jpg',caption:'Updated',is_favorite:true}])]);
 expect((await db.query('select id,caption from public.community_photos where restaurant_id=$1',['place'])).rows).toEqual([{id:first,caption:'Updated'}]);
 expect((await db.query('select * from public.community_photo_likes')).rows).toHaveLength(1);
 await expect(db.query('select public.sync_community_photos($1,$2,$3)',[alice,'place','[{"url":""}]'])).rejects.toThrow('Photo URL');
 expect((await db.query('select id from public.community_photos where id=$1',[first])).rows).toHaveLength(1);
 await expect(db.query('select public.sync_community_photos($1,$2,$3)',[bob,'place','[]'])).rejects.toThrow('Sign in');
 await db.query('select public.sync_community_photos($1,$2,$3)',[alice,'place','[]']);
 expect((await db.query('select * from public.community_photo_likes')).rows).toHaveLength(0);
});
it('does not allow guests to vote or mutate photos',async()=>{
 await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); set role anon;");
 await expect(db.query('insert into public.community_photo_likes(photo_id,user_id) values($1,$2)',[hidden,bob])).rejects.toThrow('permission denied');
 await expect(db.query('select public.sync_community_photos($1,$2,$3)',[alice,'hidden','[]'])).rejects.toThrow('permission denied');
});
