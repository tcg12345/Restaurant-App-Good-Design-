import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it } from 'vitest';
const migration = readFileSync(new URL('../../supabase/migrations/20260912180851_community_safety_controls.sql', import.meta.url),'utf8');
const alice='00000000-0000-0000-0000-000000000001',bob='00000000-0000-0000-0000-000000000002',admin='00000000-0000-0000-0000-000000000003';
let db:PGlite;
const as = async (id:string) => db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`);
beforeAll(async()=>{
 db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA private; CREATE TABLE private.group_rooms(id uuid,code text,state jsonb); CREATE FUNCTION public.group_room_action(uuid,text,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$; CREATE SCHEMA storage; CREATE SCHEMA media_private; CREATE TABLE storage.objects(bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE FUNCTION media_private.can_read_photo(text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$; CREATE FUNCTION media_private.photo_reference_path(text) RETURNS text LANGUAGE sql AS $$SELECT $1$$; CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon,authenticated;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${alice}'),('${bob}'),('${admin}');
 CREATE FUNCTION public.is_app_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='${admin}'::uuid $$;
 CREATE TABLE public.user_profiles(user_id uuid PRIMARY KEY,is_public boolean,display_name text,username text,avatar_url text);
 CREATE TABLE public.user_friends(id uuid DEFAULT gen_random_uuid(),user_id uuid,friend_id uuid,status text);
 CREATE TABLE public.notifications(id uuid,user_id uuid,actor_id uuid,kind text);
 CREATE TABLE public.user_app_data(user_id uuid PRIMARY KEY,wishlist jsonb DEFAULT '[]',lists jsonb DEFAULT '[]',home_meals jsonb DEFAULT '[]',restaurant_meta jsonb DEFAULT '{}');
 CREATE TABLE public.conversations(id uuid PRIMARY KEY,participant_ids uuid[]);
 CREATE TABLE public.messages(id uuid PRIMARY KEY,sender_id uuid,conversation_id uuid,text text,shared_payload jsonb);
 CREATE TABLE public.recipe_comment_likes(user_id uuid,comment_id uuid); ALTER TABLE public.recipe_comment_likes ENABLE ROW LEVEL SECURITY; CREATE TABLE public.shared_lists(id uuid,owner_id uuid,member_ids uuid[]);
 `);
 for(const table of ['community_ratings','community_photos','posts','post_items','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations']) {
 await db.exec(`CREATE TABLE ${table}(id uuid PRIMARY KEY,user_id uuid,is_public boolean DEFAULT true,is_published boolean DEFAULT true,visibility text DEFAULT 'public',post_id uuid,target_id text,caption text,notes text,photo_url text);`);
 }
 for(const table of ['user_profiles','user_friends','notifications','messages','conversations','shared_lists','user_app_data','community_ratings','community_photos','posts','post_items','reels','recipes','guides','activity_comments','post_comments','reel_comments','recipe_reviews','recipe_comments','expert_recommendations']) {
 await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture ON ${table} TO authenticated,anon USING(${['posts','reels'].includes(table)?"is_public OR user_id=auth.uid()":'true'}) WITH CHECK(true); GRANT ALL ON ${table} TO authenticated; GRANT SELECT ON ${table} TO anon;`);
 }
 await db.exec(`INSERT INTO user_profiles(user_id,is_public,display_name) VALUES('${alice}',true,'Alice'),('${bob}',true,'Bob'); INSERT INTO community_ratings(id,user_id,notes) VALUES('${alice}','${alice}','An existing review');`);
 await db.exec(migration);
},30000);
afterAll(async()=>{await db?.close();});
it('preserves existing publications, holds new shared content and cannot be self-approved',async()=>{
 await as(alice);
 await db.exec(`INSERT INTO posts(id,user_id,caption) VALUES('${alice}','${alice}','A new post');`);
 expect((await db.query('SELECT * FROM posts')).rows).toHaveLength(1);
 await expect(db.exec(`UPDATE content_moderation SET status='approved'`)).rejects.toThrow('permission denied');
 await expect(db.query("SELECT review_content('posts',$1,$2,true)",[alice,alice])).rejects.toThrow('Administrator required');
 await as(bob); expect((await db.query('SELECT * FROM posts')).rows).toHaveLength(0);
 expect((await db.query('SELECT * FROM community_ratings')).rows).toHaveLength(1);
 await as(admin); const row:any=(await db.query("SELECT revision FROM content_moderation WHERE kind='posts'")).rows[0];
 await db.query("SELECT review_content('posts',$1,$2,true)",[alice,row.revision]);
 await as(bob); expect((await db.query('SELECT * FROM posts')).rows).toHaveLength(1);
 await as(alice); await db.exec("UPDATE posts SET caption='Changed text'");
 await as(admin); await expect(db.query("SELECT review_content('posts',$1,$2,true)",[alice,row.revision])).rejects.toThrow('changed');
 await as(bob); expect((await db.query('SELECT * FROM posts')).rows).toHaveLength(0);
});
it('keeps reporters private, deduplicates reports and lets only moderators act',async()=>{
 await as(bob); await db.query("SELECT report_content('community_ratings',$1,'harassment','Please review')",[alice]);
 await db.query("SELECT report_content('community_ratings',$1,'spam','Retry')",[alice]);
 expect((await db.query('SELECT * FROM content_reports')).rows).toHaveLength(1);
 await as(alice); expect((await db.query('SELECT * FROM content_reports')).rows).toHaveLength(0);
 await as(admin); const r:any=(await db.query('SELECT id FROM content_reports')).rows[0];
 await as(alice); await expect(db.query("SELECT resolve_content_report($1,'remove')",[r.id])).rejects.toThrow('Administrator required');
 await as(admin); await db.query("SELECT resolve_content_report($1,'remove')",[r.id]);
 await as(bob); expect((await db.query('SELECT * FROM community_ratings')).rows).toHaveLength(0);
});
it('enforces blocking in both directions for content, follows, and private messages',async()=>{
 await as(alice); await db.exec(`INSERT INTO conversations VALUES('${alice}',ARRAY['${alice}','${bob}']::uuid[]); INSERT INTO user_friends(user_id,friend_id,status) VALUES('${bob}','${alice}','accepted');`);
 await db.query('SELECT set_user_block($1,true)',[bob]);
 await expect(db.exec(`INSERT INTO messages VALUES('${alice}','${alice}','${alice}','Blocked message',null)`)).rejects.toThrow('Messaging is unavailable');
 expect((await db.query('SELECT * FROM user_profiles')).rows).toHaveLength(1);
 await as(bob); await expect(db.exec(`INSERT INTO user_friends(user_id,friend_id,status) VALUES('${bob}','${alice}','accepted')`)).rejects.toThrow('unavailable');
 await expect(db.exec(`INSERT INTO messages VALUES('${bob}','${bob}','${alice}','Blocked message',null)`)).rejects.toThrow('Messaging is unavailable');
 expect((await db.query('SELECT * FROM user_blocks')).rows).toHaveLength(0);
 await db.query('SELECT set_user_block($1,false)',[alice]); // cannot remove Alice's block
 expect((await db.query('SELECT can_interact_with($1) allowed',[alice])).rows[0]).toEqual({allowed:false});
 await as(alice); await db.query('SELECT set_user_block($1,false)',[bob]);
 await db.exec(`INSERT INTO messages VALUES('${alice}','${alice}','${alice}','Now available',null)`);
});
it('never copies private app data and filters legacy public projections until approved',async()=>{
 await as(alice); await db.query('INSERT INTO user_app_data(user_id,lists,home_meals,restaurant_meta) VALUES($1,$2,$3,$4)',[alice,JSON.stringify([{id:'test-list',name:'New list',restaurantIds:[]}]),JSON.stringify([{id:'meal',name:'Shared meal',isPublic:true},{id:'private-meal',name:'Secret',isPublic:false}]),JSON.stringify({privateValue:'not for moderation'})]);
 const items:any[]=(await db.query("SELECT * FROM content_moderation WHERE kind IN ('home_meals','lists')")).rows;
 expect(items).toHaveLength(2); expect(JSON.stringify(items)).not.toContain('Secret'); expect(JSON.stringify(items)).not.toContain('not for moderation');
 await as(bob); expect((await db.query('SELECT get_public_lists($1) items',[alice])).rows[0]).toEqual({items:[]});
 expect((await db.query('SELECT * FROM public_home_meals_impl(NULL,NULL)')).rows).toHaveLength(0);
 await as(admin); for(const item of items) await db.query('SELECT review_content($1,$2,$3,true)',[item.kind,item.content_id,item.revision]);
 await as(bob); expect((await db.query('SELECT get_public_lists($1) items',[alice])).rows[0]['items']).toHaveLength(1);
});

it('cannot use reports to read a private post or forge report snapshots',async()=>{
 const privateId='00000000-0000-0000-0000-000000000010';
 await as(alice);await db.query('INSERT INTO posts(id,user_id,caption,is_public) VALUES($1,$2,$3,false)',[privateId,alice,'Private material']);
 await as(admin);const row:any=(await db.query("SELECT revision FROM content_moderation WHERE kind='posts' AND content_id=$1",[privateId])).rows[0];await db.query("SELECT review_content('posts',$1,$2,true)",[privateId,row.revision]);
 await as(bob);await expect(db.query("SELECT report_content('posts',$1,'privacy','')",[privateId])).rejects.toThrow('row-level security');
 await expect(db.query("INSERT INTO content_reports(reporter_id,kind,content_id,reason,snapshot,author_id) VALUES($1,'posts',$2,'spam','{}',$3)",[bob,privateId,alice])).rejects.toThrow('permission denied');
 expect((await db.query("SELECT * FROM content_reports WHERE content_id=$1",[privateId])).rows).toHaveLength(0);
});
it('keeps moderation helpers and operational functions unavailable to ordinary callers',async()=>{
 await as(bob);for(const fn of ['safety_private.enqueue(text,text,uuid,jsonb)','safety_private.capture_content()','public.safety_push_allowed(uuid)','public.group_room_action(uuid,text,jsonb)']) expect((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') allowed",[fn])).rows[0]).toEqual({allowed:false});
});
