import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
const admin='10000000-0000-4000-8000-000000000001', sender='10000000-0000-4000-8000-000000000002', other='10000000-0000-4000-8000-000000000003';
let db:PGlite;
async function asUser(id=sender) { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`); }
async function submit(extra:Record<string,unknown>={}) {
  const row={id:crypto.randomUUID(),user_id:sender,category:'feedback',feature:'Search',message:'Please add better search filters.',allow_contact:false,contact_email:null,screenshot_path:null,app_version:'1.0.0',platform:'web',device_type:'desktop',browser:'Chrome',...extra};
  const keys=Object.keys(row);
  await db.query(`insert into public.user_feedback(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
  return row.id;
}
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${admin}'),('${sender}'),('${other}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
  create function public.is_app_admin() returns boolean language sql stable as $$ select auth.uid()='${admin}'::uuid $$;
  create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
  grant usage on schema storage to authenticated,anon; grant select,insert,update,delete on storage.objects to authenticated; grant select on storage.objects to anon;`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260908131556_user_feedback.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{await db.exec('reset role; truncate public.user_feedback, storage.objects;');await asUser();});
afterAll(async()=>{await db?.close();});
it('keeps messages private, permits owner reads, and restricts review to admins',async()=>{
  const id=await submit();expect((await db.query('select * from user_feedback')).rows).toHaveLength(1);
  await asUser(other);expect((await db.query('select * from user_feedback')).rows).toHaveLength(0);
  expect((await db.query("update user_feedback set status='resolved' returning id")).rows).toHaveLength(0);
  await asUser(sender);expect((await db.query("update user_feedback set status='resolved' returning id")).rows).toHaveLength(0);
  await asUser(admin);await db.query("update user_feedback set status='reviewing' where id=$1",[id]);
  expect((await db.query<{status:string}>('select status from user_feedback')).rows[0].status).toBe('reviewing');
  await expect(db.query("update user_feedback set message='tampered' where id=$1",[id])).rejects.toThrow('permission denied');
  await db.exec('reset role; set role anon');await expect(db.query('select * from user_feedback')).rejects.toThrow('permission denied');
});
it('rejects forged senders, pre-reviewed submissions, invalid content, and contact without consent',async()=>{
  await expect(submit({user_id:other})).rejects.toThrow('Sign in');
  await expect(submit({status:'resolved'})).rejects.toThrow('row-level security');
  await expect(submit({message:'short'})).rejects.toThrow('check constraint');
  await expect(submit({contact_email:'person@example.com'})).rejects.toThrow('check constraint');
  await expect(submit({allow_contact:true,contact_email:null})).rejects.toThrow('check constraint');
  await expect(submit({screenshot_path:`${other}/fake/screenshot.png`})).rejects.toThrow('check constraint');
  await submit({allow_contact:true,contact_email:'person@example.com'});
});
it('enforces server timestamps and the per-account submission limit',async()=>{
  for(let i=0;i<10;i++)await submit({created_at:'2000-01-01T00:00:00Z'});
  await expect(submit()).rejects.toThrow('Please wait');
  expect((await db.query<{n:number}>("select count(*)::int n from user_feedback where created_at>now()-interval '1 minute'")).rows[0].n).toBe(10);
  await asUser(other);await submit({user_id:other});
});
it('protects screenshot access and prevents overwriting attachments',async()=>{
  const name=`${sender}/${crypto.randomUUID()}/screenshot.png`;
  await db.query("insert into storage.objects(bucket_id,name) values('feedback-screenshots',$1)",[name]);
  await expect(db.query("insert into storage.objects(bucket_id,name) values('feedback-screenshots',$1)",[`${other}/x.png`])).rejects.toThrow('row-level security');
  await asUser(other);expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  await asUser(admin);expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
  await asUser(sender);expect((await db.query("update storage.objects set name='changed' returning name")).rows).toHaveLength(0);
  await db.exec('reset role; set role anon');expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
});
