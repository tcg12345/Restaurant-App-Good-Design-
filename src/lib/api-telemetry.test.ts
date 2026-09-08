// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const {track, context} = vi.hoisted(()=>({track:vi.fn(),context:{page:'search_main',session_id:'session',user_id:'first'}}));
vi.mock('./analytics',()=>({analyticsEnabled:true,track,trackRestaurant:vi.fn(),analyticsContext:()=>({...context})}));
beforeEach(()=>{vi.resetModules();track.mockReset();context.page='search_main';context.user_id='first';});
afterEach(()=>{vi.unstubAllGlobals();});
describe('browser request attribution',()=>{
 it('preserves initiation page, method, mask, status and latency across navigation',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{context.page='profile';return new Response('ok',{status:200});}));
  const {installApiTelemetry}=await import('./api-telemetry');installApiTelemetry();
  expect((await window.fetch(new Request('https://places.googleapis.com/v1/places/google',{headers:{'X-Goog-FieldMask':'id,displayName'}}))).status).toBe(200);
  expect(track).toHaveBeenCalledWith('api_request',expect.objectContaining({page:'search_main',restaurant_id:'google',properties:expect.objectContaining({status:200,source:'search_main',field_mask:'id,displayName'})}));
 });
 it('does not attribute an in-flight request to the next account',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{context.user_id='second';return new Response('ok');}));
  const {installApiTelemetry}=await import('./api-telemetry');installApiTelemetry();
  await window.fetch('https://places.googleapis.com/v1/places/google');expect(track).not.toHaveBeenCalled();
 });
 it('preserves a failed request and records status zero',async()=>{
  const failure=new Error('offline');vi.stubGlobal('fetch',vi.fn(async()=>{throw failure;}));
  const {installApiTelemetry}=await import('./api-telemetry');installApiTelemetry();
  await expect(window.fetch('https://places.googleapis.com/v1/places/google')).rejects.toBe(failure);
  expect(track).toHaveBeenCalledWith('api_request',expect.objectContaining({properties:expect.objectContaining({status:0})}));
 });
 it('telemetry failures cannot turn a successful product request into an error',async()=>{
  track.mockImplementation(()=>{throw new Error('sink failed');});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('ok')));
  const {installApiTelemetry}=await import('./api-telemetry');installApiTelemetry();
  expect(await (await window.fetch('https://places.googleapis.com/v1/places/google')).text()).toBe('ok');
 });
});
