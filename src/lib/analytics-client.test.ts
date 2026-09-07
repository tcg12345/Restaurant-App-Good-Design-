// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./supabase',()=>({supabaseConfigured:true,supabase:{rpc}}));
vi.mock('./native-oauth',()=>({isNativeRuntime:()=>false}));
beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_ANALYTICS_ENABLED','true');vi.stubEnv('VITE_ANALYTICS_SEARCH_TERMS','false');vi.stubEnv('VITE_ANALYTICS_INCLUDE_ADMINS','false');localStorage.clear();rpc.mockReset();rpc.mockResolvedValue({error:null});});
afterEach(()=>{vi.unstubAllEnvs();});
describe('client analytics lifecycle',()=>{
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
