import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

const copies = ['_shared/quota.ts','location-chat/index.ts','import-recipe/index.ts','import-restaurants/index.ts'];
function loadGuard(path: string, result: unknown, reject = false) {
  const source=readFileSync(new URL(`../../supabase/functions/${path}`,import.meta.url),'utf8');
  const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='enforceQuota');
  if(!node) throw new Error('Missing quota guard');
  const code=ts.transpileModule(node.getText(tree).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function('createClient','Deno','CORS_HEADERS','resetPhrase','console',code+'; return enforceQuota;')(
    ()=>({rpc:async()=>{if(reject) throw new Error('network'); return result;}}),
    {env:{get:()=>''}}, {}, ()=>'Later.', {error(){}},
  ) as (req:Request,endpoint:string,message:string)=>Promise<{response?:Response;plan?:string}>;
}
for(const path of copies){
  it(`${path} stops paid work on quota errors, malformed data and thrown failures`,async()=>{
    for(const result of [{data:null,error:{message:'offline'}},{data:null,error:null},{data:{},error:null},{data:{allowed:true,plan:'unknown'},error:null}]){
      const out=await loadGuard(path,result)(new Request('https://example.invalid'),'test','Try again.');
      expect(out.response?.status).toBe(503);
      expect(out.response?.headers.get('Retry-After')).toBe('5');
    }
    expect((await loadGuard(path,null,true)(new Request('https://example.invalid'),'test','Try again.')).response?.status).toBe(503);
  });
  it(`${path} preserves allowed, exhausted and Pro-only outcomes`,async()=>{
    for(const [data,status] of [[{allowed:true,plan:'pro'},undefined],[{allowed:false,plan:'free'},429],[{allowed:false,plan:'free',pro_only:true},402]] as const){
      const out=await loadGuard(path,{data,error:null})(new Request('https://example.invalid'),'test','Try again.');
      expect(out.response?.status).toBe(status);
      if(status===undefined) expect(out.plan).toBe('pro');
    }
  });
}
