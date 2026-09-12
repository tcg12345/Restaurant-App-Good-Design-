// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({photos:vi.fn(),sign:vi.fn()}));
vi.mock('./supabase-community',()=>({getCommunityPhotos:api.photos}));
vi.mock('./photo-access',()=>({resolvePhotoUrl:api.sign}));
import {useRestaurantPhotos} from './useRestaurantPhotos';
import {resetMediaAccess} from './media-access-scope';
const photo=(id:string)=>({id,url:`https://photos.invalid/${id}`,user_id:'owner',restaurant_id:'one'} as any);
let root:Root,host:HTMLDivElement,result:ReturnType<typeof useRestaurantPhotos>;
function Probe({id='one',settled=false}:{id?:string;settled?:boolean}) {result=useRestaurantPhotos(id,'viewer',settled);return <div>{result.communityPhotos.map(p=>p.id).join(',')}</div>;}
async function render(settled=false,id='one'){await act(async()=>root.render(<Probe settled={settled} id={id}/>));}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;resetMediaAccess();vi.clearAllMocks();host=document.createElement('div');root=createRoot(host);api.sign.mockResolvedValue('signed');});
afterEach(async()=>{await act(async()=>root.unmount());});
it('fetches and authorizes the cover before settlement, then pages without a full-library request',async()=>{
 const rows=Array.from({length:14},(_,i)=>photo(String(i)));
 api.photos.mockImplementation((_id,limit,offset)=>Promise.resolve(rows.slice(offset,offset+limit)));
 await render();expect(api.photos).toHaveBeenCalledTimes(1);expect(api.photos).toHaveBeenCalledWith('one',1,0,{throwOnError:true});expect(api.sign).toHaveBeenCalledWith(rows[0].url);expect(result.communityPhotos).toHaveLength(1);
 await render(true);expect(result.communityPhotos).toHaveLength(14);expect(api.photos.mock.calls.map(c=>[c[1],c[2]])).toEqual([[1,0],[12,0],[12,12]]);
});
it('keeps a working cover if a later page fails',async()=>{
 api.photos.mockResolvedValueOnce([photo('cover')]).mockRejectedValue(new Error('offline'));
 await render(true);expect(result.communityPhotos.map(p=>p.id)).toEqual(['cover']);expect(result.photosLoading).toBe(false);
});
it('does not apply a late cover from the previous restaurant',async()=>{
 let finish!:(v:any)=>void;api.photos.mockReturnValueOnce(new Promise(r=>{finish=r;})).mockResolvedValue([photo('second')]);
 await render(false,'one');await render(false,'two');await act(async()=>finish([photo('first')]));expect(result.communityPhotos.map(p=>p.id)).toEqual(['second']);
});
it('drops cached photos immediately when viewing permissions change',async()=>{
 api.photos.mockResolvedValue([photo('private')]);await render();
 api.photos.mockReturnValue(new Promise(()=>{}));await act(async()=>resetMediaAccess());expect(result.communityPhotos).toEqual([]);expect(result.photosLoading).toBe(true);
});
