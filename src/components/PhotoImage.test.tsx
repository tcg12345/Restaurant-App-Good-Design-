// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const sign=vi.hoisted(()=>vi.fn());
vi.mock('../lib/supabase',()=>({supabaseConfigured:true,supabaseUrl:'https://photo-ui.supabase.co',supabase:{auth:{onAuthStateChange:()=>({})},storage:{from:()=>({createSignedUrls:sign})}}}));
import {PhotoImage, PHOTO_PLACEHOLDER} from './PhotoImage';
import {PhotoBackground} from './PhotoBackground';
import {resetMediaAccess} from '../lib/media-access-scope';
const source='https://photo-ui.supabase.co/storage/v1/object/public/photos/owner/private.jpg';
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;resetMediaAccess();sign.mockReset();
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('preserves native image semantics, refs, styling and load events for external photos',async()=>{
 const ref=React.createRef<HTMLImageElement>(),load=vi.fn();
 await act(async()=>root.render(<PhotoImage src="https://example.com/photo.jpg" alt="Dish" className="cover" ref={ref} onLoad={load}/>));
 expect(ref.current).toBe(host.querySelector('img'));expect(ref.current?.alt).toBe('Dish');expect(ref.current?.className).toBe('cover');expect(sign).not.toHaveBeenCalled();
 await act(async()=>ref.current!.dispatchEvent(new Event('load')));expect(load).toHaveBeenCalledOnce();
});
it('does not request public URLs or fire successful-load callbacks for placeholders',async()=>{
 let finish!:(value:any)=>void;sign.mockImplementation(()=>new Promise(done=>{finish=done;}));const load=vi.fn();
 await act(async()=>root.render(<PhotoImage src={source} onLoad={load}/>));
 const img=host.querySelector('img')!;expect(img.getAttribute('src')).toBe(PHOTO_PLACEHOLDER);
 await act(async()=>img.dispatchEvent(new Event('load')));expect(load).not.toHaveBeenCalled();
 await act(async()=>finish({data:[{path:'owner/private.jpg',signedUrl:'https://signed.example/private'}],error:null}));
 expect(img.src).toBe('https://signed.example/private');await act(async()=>img.dispatchEvent(new Event('load')));expect(load).toHaveBeenCalledOnce();
});
it('removes previous identity URLs immediately and cannot revive a pending prior-account photo',async()=>{
 sign.mockResolvedValueOnce({data:[{path:'owner/private.jpg',signedUrl:'https://signed.example/owner'}],error:null});
 await act(async()=>root.render(<PhotoImage src={source}/>));expect(host.querySelector('img')!.src).toBe('https://signed.example/owner');
 sign.mockResolvedValue({data:null,error:{message:'denied'}});
 await act(async()=>resetMediaAccess());expect(host.querySelector('img')!.src).not.toContain('signed.example');expect(host.querySelector('img')!.src).not.toContain('/public/');
});
it('retains background gradients while replacing only the photo reference',async()=>{
 sign.mockResolvedValue({data:[{path:'owner/private.jpg',signedUrl:'https://signed.example/bg'}],error:null});
 await act(async()=>root.render(<PhotoBackground data-testid="bg" style={{backgroundImage:`linear-gradient(red, blue), url("${source}")`}}/>));
 const style=(host.firstElementChild as HTMLElement).style.backgroundImage;
 expect(style).toContain('linear-gradient');expect(style).toContain('signed.example/bg');expect(style).not.toContain('/public/');
});
