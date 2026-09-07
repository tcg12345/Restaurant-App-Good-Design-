import { describe, expect, it, vi, beforeEach } from 'vitest';
import { classifyApi, pageName, safeProperties } from '../../supabase/functions/_shared/analytics-schema';
import { instrumentedFetch, withRequestTelemetry, setTelemetryUser } from '../../supabase/functions/_shared/api-telemetry';

describe('analytics privacy and classification',()=>{
 it('does not expose search parameters, API keys, usernames or message paths',()=>{
  expect(classifyApi('https://places.googleapis.com/v1/places:searchText?key=SECRET')).toEqual({provider:'google_places',endpoint:'search_text',restaurant_id:null});
  expect(classifyApi('https://abc.supabase.co/rest/v1/messages?body=PRIVATE')).toEqual({provider:'supabase',endpoint:'get:messages',restaurant_id:null});
  expect(pageName('/user/private-handle?token=secret')).toBe('user_detail');
  expect(pageName('/messages?conversation=private')).toBe('messages');
  expect(classifyApi('https://abc.supabase.co/rest/v1/rpc/analytics_collect')).toBeNull();
 });
 it('attributes only restaurant-specific calls, including photos',()=>{
  expect(classifyApi('https://places.googleapis.com/v1/places/ChIJabc/photos/photo1/media')?.restaurant_id).toBe('ChIJabc');
  expect(classifyApi('https://places.googleapis.com/v1/places:searchNearby')?.restaurant_id).toBeNull();
 });
 it('drops unapproved fields and scrubs common identifiers',()=>{
  const clean=safeProperties({query:'email me@example.com or 203-555-1234',prompt:'private',token:'secret',coordinates:[1,2],result_count:5, duration:Infinity});
  expect(clean).toEqual({query:'email [email] or [number]',result_count:5});
 });
});

describe('server telemetry',()=>{
 beforeEach(()=>{vi.restoreAllMocks();vi.stubGlobal('Deno',{env:{get:(key:string)=>({ANALYTICS_ENABLED:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret'} as any)[key]}});});
 it('keeps concurrent users and request costs isolated',async()=>{
  const writes:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:any,init:any)=>{
   if(String(input).includes('/analytics_events')){writes.push(...JSON.parse(init.body));return new Response(null,{status:201});}
   await new Promise(r=>setTimeout(r,String(input).includes('place-a')?15:1));
   return new Response('{}',{status:200});
  }));
  const run=withRequestTelemetry('restaurant-test',async(req)=>{const id=new URL(req.url).pathname.slice(1);setTelemetryUser(id);await instrumentedFetch(`https://places.googleapis.com/v1/places/${id}`,{headers:{'X-Goog-Api-Key':'never-log-this','X-Goog-FieldMask':'id,displayName'}});return new Response('ok');});
  await Promise.all([run(new Request('https://app/place-a')),run(new Request('https://app/place-b'))]);
  expect(writes).toHaveLength(2);
  for(const row of writes){expect(row.user_id).toBe(row.restaurant_id);expect(row.origin).toBe('server');expect(row.properties.field_mask).toBe('id,displayName');}
  expect(JSON.stringify(writes)).not.toContain('never-log-this');
 });
 it('records failures and preserves the original response when the sink fails',async()=>{
  const mock=vi.fn(async(input:any)=>{if(String(input).includes('analytics_events'))throw new Error('sink down');return new Response('unavailable',{status:503});});
  vi.stubGlobal('fetch',mock);
  const handler=withRequestTelemetry('search',async()=>instrumentedFetch('https://places.googleapis.com/v1/places:searchText'));
  expect((await handler(new Request('https://app/'))).status).toBe(503);
  expect(mock).toHaveBeenCalledTimes(2);
 });
});
