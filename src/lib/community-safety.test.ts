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
 await db.exec(`CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid DEFAULT gen_random_uuid(),name text,decrypted_secret text); CREATE VIEW vault.decrypted_secrets AS SELECT * FROM vault.secrets;
 CREATE FUNCTION vault.create_secret(secret text, secret_name text) RETURNS uuid LANGUAGE plpgsql AS $$DECLARE id uuid:=gen_random_uuid();BEGIN INSERT INTO vault.secrets VALUES(id,secret_name,secret);RETURN id;END$$;
 CREATE SCHEMA extensions; CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$SELECT repeat('a',n)::bytea$$;
 CREATE SCHEMA net; CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;
 CREATE SCHEMA cron; CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;
 `);
 await db.exec(readFileSync(new URL('../../supabase/migrations/20260912184452_automatic_content_screening.sql',import.meta.url),'utf8'));

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

it('requires explicit owner consent for the exact revision before a worker can see content',async()=>{
 const id='00000000-0000-0000-0000-000000000021';await as(alice);await db.query('INSERT INTO posts(id,user_id,caption) VALUES($1,$2,$3)',[id,alice,'A wonderful meal']);
 const row:any=(await db.query("SELECT revision FROM content_moderation WHERE kind='posts' AND content_id=$1",[id])).rows[0];
 await as(bob);await expect(db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,row.revision])).rejects.toThrow('unavailable');
 await as(alice);await expect(db.query("SELECT request_content_screening('posts',$1,$2,NULL)",[id,row.revision])).rejects.toThrow('permission');
 await expect(db.query("SELECT claim_content_screening('forged',2)")).rejects.toThrow('permission denied');
 await db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,row.revision]);
 await db.exec('reset role; set role service_role;');
 await expect(db.query("SELECT * FROM claim_content_screening('forged',2)")).rejects.toThrow('Unauthorized');
 const job:any=(await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows[0];expect(job.content_id).toBe(id);
 expect((await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows).toHaveLength(0);
 await db.query("SELECT finish_content_screening('posts',$1,$2,$3,'passed','test')",[id,row.revision,job.lease_id]);
 await as(bob);expect((await db.query('SELECT * FROM posts WHERE id=$1',[id])).rows).toHaveLength(1);
});
it('cannot apply an old automated decision to an edited or manually removed publication',async()=>{
 const id='00000000-0000-0000-0000-000000000022';await as(alice);await db.query('INSERT INTO posts(id,user_id,caption) VALUES($1,$2,$3)',[id,alice,'Before edit']);
 const row:any=(await db.query("SELECT revision FROM content_moderation WHERE content_id=$1",[id])).rows[0];await db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,row.revision]);
 await db.exec('reset role; set role service_role;');const job:any=(await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows[0];
 await as(alice);await db.query("UPDATE posts SET caption='After edit' WHERE id=$1",[id]);
 await db.exec('reset role; set role service_role;');expect((await db.query("SELECT finish_content_screening('posts',$1,$2,$3,'passed','test') ok",[id,row.revision,job.lease_id])).rows[0]).toEqual({ok:false});
 await as(bob);expect((await db.query('SELECT * FROM posts WHERE id=$1',[id])).rows).toHaveLength(0);
 await as(alice);const edited:any=(await db.query("SELECT revision,screening_state FROM content_moderation WHERE content_id=$1",[id])).rows[0];expect(edited.screening_state).toBe('awaiting_consent');
 await db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,edited.revision]);await db.exec('reset role; set role service_role;');const next:any=(await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows[0];
 await as(admin);await db.query("SELECT review_content('posts',$1,$2,false)",[id,edited.revision]);await db.exec('reset role; set role service_role;');expect((await db.query("SELECT finish_content_screening('posts',$1,$2,$3,'passed','test') ok",[id,edited.revision,next.lease_id])).rows[0]).toEqual({ok:false});
});
it('keeps flagged content private and prevents callers from repeatedly resubmitting it',async()=>{
 const id='00000000-0000-0000-0000-000000000023';await as(alice);await db.query('INSERT INTO posts(id,user_id,caption) VALUES($1,$2,$3)',[id,alice,'Flag fixture']);
 const row:any=(await db.query("SELECT revision FROM content_moderation WHERE content_id=$1",[id])).rows[0];await db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,row.revision]);await db.exec('reset role; set role service_role;');const job:any=(await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows[0];await db.query("SELECT finish_content_screening('posts',$1,$2,$3,'flagged','provider_flagged')",[id,row.revision,job.lease_id]);
 await as(alice);await db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,row.revision]);
 await as(bob);expect((await db.query('SELECT * FROM posts WHERE id=$1',[id])).rows).toHaveLength(0);
 await db.exec('reset role; set role service_role;');expect((await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows).toHaveLength(0);
});
it('withholds a carousel while any media is unapproved',async()=>{
 const id='00000000-0000-0000-0000-000000000024',media='00000000-0000-0000-0000-000000000025';await as(alice);await db.query('INSERT INTO posts(id,user_id,caption) VALUES($1,$2,$3)',[id,alice,'Photo carousel']);await db.query('INSERT INTO post_items(id,post_id) VALUES($1,$2)',[media,id]);
 await as(admin);const rows:any[]=(await db.query("SELECT * FROM content_moderation WHERE content_id IN ($1,$2)",[id,media])).rows;const parent=rows.find(r=>r.kind==='posts'),child=rows.find(r=>r.kind==='post_items');await db.query("SELECT review_content('posts',$1,$2,true)",[id,parent.revision]);
 await as(bob);expect((await db.query('SELECT * FROM posts WHERE id=$1',[id])).rows).toHaveLength(0);
 await as(admin);await db.query("SELECT review_content('post_items',$1,$2,true)",[media,child.revision]);await as(bob);expect((await db.query('SELECT * FROM posts WHERE id=$1',[id])).rows).toHaveLength(1);
});

it('honors manual review without queueing provider work and eventually holds repeated outages',async()=>{
 const id='00000000-0000-0000-0000-000000000026';await as(alice);await db.query('INSERT INTO posts(id,user_id,caption) VALUES($1,$2,$3)',[id,alice,'Manual choice']);
 let row:any=(await db.query("SELECT revision FROM content_moderation WHERE content_id=$1",[id])).rows[0];await db.query("SELECT request_manual_content_review('posts',$1,$2)",[id,row.revision]);
 expect((await db.query("SELECT screening_state FROM content_moderation WHERE content_id=$1",[id])).rows[0]).toEqual({screening_state:'manual'});
 await db.query("UPDATE posts SET caption='Try automatic checks' WHERE id=$1",[id]);row=(await db.query("SELECT revision FROM content_moderation WHERE content_id=$1",[id])).rows[0];await db.query("SELECT request_content_screening('posts',$1,$2,'2026-09-12-screening')",[id,row.revision]);
 await db.exec('reset role;set role service_role;');for(let i=0;i<3;i++){await db.exec("UPDATE safety_private.screening_jobs SET available_at=now()-interval '1 minute'");const j:any=(await db.query("SELECT * FROM claim_content_screening(repeat('61',32),2)")).rows[0];expect(j).toBeTruthy();await db.query("SELECT finish_content_screening('posts',$1,$2,$3,'retry','outage')",[id,row.revision,j.lease_id]);}
 await as(alice);expect((await db.query("SELECT status,screening_state FROM content_moderation WHERE content_id=$1",[id])).rows[0]).toEqual({status:'pending',screening_state:'manual'});
});
it('invalidates approval when an uploaded object is recreated at the same path',async()=>{
 const id='00000000-0000-0000-0000-000000000027',path=alice+'/replacement.png';await as(alice);await db.query('INSERT INTO community_photos(id,user_id,photo_url) VALUES($1,$2,$3)',[id,alice,'photos/'+path]);
 await as(admin);const row:any=(await db.query("SELECT revision FROM content_moderation WHERE content_id=$1",[id])).rows[0];await db.query("SELECT review_content('community_photos',$1,$2,true)",[id,row.revision]);
 await db.exec('reset role');await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('photos',$1)",[path]);
 await as(alice);const changed:any=(await db.query("SELECT revision,status,screening_state FROM content_moderation WHERE content_id=$1",[id])).rows[0];expect(changed.status).toBe('pending');expect(changed.revision).not.toBe(row.revision);expect(changed.screening_state).toBe('awaiting_consent');
});
