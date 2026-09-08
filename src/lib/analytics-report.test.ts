import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const owner = '10000000-0000-4000-8000-000000000001';
const visitor = '10000000-0000-4000-8000-000000000002';
let db: PGlite;
async function asUser(id = owner) {
 await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`);
}
async function report(days = 30, platform: string | null = null, sort = 'opens') {
 return (await db.query<{ report: any }>('select public.analytics_report($1,$2,$3) report', [days,platform,sort])).rows[0].report;
}
async function seed(event: string, fields: Record<string, unknown> = {}) {
 const result = await db.query<{id:string}>(`insert into public.analytics_events(user_id,anon_id,session_id,event,page,feature,restaurant_id,restaurant_name,duration_ms,platform,properties,created_at,occurred_at,origin)
 values ($1,'anon', $2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now()-make_interval(days=>$11::int),now()-make_interval(days=>$11::int),$12) returning id`,
 [fields.user || visitor,fields.session || 'session',event,fields.page || 'search_main',fields.feature || null,fields.restaurant || null,fields.restaurant || null,fields.duration || null,fields.platform || 'web',JSON.stringify(fields.properties || {}),fields.age || 0,fields.origin || 'client']);
 return result.rows[0].id;
}
beforeAll(async()=>{
 db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 insert into auth.users values ('${owner}'),('${visitor}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
 create function public.is_app_admin() returns boolean language sql stable as $$ select auth.uid()='${owner}'::uuid $$;
 create table public.user_profiles(user_id uuid,display_name text,username text);
 grant select on public.user_profiles to authenticated;`);
 for(const file of ['20260907203935_owner_analytics.sql','20260908004339_analytics_restaurant_sources.sql','20260908013324_analytics_exploration.sql']) {
  await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'));
 }
},30000);
beforeEach(async()=>{await db.exec('reset role; truncate public.analytics_events, public.analytics_rates;');});
afterAll(async()=>{await db?.close();});

describe('actual analytics collector, RLS and report SQL',()=>{
 it('accepts an ordinary user action, deduplicates retries, and prevents spoofing/read access',async()=>{
  const row = {id:crypto.randomUUID(),user_id:visitor,anon_id:'anon',session_id:'s',event:'restaurant_saved',occurred_at:new Date().toISOString(),restaurant_id:'own-1',platform:'web',origin:'server',properties:{data_source:'own_data'}};
  await asUser(visitor);
  await db.query('select analytics_collect($1::jsonb)',[JSON.stringify([row,row,{...row,id:crypto.randomUUID(),user_id:owner}])]);
  expect((await db.query('select * from analytics_events')).rows).toEqual([]);
  await expect(report()).rejects.toThrow('Admins only');
  await expect(db.query('select * from analytics_user_activity($1)',[owner])).rejects.toThrow('Admins only');
  await asUser();
  const rows=(await db.query('select user_id,origin from analytics_events')).rows;
  expect(rows).toEqual([{user_id:visitor,origin:'client'}]);
  expect((await report()).restaurants[0]).toMatchObject({saves:1,sources:[{data_source:'own_data',saves:1}]});
 });
 it('reconciles restaurant totals and source counts for every displayed action',async()=>{
  for(const source of ['google_places','own_data','mixed','unknown']) {
   for(const event of ['restaurant_returned','restaurant_seen','restaurant_search_selected','restaurant_opened','restaurant_saved','restaurant_unsaved','restaurant_rated','restaurant_shared','restaurant_outbound']) {
    await seed(event,{restaurant:'cottage',properties:source==='unknown'?{}:{data_source:source}});
   }
  }
  await seed('api_request',{restaurant:'cottage',properties:{provider:'google_places',endpoint:'details',status:200}});
  await asUser();const r=await report();const restaurant=r.restaurants[0];
  for(const metric of ['returned','seen','searches','opens','saves','unsaves','ratings','shares','outbound']) {
   expect(restaurant[metric]).toBe(4);
   expect(restaurant.sources.reduce((sum:number,s:any)=>sum+s[metric],0)).toBe(restaurant[metric]);
  }
  expect(restaurant).toMatchObject({visitors:1,api_calls:1,cost:null});
  expect(restaurant.sources).toHaveLength(4);
  expect(r.overview).toMatchObject({saves:4,api_calls:1,unpriced_calls:1});
 });
 it('reports pages, paths, active time, features, search outcomes and filters',async()=>{
  await seed('page_view',{page:'home'});
  await db.exec("update analytics_events set occurred_at=now()-interval '1 minute'");
  await seed('page_view');await seed('page_engagement',{duration:15000});
  await seed('feature_seen',{feature:'restaurant_search'});await seed('feature_used',{feature:'restaurant_search'});
  await seed('search_completed',{properties:{result_count:0,city:'Westport',cuisine:'all'}});
  for(const event of ['onboarding_step','billing_event','ai_feedback','client_error']) await seed(event,{properties:{stage:'test'}});
  await seed('page_view',{platform:'ios',session:'native'});
  await seed('page_view',{age:40,session:'old'});
  await asUser();const r=await report(30,'web');
  expect(r.overview).toMatchObject({active_users:1,dau:1,wau:1,sessions:1,page_views:2,errors:1});
  expect(r.pages.find((p:any)=>p.page==='search_main')).toMatchObject({views:1,users:1,active_ms:15000});
  expect(r.paths).toContainEqual({source:'home',destination:'search_main',transitions:1});
  expect(r.features[0]).toMatchObject({exposures:1,uses:1,users:1});
  expect(r.searches[0]).toMatchObject({searches:1,empty:1,avg_results:0});
  expect(r.coverage[0]).toMatchObject({city:'Westport',empty:1});
  expect(r.outcomes).toHaveLength(4);
  expect(r.users[0]).toMatchObject({user_id:visitor,views:2,sessions:1});
  expect(r.daily.reduce((s:number,d:any)=>s+d.views,0)).toBe(2);
  expect((await report(30,'ios')).overview.page_views).toBe(1);
 });
 it('prices each exact mask and effective date, counts failures, and excludes cache hits from billable calls',async()=>{
  await db.exec("insert into analytics_rates values ('google_places','details','id',10,now()-interval '2 days'),('google_places','details','id',20,now()-interval '1 day'),('google_places','details','id,name',30,now()-interval '1 day')");
  await seed('api_request',{duration:100,properties:{provider:'google_places',endpoint:'details',field_mask:'id',status:200}});
  await seed('api_request',{duration:300,properties:{provider:'google_places',endpoint:'details',field_mask:'id,name',status:503}});
  await seed('api_request',{properties:{provider:'mapbox',endpoint:'map_resource',status:0}});
  await seed('api_cache_hit',{properties:{provider:'google_places',endpoint:'details'}});
  await asUser();const r=await report();
  expect(r.overview).toMatchObject({api_calls:3,api_failures:2,unpriced_calls:1,cache_hits:1,estimated_cost:.05});
  expect(r.apis).toHaveLength(3);
  expect(r.apis.find((a:any)=>a.field_mask==='id,name')).toMatchObject({calls:1,failures:1,avg_ms:300,p95_ms:300,cost:.03});
 });
 it('uses the selected restaurant ranking, including the order of returned rows',async()=>{
  await seed('restaurant_opened',{restaurant:'most-visited'});await seed('restaurant_opened',{restaurant:'most-visited'});
  await seed('restaurant_saved',{restaurant:'most-saved'});
  await asUser();expect((await report(30,null,'saves')).restaurants[0].restaurant_id).toBe('most-saved');
  expect((await report()).restaurants[0].restaurant_id).toBe('most-visited');
 });
 it('measures eligible return cohorts and excludes API-only sessions from session quality',async()=>{
  await seed('page_view',{age:9,session:'first'});await seed('page_view',{age:8,session:'day1'});await seed('page_view',{age:2,session:'day7'});
  await seed('page_engagement',{session:'day7',duration:12000});
  await seed('api_request',{session:'background',properties:{status:200}});
  await asUser();const r=await report();
  expect(r.retention).toEqual(expect.arrayContaining([{day:1,eligible:1,returned:1},{day:7,eligible:1,returned:1},{day:30,eligible:0,returned:0}]));
  expect(r.session_quality).toMatchObject({single_page_sessions:3});
 });
 it('paginates tied timestamps without losing or repeating events',async()=>{
  await db.exec(`insert into analytics_events(user_id,anon_id,session_id,event,platform) select '${visitor}','anon','s','page_view','web' from generate_series(1,105)`);
  await asUser();const first=(await db.query<any>('select * from analytics_user_activity($1)',[visitor])).rows;
  expect(first).toHaveLength(100);const last=first.at(-1);
  const next=(await db.query<any>('select * from analytics_user_activity($1,$2,$3)',[visitor,last.created_at,last.id])).rows;
  expect(next).toHaveLength(5);expect(new Set([...first,...next].map(r=>r.id)).size).toBe(105);
 });
});

async function exploration(actor:string|null=null,platform:string|null=null) {
 return (await db.query<{r:any}>('select analytics_exploration(30,$1,$2) r',[platform,actor])).rows[0].r;
}
let explorationSequence=0;
const explorationBase=Date.now()-3600000;
async function explorationSeed(event:string,fields:Record<string,unknown>={}) {
 const id=await seed(event,fields);
 await db.query('update analytics_events set occurred_at=$1 where id=$2',[new Date(explorationBase + explorationSequence++*1000-Number(fields.age||0)*86400000).toISOString(),id]);
}
describe('exploration habits SQL',()=>{
 it('separates individual habits from everyone and retains the all-user baseline',async()=>{
  await explorationSeed('page_view',{page:'home'});await explorationSeed('page_engagement',{page:'home',duration:15000});
  await explorationSeed('page_view',{page:'search_main'});await explorationSeed('page_engagement',{page:'search_main',duration:30000});
  await explorationSeed('page_view',{page:'home',user:owner});await explorationSeed('page_engagement',{page:'home',user:owner,duration:45000});
  await asUser();const all=await exploration();const person=await exploration(visitor);
  expect(all.summary).toMatchObject({visitors:2,visits:3,pages:2,active_ms:90000,timed_visits:3});
  expect(person.summary).toMatchObject({visitors:1,visits:2,active_ms:45000});
  expect(person.baseline.find((p:any)=>p.page==='home').avg_active_ms).toBe(30000);
  expect(person.pages.find((p:any)=>p.page==='home')).toMatchObject({avg_active_ms:15000,entries:1,last_stops:0});
  expect(person.transitions).toEqual([{source:'home',destination:'search_main',transitions:1,visitors:1}]);
  expect(person.sessions).toHaveLength(1);expect(person.sessions[0].steps.map((s:any)=>s.page)).toEqual(['home','search_main']);
  expect(all.session_summary.sessions).toBe(2); // same session string, different actors
  expect(person.rhythm.reduce((sum:number,r:any)=>sum+r.visits,0)).toBe(2);
 });
 it('ties late engagement to its original visit instead of a later return to the same page',async()=>{
  const first='a0000000-0000-4000-8000-000000000001',second='a0000000-0000-4000-8000-000000000002';
  await explorationSeed('page_view',{page:'home',properties:{visit_id:first}});
  await explorationSeed('page_view',{page:'home',properties:{visit_id:second}});
  await explorationSeed('page_engagement',{page:'home',duration:70000,properties:{visit_id:first}});
  await explorationSeed('page_engagement',{page:'home',duration:5000,properties:{visit_id:second}});
  await explorationSeed('page_engagement',{page:'missing',duration:15000});
  await asUser();const r=await exploration(visitor);
  expect(r.sessions[0].steps.map((s:any)=>s.active_ms)).toEqual([70000,5000]);
  expect(r.pages[0]).toMatchObject({views:2,repeat_visitors:1,long_visits:1,brief_visits:1,avg_active_ms:37500});
  expect(r.unmatched_segments).toBe(1);expect(r.summary.active_ms).toBe(75000);
 });
 it('keeps untimed visits distinct from brief visits and respects date/platform filters',async()=>{
  await explorationSeed('page_view',{page:'home'});
  await explorationSeed('page_view',{page:'map',platform:'ios'});await explorationSeed('page_engagement',{page:'map',platform:'ios',duration:5000});
  await explorationSeed('page_view',{page:'profile',age:40});
  await asUser();const r=await exploration(null,'web');
  expect(r.summary).toMatchObject({visits:1,timed_visits:0,active_ms:0});
  expect(r.pages[0]).toMatchObject({avg_active_ms:null,brief_visits:0,long_visits:0});
  expect((await exploration(null,'ios')).pages[0]).toMatchObject({page:'map',avg_active_ms:5000});
  expect((await exploration(null,'server')).summary.visits).toBe(0);
 });
 it('searches visitors by public name and restricts both new RPCs to owners',async()=>{
  await db.query('insert into user_profiles values ($1,$2,$3)',[visitor,'Taylor Explorer','explorer']);
  await explorationSeed('page_view');await asUser();
  const people=(await db.query<{r:any}>('select analytics_exploration_visitors(30,null,$1) r',['Taylor'])).rows[0].r;
  expect(people).toHaveLength(1);expect(people[0]).toMatchObject({actor:visitor,username:'explorer'});
  await asUser(visitor);await expect(exploration()).rejects.toThrow('Admins only');
  await expect(db.query('select analytics_exploration_visitors()')).rejects.toThrow('Admins only');
 });
});
