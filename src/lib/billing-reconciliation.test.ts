import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
const migration=readFileSync(new URL('../../supabase/migrations/20260911145527_audit_billing_reconciliation.sql',import.meta.url),'utf8');
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${a}'),('${b}');
 create table user_profiles(user_id uuid primary key,plan text,pro_until timestamptz,pro_source text,pro_will_renew boolean,updated_at timestamptz);
 create table subscription_events(id text primary key,user_id uuid,type text,store text,environment text,product_id text,expires_at timestamptz,payload jsonb,processed_at timestamptz);
 grant all on user_profiles,subscription_events to service_role;`);
 await db.exec(migration);
},30000);
beforeEach(async()=>{await db.exec(`reset role;truncate user_profiles,subscription_events,billing_sync_state;insert into user_profiles(user_id,plan) values('${a}','free'),('${b}','free'); set role service_role;`);});
afterAll(async()=>{await db?.close();});
const state=(user=a,ms=2000,plan='pro')=>({user_id:user,observed_at_ms:ms,plan,pro_until:null,pro_source:'fixture',pro_will_renew:false});
const apply=(id:string,updates:unknown[])=>db.query('select apply_billing_event($1,$2)',[{id,type:'FIXTURE',payload:{}},updates]);
it('a delayed snapshot cannot undo a newer renewal, expiry or restore',async()=>{
 await apply('renewal',[state(a,2000,'pro')]);
 await apply('late-expiry',[state(a,1000,'free')]);
 expect((await db.query('select plan from user_profiles where user_id=$1',[a])).rows).toEqual([{plan:'pro'}]);
 await db.query('select apply_billing_snapshot($1,$2,$3)',[a,state(a,3000,'free'),3000]);
 await apply('late-renewal',[state(a,2500,'pro')]);
 expect((await db.query('select plan from user_profiles where user_id=$1',[a])).rows).toEqual([{plan:'free'}]);
});
it('transfers are atomic and retryable across both accounts and their watermarks',async()=>{
 await db.query('delete from user_profiles where user_id=$1',[b]);
 await expect(apply('transfer',[state(a),state(b)])).rejects.toThrow('Billing profile not found');
 expect((await db.query('select * from subscription_events')).rows).toHaveLength(0);
 expect((await db.query('select * from billing_sync_state')).rows).toHaveLength(0);
 await db.query('insert into user_profiles(user_id,plan) values($1,\'free\')',[b]);
 await apply('transfer',[state(a,2000,'free'),state(b,2000,'pro')]);
 expect((await db.query('select plan from user_profiles order by user_id')).rows).toEqual([{plan:'free'},{plan:'pro'}]);
 expect((await apply('transfer',[state(a,4000,'pro')])).rows[0]).toEqual({apply_billing_event:false});
});
it('rejects forged client snapshots and missing provider timestamps',async()=>{
 await expect(apply('bad',[{...state(),observed_at_ms:null}])).rejects.toThrow('Invalid billing snapshot');
 for(const role of ['anon','authenticated']){
  await db.exec('reset role;set role '+role);
  await expect(db.query('select apply_billing_snapshot($1,$2,$3)',[a,state(),2000])).rejects.toThrow('permission denied');
  await expect(db.query('select * from billing_sync_state')).rejects.toThrow('permission denied');
 }
});
function loadMapping(fetcher:typeof fetch=fetch){
 const source=readFileSync(new URL('../../supabase/functions/_shared/billing.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function('Deno','fetch',code+';return {planFromSubscriber,subscriberSnapshot};')({env:{get:(key:string)=>key==='REVENUECAT_ENTITLEMENT'?'pro':'fixture-secret'}},fetcher);
}
it('maps grace periods, cancellation, lifetime and malformed entitlements safely',()=>{
 const {planFromSubscriber:map}=loadMapping();
 const future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 expect(map({subscriber:{entitlements:{pro:{expires_date:past,grace_period_expires_date:future}}}})).toMatchObject({plan:'pro',proUntil:future});
 expect(map({subscriber:{entitlements:{pro:{expires_date:null}}}})).toMatchObject({plan:'pro',proUntil:null,proWillRenew:false});
 expect(map({subscriber:{entitlements:{pro:{expires_date:past}}}})).toMatchObject({plan:'free'});
 expect(()=>map({subscriber:{entitlements:{pro:{}}}})).toThrow('Missing entitlement');
 expect(()=>map({subscriber:{entitlements:{pro:{expires_date:'invalid'}}}})).toThrow('Invalid entitlement');
});
it('requires a valid current provider response and propagates provider outages without granting a plan',async()=>{
 for(const body of [{},{request_date_ms:1000,subscriber:{}},{request_date_ms:0,subscriber:{entitlements:{}}}]){
  const {subscriberSnapshot}=loadMapping(async()=>new Response(JSON.stringify(body)));
  await expect(subscriberSnapshot(a)).rejects.toThrow('Invalid subscriber response');
 }
 const {subscriberSnapshot}=loadMapping(async()=>new Response('{}',{status:503}));
 await expect(subscriberSnapshot(a)).rejects.toThrow('Subscriber lookup failed');
 const valid=loadMapping(async()=>new Response(JSON.stringify({request_date_ms:2000,subscriber:{entitlements:{}}})));
 expect(await valid.subscriberSnapshot(a)).toMatchObject({observedAtMs:2000,state:{plan:'free'}});
});
