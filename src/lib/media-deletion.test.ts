import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
const owner='00000000-0000-0000-0000-000000000001',id='00000000-0000-0000-0000-000000000002';
function edge(opts:{post?:boolean;legacy?:boolean;foreign?:boolean;missing?:boolean;assetForeign?:boolean;deleteFails?:boolean;pending?:boolean;cancelRace?:boolean;unauthorized?:boolean;photo?:boolean;storageFails?:boolean;dbFails?:boolean}={}){
 const calls:string[]=[];let cancelled=false;let removing=false;
 const sb={from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,delete:()=>{removing=true;return q},maybeSingle:async()=>({data:opts.missing?null:{id,user_id:opts.foreign?'victim':owner,video_path:opts.photo?`${owner}/test.jpg`:null,mux_asset_id:opts.photo||opts.pending?null:'asset',mux_upload_id:opts.pending?'upload':null},error:null}),then:(fn:any)=>{if(removing)calls.push('delete-row');return Promise.resolve({data:!removing&&table==='post_items'?[{id,mux_asset_id:'asset'}]:null,error:opts.dbFails?{message:'offline'}:null}).then(fn)}};return q},storage:{from:()=>({remove:async()=>{calls.push('delete-storage');return {error:opts.storageFails?{message:'offline'}:null}}})}};
 const provider=async(url:string,init:any={})=>{
  const method=init.method||'GET';calls.push(`${method} ${url.split('/v1')[1]}`);
  if(url.endsWith('/cancel')){cancelled=true;return new Response(null,{status:opts.cancelRace?409:200});}
  if(url.includes('/uploads/'))return Response.json({data:{new_asset_settings:{passthrough:`${owner}:${id}`},status:cancelled&&opts.cancelRace?'asset_created':'waiting',asset_id:cancelled&&opts.cancelRace?'asset':undefined}});
  if(method==='DELETE')return new Response(null,{status:opts.deleteFails?500:204});
  return Response.json({data:{passthrough:opts.assetForeign?'victim':opts.legacy?id:`${owner}:${id}`}});
 };
 let handler!:(r:Request)=>Promise<Response>;
 const source=readFileSync(new URL('../../supabase/functions/delete-media/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const helperSource=readFileSync(new URL('../../supabase/functions/_shared/mux-ownership.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
 const helperCode=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const owns=new Function('fetch',helperCode+'; return muxBelongsToRow;')(provider);
 new Function('Deno','fetch','createClient','withRequestTelemetry','CORS_HEADERS','requireUser','readJsonBody','muxApiAuth','MUX_API','muxBelongsToRow','console',code)({env:{get:()=> 'config'},serve:(fn:any)=>handler=fn},provider,()=>sb,(_:string,fn:any)=>fn,{},async()=>opts.unauthorized?{response:new Response(null,{status:401})}:{userId:owner},async(r:Request)=>({body:await r.json()}),()=> 'Basic test','https://api.mux.com/video/v1',owns,{error(){}});
 return {calls,request:()=>handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({kind:opts.post?'post':'reel',id})}))};
}
it('deletes the verified hosted asset before deleting its app row',async()=>{
 const e=edge();expect((await e.request()).status).toBe(200);expect(e.calls).toEqual(['GET /assets/asset','DELETE /assets/asset','delete-row']);
});
it('denies foreign rows and forged provider asset references',async()=>{
 const foreign=edge({foreign:true});expect((await foreign.request()).status).toBe(403);expect(foreign.calls).toHaveLength(0);
 const forged=edge({assetForeign:true});expect((await forged.request()).status).toBe(502);expect(forged.calls).toEqual(['GET /assets/asset']);
});
it('keeps the row when provider deletion fails so the owner can retry',async()=>{
 const e=edge({deleteFails:true});expect((await e.request()).status).toBe(502);expect(e.calls).not.toContain('delete-row');
});
it('cancels an unfinished upload before removing its app row',async()=>{
 const e=edge({pending:true});expect((await e.request()).status).toBe(200);expect(e.calls).toEqual(['GET /uploads/upload','PUT /uploads/upload/cancel','delete-row']);
});
it('handles upload completion racing cancellation by deleting the resulting asset',async()=>{
 const e=edge({pending:true,cancelRace:true});expect((await e.request()).status).toBe(200);expect(e.calls).toEqual(['GET /uploads/upload','PUT /uploads/upload/cancel','GET /uploads/upload','GET /assets/asset','DELETE /assets/asset','delete-row']);
});
it('rejects unauthenticated calls and treats already-deleted rows idempotently',async()=>{
 const e=edge({unauthorized:true});expect((await e.request()).status).toBe(401);expect(e.calls).toHaveLength(0);
 const absent=edge({missing:true});expect((await absent.request()).status).toBe(200);expect(absent.calls).toHaveLength(0);
});
it('photo deletion cleans storage and reports partial failure rather than claiming success',async()=>{
 const e=edge({photo:true});expect((await e.request()).status).toBe(200);expect(e.calls).toEqual(['delete-storage','delete-row']);
 const failed=edge({photo:true,storageFails:true});expect((await failed.request()).status).toBe(502);expect(failed.calls).toEqual(['delete-storage']);
});

it('post deletion verifies and removes its owned hosted video before deleting the parent',async()=>{
 const e=edge({post:true});expect((await e.request()).status).toBe(200);expect(e.calls).toEqual(['GET /assets/asset','DELETE /assets/asset','delete-row']);
});
it('legacy reel IDs cannot be claimed through a colliding post-item UUID',async()=>{
 const reel=edge({legacy:true});expect((await reel.request()).status).toBe(200);
 const collision=edge({post:true,legacy:true});expect((await collision.request()).status).toBe(502);expect(collision.calls).toEqual(['GET /assets/asset']);
});
