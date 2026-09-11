import { readFileSync, readdirSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { retiredEndpoint } from '../../supabase/functions/_shared/retired-endpoint';
const names=JSON.parse(readFileSync(new URL('../../supabase/retired-functions.json',import.meta.url),'utf8')) as string[];
it('retired APIs never read bodies, make external calls, or pretend work succeeded',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Must not contact provider'));
 try {
  for(const method of ['GET','POST','DELETE','PUT']){
   const req=new Request('https://example.invalid',{method});const read=vi.spyOn(req,'json').mockRejectedValue(new Error('Must not parse payload'));
   const res=retiredEndpoint(req);expect(res.status).toBe(410);expect(await res.json()).toEqual({error:'This legacy endpoint has been retired.',code:'endpoint_retired'});expect(read).not.toHaveBeenCalled();
  }
  expect(retiredEndpoint(new Request('https://example.invalid',{method:'OPTIONS'})).status).toBe(204);expect(fetch).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();}
});
it('every retired deployment uses the inert handler with gateway protection',()=>{
 const config=readFileSync(new URL('../../supabase/config.toml',import.meta.url),'utf8');
 for(const name of names){
  const source=readFileSync(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url),'utf8');
  expect(source).toContain('Deno.serve(retiredEndpoint)');expect(source).not.toMatch(/fetch\(|createClient\(|Deno.env/);
  expect(config).toContain(`[functions.${name}]\nverify_jwt = true`);
 }
});
it('current application source does not invoke a retired endpoint',()=>{
 const walk=(dir:URL):URL[]=>readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?walk(new URL(f.name+'/',dir)):/\.[jt]sx?$/.test(f.name)&&!f.name.includes('.test.')?[new URL(f.name,dir)]:[]);
 for(const path of walk(new URL('../',import.meta.url))){
  const source=readFileSync(path,'utf8');
  for(const name of names) expect(source).not.toMatch(new RegExp(`(?:invoke\\(\\s*['\"\x60]${name}['\"\x60]|/functions/v1/${name}(?:[/'\"\x60?]))`));
 }
});
