process.on('uncaughtException', e => { console.error(e.message, e.detail || '', e.position || ''); process.exit(1); });
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create table public.user_profiles(user_id uuid primary key, display_name text, username text); grant select on public.user_profiles to authenticated; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values ('${owner}'),('${user}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role; create function public.is_app_admin() returns boolean language sql stable as $$ select auth.uid()='${owner}'::uuid $$;`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20260907203935_owner_analytics.sql',import.meta.url),'utf8'));
const asRole=async(role,id,fn)=>{await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${id || ''}',false);`);try{return await fn();}finally{await db.exec('reset role');}};
const base={id:crypto.randomUUID(),occurred_at:new Date().toISOString(),anon_id:'test-install',session_id:'test-session',event:'page_view',page:'home',platform:'web',app_version:'test',properties:{}};
console.log('Checking guest ingestion');
await asRole('anon',null,async()=>{

 await db.query('select analytics_collect($1::jsonb)',[JSON.stringify([base])]); console.log('guest batch accepted');
 await db.query('select analytics_collect($1::jsonb)',[JSON.stringify([base])]); console.log('guest batch accepted');
 assert.equal((await db.query('select * from analytics_events')).rows.length,0,'guests cannot read any events');
 await assert.rejects(()=>db.query('select analytics_report(30,null,\'opens\')'));
});
assert.equal((await db.query('select count(*)::int count from analytics_events')).rows[0].count,1,'retries deduplicate');
console.log('Checking user ingestion');
await asRole('authenticated',user,async()=>{
 await db.query('select analytics_collect($1::jsonb)',[JSON.stringify([{...base,id:crypto.randomUUID(),user_id:user,event:'restaurant_opened',restaurant_id:'place-1',restaurant_name:'Example restaurant'}])]);
 assert.equal((await db.query('select * from analytics_events')).rows.length,0,'ordinary users cannot read even own telemetry');
 await db.query('select analytics_collect($1::jsonb)',[JSON.stringify([{...base,id:crypto.randomUUID(),user_id:owner,event:'page_view'}])]);
 await assert.rejects(()=>db.query("select analytics_report(30,null,'opens')"));
 await assert.rejects(()=>db.query("select analytics_user_activity('test-install')"));
 await assert.rejects(()=>db.query("insert into analytics_events(anon_id,session_id,event,origin,user_id) values('x','y','api_request','server',$1)",[user]));
 await assert.rejects(()=>db.query("insert into analytics_events(anon_id,session_id,event,platform,user_id) values('x','y','page_view','web',$1)",[owner]));
 await assert.rejects(()=>db.query("insert into analytics_events(anon_id,session_id,event,platform,user_id,properties) values('x','y','api_request','web',$1,'{\"status\":\"oops\"}')",[user]));
 await assert.rejects(()=>db.query('select analytics_prune()'));
 await assert.rejects(()=>db.query("insert into analytics_rates(provider,endpoint,usd_per_1000) values('google_places','details',1)"));
});
await db.exec(`insert into analytics_rates(provider,endpoint,usd_per_1000,effective_from) values ('google_places','details',20,now()-interval '1 day'); insert into analytics_events(anon_id,session_id,event,origin,properties,duration_ms) values ('server:x','req1','api_request','server','{"provider":"google_places","endpoint":"details","status":200}',100);`);
await asRole('authenticated',owner,async()=>{
 const {rows}=await db.query("select analytics_report(30,null,'opens') report");const report=rows[0].report;
 assert.equal(report.overview.page_views,1);assert.equal(report.restaurants[0].opens,1);assert.equal(Number(report.overview.estimated_cost),.02);assert.equal(report.apis[0].origin,'server');
 assert.equal((await db.query('select * from analytics_user_activity($1)',[user])).rows.length,1);
 await assert.rejects(()=>db.query("select analytics_report(999,null,'opens')"));
 console.log('PASS: real PostgreSQL migration, owner access, guest/user denial, event deduplication, identity spoofing denial, server-origin spoofing denial, malformed metrics denial, read-only rates, pruning access, report aggregates, configured cost, timeline.');
});
await db.close();
