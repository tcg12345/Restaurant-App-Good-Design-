import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import {SUBSCRIPTIONS_ENABLED} from './subscription-release';
const source=readFileSync(new URL('../../supabase/functions/billing-checkout/index.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source.replace(/^import .*;\n/gm,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function checkout(enabled:boolean,authorized=true){
 let handler!:(r:Request)=>Promise<Response>;
 const provider=vi.fn(()=>{throw new Error('No payment provider access in free mode');});
 new Function('Deno','SUBSCRIPTIONS_ENABLED','requireUser','CORS_HEADERS','serviceClient','withRequestTelemetry','fetch',code)(
  {env:{get:(key:string)=>key==='STRIPE_SECRET_KEY'?'configured-test-key':key==='PUBLIC_WEB_ORIGIN'?'https://example.invalid':undefined},serve:(fn:typeof handler)=>{handler=fn;}},
  enabled,async()=>authorized?{userId:'test'}:{response:new Response(null,{status:401})},{},provider,(_name:string,fn:unknown)=>fn,provider);
 return {handler,provider};
}
it('rejects authenticated checkout before creating a customer or accessing Stripe in the free release',async()=>{
 expect(SUBSCRIPTIONS_ENABLED).toBe(false);
 const {handler,provider}=checkout(SUBSCRIPTIONS_ENABLED);
 const response=await handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({plan:'annual'})}));
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'subscriptions_disabled'});expect(provider).not.toHaveBeenCalled();
});
it('preserves checkout authentication and preflight',async()=>{
 const {handler}=checkout(false,false);
 expect((await handler(new Request('https://example.invalid',{method:'POST'}))).status).toBe(401);
 expect((await handler(new Request('https://example.invalid',{method:'OPTIONS'}))).status).toBe(200);
});
it('retains the normal checkout validation when the release switch is enabled',async()=>{
 const {handler}=checkout(true);
 const response=await handler(new Request('https://example.invalid',{method:'POST',body:'invalid'}));
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'Invalid JSON body'});
});
