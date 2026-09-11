import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
const owner='00000000-0000-0000-0000-000000000001';
const id='00000000-0000-0000-0000-000000000002';
function edge(name:string, opts:{signing?:boolean; foreign?:boolean; noVideo?:boolean; deleteFails?:boolean; saveFails?:boolean; unauthorized?:boolean; follower?:boolean; publicVideo?:boolean}={}) {
  const writes:any[]=[];const calls:any[]=[];
  const sb={from:(table:string)=>{
    let update:any;const query:any={
      select:()=>query,eq:()=>query,in:()=>query,
      update:(value:any)=>{update=value;return query;},
      maybeSingle:async()=>{
        if(update){writes.push({table,...update});return {data:opts.saveFails?null:{id},error:opts.saveFails?{message:'offline'}:null};}
        if(name==='mux-upload-init')return {data:null,error:null};
        return {data:{id,user_id:opts.foreign?'stranger':owner,is_public:true,mux_asset_id:opts.noVideo?null:'asset'},error:null};
      },
      then:(resolve:any)=>{
        if(update){writes.push({table,...update});return Promise.resolve({error:opts.saveFails?{message:'offline'}:null}).then(resolve);}
        const data=table==='user_friends'?(opts.follower?[{friend_id:'author'}]:[]):table==='reels'?[{id,user_id:'author',is_public:!!opts.publicVideo,mux_playback_id:'private'}]:[];
        return Promise.resolve({data,error:null}).then(resolve);
      },
    };return query;
  }};
  const provider=vi.fn(async(url:string,init:any={})=>{
    calls.push({url,method:init.method??'GET'});
    if(init.method==='DELETE')return new Response(null,{status:opts.deleteFails?500:204});
    if(url.endsWith('/uploads'))return Response.json({data:{url:'https://upload.example',id:'upload'}});
    if(init.method==='POST')return Response.json({data:{id:'signed'}});
    return Response.json({data:{playback_ids:[{id:'public',policy:'public'}]}});
  });
  let handler!:(req:Request)=>Promise<Response>;
  const source=readFileSync(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  new Function('Deno','createClient','CORS_HEADERS','requireUser','readJsonBody','muxApiAuth','muxSigningConfig','signPlaybackToken','withRequestTelemetry','fetch','console',code)(
    {env:{get:()=> 'test-config'},serve:(fn:any)=>handler=fn},()=>sb,{},
    async()=>opts.unauthorized?{response:new Response(null,{status:401})}:{userId:owner},
    async(req:Request)=>({body:await req.json()}),()=> 'Basic test',()=>opts.signing?{}:null,
    async()=> 'scoped-token',(_name:string,fn:any)=>fn,provider,{error(){},warn(){}},
  );
  return {writes,calls,provider,request:(body:any)=>handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)}))};
}
it('private uploads fail before any provider request when signing is unavailable',async()=>{
 const h=edge('mux-upload-init');expect((await h.request({passthrough:id,isPublic:false})).status).toBe(503);expect(h.calls).toHaveLength(0);
 expect((await h.request({passthrough:id,isPublic:true})).status).toBe(200);
});
it('visibility does not change the row when signing is missing or the requester is not the owner',async()=>{
 for(const opts of [{},{signing:true,foreign:true}]){const h=edge('mux-set-visibility',opts);expect((await h.request({kind:'reel',id,isPublic:false})).status).toBe(opts.foreign?403:503);expect(h.writes).toHaveLength(0);expect(h.calls).toHaveLength(0);}
});
it('a failed public playback revocation cannot report success or change row visibility',async()=>{
 const h=edge('mux-set-visibility',{signing:true,deleteFails:true});expect((await h.request({kind:'reel',id,isPublic:false})).status).toBe(502);expect(h.writes).toHaveLength(0);expect(h.calls.at(-1).method).toBe('DELETE');
});
it('reconciles playback before committing visibility and reports metadata failures',async()=>{
 const h=edge('mux-set-visibility',{signing:true});const r=await h.request({kind:'reel',id,isPublic:false});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({isPublic:false});expect(h.writes).toEqual([{table:'reels',mux_playback_id:'signed',mux_playback_policy:'signed'},{table:'reels',is_public:false}]);
 const failed=edge('mux-set-visibility',{signing:true,saveFails:true});expect((await failed.request({kind:'reel',id,isPublic:false})).status).toBe(500);expect(failed.writes).toHaveLength(1);
});
it('photo-only visibility changes do not require Mux signing',async()=>{
 const h=edge('mux-set-visibility',{noVideo:true});expect((await h.request({kind:'reel',id,isPublic:false})).status).toBe(200);expect(h.calls).toHaveLength(0);
});
it('token signing rejects missing configuration and omits a strangers private video',async()=>{
 expect((await edge('mux-playback-token').request({items:[{kind:'reel',id}]})).status).toBe(503);
 const r=await edge('mux-playback-token',{signing:true}).request({items:[{kind:'reel',id}]});expect(await r.json()).toEqual({tokens:{}});
 const allowed=await edge('mux-playback-token',{signing:true,follower:true}).request({items:[{kind:'reel',id}]});const body=await allowed.json();expect(body.tokens[id].playback).toBe('scoped-token');expect(body.tokens[id].expiresAt-Date.now()/1000).toBeLessThanOrEqual(900);
});
it.each(['mux-upload-init','mux-set-visibility'])('%s rejects unauthenticated requests before provider and database access',async name=>{
 const h=edge(name,{unauthorized:true,signing:true});expect((await h.request({kind:'reel',id})).status).toBe(401);expect(h.writes).toHaveLength(0);expect(h.calls).toHaveLength(0);
});

it('guests can receive tokens for public signed videos but never private ones',async()=>{
 for(const isPublic of [true,false]){
  const h=edge('mux-playback-token',{signing:true,unauthorized:true,publicVideo:isPublic});
  const body=await (await h.request({items:[{kind:'reel',id}]})).json();
  expect(!!body.tokens[id]).toBe(isPublic);expect(h.writes).toHaveLength(0);
 }
});
