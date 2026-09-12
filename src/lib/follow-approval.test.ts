import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',c='00000000-0000-0000-0000-000000000003';
let db:PGlite;
const migration=readFileSync(new URL('../../supabase/migrations/20260912113350_audit_follow_approval_boundary.sql',import.meta.url),'utf8');
beforeAll(async()=>{db=new PGlite();await db.exec(`
 create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table user_profiles(user_id uuid primary key,is_public boolean,is_verified boolean);
 insert into user_profiles values('${a}',false,false),('${b}',false,false),('${c}',true,false);
 create table user_friends(user_id uuid,friend_id uuid,status text,primary key(user_id,friend_id));
 alter table user_friends enable row level security;
 create policy own_insert on user_friends for insert to authenticated with check(user_id=auth.uid());
 create policy participants_read on user_friends for select to authenticated using(user_id=auth.uid() or friend_id=auth.uid());
 create policy recipient_update on user_friends for update to authenticated using(friend_id=auth.uid());
 create policy sender_delete on user_friends for delete to authenticated using(user_id=auth.uid());
 grant select on user_profiles to authenticated;
 grant select,insert,delete on user_friends to authenticated; grant update(status) on user_friends to authenticated;
 `);await db.exec(migration);});
afterAll(async()=>db.close());
beforeEach(async()=>{await db.exec(`reset role; truncate user_friends; set role authenticated; set app.uid='${a}';`);});
it('rejects a sender self-approving access to a private account',async()=>{
 await expect(db.exec(`insert into user_friends values('${a}','${b}','accepted')`)).rejects.toThrow(/row-level security/);
});
it('permits pending requests and recipient-only acceptance with status-only grants',async()=>{
 await db.exec(`insert into user_friends values('${a}','${b}','pending'); update user_friends set status='accepted' where friend_id='${b}'`);
 expect((await db.query('select status from user_friends')).rows).toEqual([{status:'pending'}]);
 await db.exec(`set app.uid='${b}'; update user_friends set status='accepted' where user_id='${a}'`);
 expect((await db.query('select status from user_friends')).rows).toEqual([{status:'accepted'}]);
 await expect(db.exec(`update user_friends set user_id='${c}'`)).rejects.toThrow(/permission denied/);
});
it('supports idempotent public follows without UPDATE privilege on identities',async()=>{
 const sql=`insert into user_friends values('${a}','${c}','accepted') on conflict(user_id,friend_id) do nothing`;
 await db.exec(sql);await db.exec(sql);expect((await db.query('select * from user_friends')).rows).toHaveLength(1);
 await expect(db.exec(`insert into user_friends values('${a}','${c}','accepted') on conflict(user_id,friend_id) do update set user_id=excluded.user_id,friend_id=excluded.friend_id,status=excluded.status`)).rejects.toThrow(/permission denied/);
});
it('actual client follow writer works with the tightened grants and retries declined requests',async()=>{
 const source=readFileSync(new URL('./supabase-community.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('community.ts',source,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='saveFollowEdge')!;
 const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const client={from:()=>{const filter:Record<string,string>={};let mode='read';let values:any;let ignore=false;
 const run=async()=>{try{
  if(mode==='read')return {data:(await db.query('select status from user_friends where user_id=$1 and friend_id=$2',[filter.user_id,filter.friend_id])).rows[0]??null,error:null};
  if(mode==='delete')await db.query('delete from user_friends where user_id=$1 and friend_id=$2 and status=$3',[filter.user_id,filter.friend_id,filter.status]);
  else await db.query(`insert into user_friends values($1,$2,$3) on conflict(user_id,friend_id) ${ignore?'do nothing':'do update set user_id=excluded.user_id,friend_id=excluded.friend_id,status=excluded.status'}`,[values.user_id,values.friend_id,values.status]);
  return {error:null};
 }catch(error){return {error};}};
 const q:any={select:()=>q,eq:(k:string,v:string)=>{filter[k]=v;return q},maybeSingle:run,delete:()=>{mode='delete';return q},upsert:(v:any,o:any)=>{mode='insert';values=v;ignore=o.ignoreDuplicates===true;return q},then:(resolve:any)=>run().then(resolve)};return q;}};
 const save=new Function('supabase','console',code+';return saveFollowEdge;')(client,{error(){}});
 expect(await save(a,c,'accepted')).toBe(true);expect(await save(a,c,'accepted')).toBe(true);
 expect(await save(a,b,'accepted')).toBe(false);expect(await save(a,b,'pending')).toBe(true);
 await db.exec(`set app.uid='${b}'; update user_friends set status='declined' where user_id='${a}'; set app.uid='${a}'`);
 expect(await save(a,b,'pending')).toBe(true);
 expect((await db.query('select status from user_friends where friend_id=$1',[b])).rows).toEqual([{status:'pending'}]);
});
