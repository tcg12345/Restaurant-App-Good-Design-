import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import ts from 'typescript';
import { expect, it } from 'vitest';
const owner='00000000-0000-0000-0000-000000000001', id='00000000-0000-0000-0000-000000000002';
function fixture(fail=false) {
 const writes:any[]=[];
 const sb={from:(table:string)=>{
  let update:any;const filters:Record<string,string>={};
  const result=()=>{
   if(update){if(!fail&&filters.id===id&&filters.user_id===owner)writes.push({table,...update});return {data:filters.user_id===owner?[{id}]:[],error:fail?{message:'database unavailable'}:null};}
   return {data:table==='reels'?{user_id:owner}:null,error:null};
  };
  const q:any={select:()=>q,eq:(key:string,v:string)=>{filters[key]=v;return q},update:(v:any)=>{update=v;return q},maybeSingle:async()=>result(),then:(fn:any)=>Promise.resolve(result()).then(fn)};return q;
 }};
 let handler!:(r:Request)=>Promise<Response>;
 const source=readFileSync(new URL('../../supabase/functions/mux-webhook/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 new Function('Deno','createClient','withRequestTelemetry','console',code)({env:{get:()=> 'test-secret'},serve:(fn:any)=>handler=fn},()=>sb,(_:string,fn:any)=>fn,{warn(){},error(){}});
 return {writes,request:async(data:any,type='video.asset.ready',timestamp=String(Math.floor(Date.now()/1000)),valid=true)=>{
  const body=JSON.stringify({type,data});const sig=createHmac('sha256','test-secret').update(`${timestamp}.${body}`).digest('hex');
  return handler(new Request('https://example.invalid',{method:'POST',headers:{'Mux-Signature':`t=${timestamp},v1=${valid?sig:'invalid'}`},body}));
 }};
}
const ready={id:'asset',passthrough:`${owner}:${id}`,duration:2.083333,playback_ids:[{id:'playback',policy:'signed'}]};
it('owner-bound ready events update the correct row and signed playback policy',async()=>{
 const f=fixture();expect((await f.request(ready)).status).toBe(200);expect(f.writes).toEqual([{table:'reels',mux_status:'ready',mux_asset_id:'asset',mux_playback_id:'playback',mux_playback_policy:'signed',duration_seconds:2.083333}]);
});
it('database failures return a retryable response rather than acknowledging lost updates',async()=>{
 const f=fixture(true);expect((await f.request(ready)).status).toBe(500);expect(f.writes).toHaveLength(0);
});
it('upload-created events use the owner binding inside new asset settings',async()=>{
 const f=fixture();expect((await f.request({id:'upload',asset_id:'asset',new_asset_settings:{passthrough:`${owner}:${id}`}},'video.upload.asset_created')).status).toBe(200);expect(f.writes).toEqual([{table:'reels',mux_asset_id:'asset'}]);
});
it('unbound events cannot target rows through client-writable provider IDs',async()=>{
 const f=fixture();await f.request({...ready,passthrough:'',upload_id:'known-upload'});expect(f.writes).toHaveLength(0);
});
it('legacy bare row identifiers still work without trusting stored asset IDs',async()=>{
 const f=fixture();expect((await f.request({...ready,passthrough:id})).status).toBe(200);expect(f.writes).toHaveLength(1);
});
it('invalid signatures, stale events and nonnumeric signed timestamps are denied',async()=>{
 for(const [timestamp,valid]of[[String(Math.floor(Date.now()/1000)),false],['1',true],['NaN',true]]as const){const f=fixture();expect((await f.request(ready,'video.asset.ready',timestamp,valid)).status).toBe(401);expect(f.writes).toHaveLength(0);}
});
