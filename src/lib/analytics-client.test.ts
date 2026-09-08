// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase',()=>({supabaseConfigured:true,supabase:{rpc}}));
vi.mock('./native-oauth',()=>({isNativeRuntime:()=>false}));
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_ANALYTICS_ENABLED','true');vi.stubEnv('VITE_ANALYTICS_SEARCH_TERMS','false');vi.stubEnv('VITE_ANALYTICS_INCLUDE_ADMINS','false');localStorage.clear();rpc.mockReset();rpc.mockResolvedValue({error:null});});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe('client analytics lifecycle',()=>{
 it('sends a save immediately even when an earlier request is in flight',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('user',false);a.setAnalyticsPage('/restaurant/jungsik');
  let finish!: (value:{error:null})=>void;
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  a.track('page_view');const first=a.flushAnalytics();
  a.trackRestaurant('restaurant_saved','jungsik','Jungsik');
  expect(rpc).toHaveBeenCalledTimes(1);
  finish({error:null});await first;
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[1][1].events).toContainEqual(expect.objectContaining({event:'restaurant_saved',restaurant_id:'jungsik'}));
  await a.flushAnalytics();
 });
 it('flushes a final save before sign-out, including when another batch is in flight',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('user',false);a.setAnalyticsPage('/restaurant/cottage');
  let finish!: (value: {error:null})=>void;
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  a.track('page_view');const first=a.flushAnalytics();
  a.trackRestaurant('restaurant_saved','cottage','The Cottage');
  const exiting=a.flushAnalyticsBeforeSignOut();
  expect(rpc).toHaveBeenCalledTimes(1);
  finish({error:null});await first;await exiting;
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[1][1].events).toEqual([expect.objectContaining({event:'restaurant_saved',user_id:'user',restaurant_id:'cottage'})]);
 });
 it('lets sign-out proceed when analytics stalls and does not drain under the next account',async()=>{
  vi.useFakeTimers();
  const a=await import('./analytics');a.setAnalyticsIdentity('user',false);
  let finish!: (value: {error:null})=>void;
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  a.track('page_view');const first=a.flushAnalytics();a.trackRestaurant('restaurant_saved','cottage');
  const exiting=a.flushAnalyticsBeforeSignOut();
  await vi.advanceTimersByTimeAsync(1500);await exiting;
  a.setAnalyticsIdentity('next-user',false);finish({error:null});await first;
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('does not repeatedly retry a failed batch while signing out',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('user',false);a.track('page_view');
  rpc.mockResolvedValue({error:{message:'offline'}});
  await a.flushAnalyticsBeforeSignOut();expect(rpc).toHaveBeenCalledTimes(1);
 });
 it('retries the same event ID, strips private properties and keeps search text disabled',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity(null,false);a.setAnalyticsPage('/search/main?token=secret');
  a.track('search_completed',{properties:{query:'private search',result_count:4,prompt:'do not collect'}});
  rpc.mockResolvedValueOnce({error:{message:'offline'}});
  await a.flushAnalytics();await a.flushAnalytics();
  const first=rpc.mock.calls[0][1].events[0], second=rpc.mock.calls[1][1].events[0];
  expect(first.id).toBe(second.id);expect(first.properties).toEqual({result_count:4});expect(first.page).toBe('search_main');expect(first.user_id).toBeNull();
 });
 it('clears buffered events on account switches and stamps the authenticated actor',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('old-user',false);a.track('page_view');
  a.setAnalyticsIdentity('new-user',false);a.track('page_view');await a.flushAnalytics();
  expect(rpc.mock.calls[0][1].events).toHaveLength(1);expect(rpc.mock.calls[0][1].events[0].user_id).toBe('new-user');
 });
 it('respects opt-out, admin exclusion, and private admin routes',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('owner',true);a.track('page_view');await a.flushAnalytics();expect(rpc).not.toHaveBeenCalled();
  a.setAnalyticsIdentity('user',false);a.track('page_view');a.setAnalyticsOptOut(true);await a.flushAnalytics();expect(rpc).not.toHaveBeenCalled();
  a.setAnalyticsOptOut(false);a.setAnalyticsPage('/admin/analytics');a.track('page_view');await a.flushAnalytics();expect(rpc).not.toHaveBeenCalled();
 });
});

describe('analytics audit regressions',()=>{
 it('keeps a critical save when hundreds of API events saturate the buffer',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('user',false);
  let finish!: (value:{error:null})=>void;
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  a.track('page_view');const first=a.flushAnalytics();
  for(let i=0;i<350;i++) a.track('api_request',{properties:{status:200}});
  a.trackRestaurant('restaurant_saved','saved');
  finish({error:null});await first;await a.flushAnalytics();
  expect(rpc.mock.calls.flatMap(([,args])=>args.events)).toContainEqual(expect.objectContaining({event:'restaurant_saved',restaurant_id:'saved'}));
 });
 it('bounds long field-mask batches so keepalive and collector payload limits are respected',async()=>{
  const a=await import('./analytics');a.setAnalyticsIdentity('user',false);
  for(let i=0;i<40;i++) a.track('api_request',{properties:{provider:'google_places',field_mask:'x'.repeat(1200),source:'s'.repeat(160),endpoint:'d'.repeat(160)}});
  await a.flushAnalytics();await a.flushAnalytics();
  expect(rpc.mock.calls.flatMap(([,args])=>args.events)).toHaveLength(40);
  for(const [,args] of rpc.mock.calls) expect(new TextEncoder().encode(JSON.stringify(args)).byteLength).toBeLessThan(48*1024);
 });
 it('preserves data origin across returned, opened and saved events without inventing API requests',async()=>{
  const a=await import('./analytics');const p=await import('./restaurant-provenance');
  a.setAnalyticsIdentity('user',false);
  p.rememberRestaurantSource('google','google_places');p.rememberRestaurantSource('catalog','own_data');
  for(const id of ['google','catalog','old']) {
   a.trackRestaurant('restaurant_returned',id);a.trackRestaurant('restaurant_opened',id);a.trackRestaurant('restaurant_saved',id);
  }
  await a.flushAnalytics();await a.flushAnalytics();
  const rows=rpc.mock.calls.flatMap(([,args])=>args.events);
  for(const [id,source] of [['google','google_places'],['catalog','own_data'],['old','unknown']]) {
   expect(rows.filter(r=>r.restaurant_id===id)).toHaveLength(3);
   expect(rows.filter(r=>r.restaurant_id===id).every(r=>r.properties.data_source===source)).toBe(true);
  }
  expect(rows.some(r=>r.event==='api_request')).toBe(false);
 });
});
