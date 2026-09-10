import {beforeEach,expect,it,vi} from 'vitest';
const fetchPhoto=vi.hoisted(()=>vi.fn());
vi.mock('./photo-access',()=>({fetchPhoto}));
import {getCachedImage,loadCachedImage} from './image-cache';
import {resetMediaAccess} from './media-access-scope';
beforeEach(()=>{vi.restoreAllMocks();resetMediaAccess();fetchPhoto.mockReset();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:private-image');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
it('clears decoded private photos on account changes',async()=>{
 fetchPhoto.mockResolvedValue(new Response('photo'));
 expect(await loadCachedImage('path','https://signed.example')).toBe('blob:private-image');
 resetMediaAccess();expect(getCachedImage('path')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-image');
});
it('late downloads cannot recreate the previous account’s cache',async()=>{
 let finish!:(value:Response)=>void;fetchPhoto.mockImplementation(()=>new Promise(done=>{finish=done;}));
 const result=loadCachedImage('path','https://old-account.example');resetMediaAccess();finish(new Response('photo'));
 expect(await result).toBe('');expect(getCachedImage('path')).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
