// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:{id:'viewer'} as {id:string}|null,signIn:vi.fn(),toast:vi.fn()}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('../contexts/SignInModalContext',()=>({useSignInModal:()=>({requireSignIn:mocks.signIn})}));
vi.mock('../contexts/ToastContext',()=>({useToast:()=>({showToast:mocks.toast})}));
vi.mock('../lib/haptics',()=>({homeHaptic:vi.fn()}));
vi.mock('../lib/photo-likes',()=>({getPhotoLikes:vi.fn(),setPhotoLiked:vi.fn()}));
import { getPhotoLikes, setPhotoLiked } from '../lib/photo-likes';
import { PhotoLikeButton } from './PhotoLikeButton';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.clearAllMocks(); mocks.user={id:'viewer'}; (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(id='photo') { await act(async()=>root.render(<PhotoLikeButton photoId={id}/>)); }
async function click() { await act(async()=>host.querySelector('button')!.click()); }
it('optimistically likes/unlikes, blocks rapid duplicate taps, and reconciles counts',async()=>{
 vi.mocked(getPhotoLikes).mockResolvedValueOnce({count:4,liked:false}).mockResolvedValueOnce({count:5,liked:true}).mockResolvedValueOnce({count:4,liked:false});
 let complete!:()=>void; vi.mocked(setPhotoLiked).mockImplementationOnce(()=>new Promise<void>(resolve=>{complete=resolve;})).mockResolvedValue(undefined);
 await mount(); await click(); await click();
 expect(host.textContent).toContain('5'); expect(host.querySelector('button')!.disabled).toBe(true);
 expect(setPhotoLiked).toHaveBeenCalledTimes(1);
 await act(async()=>complete()); expect(host.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
 await click(); expect(setPhotoLiked).toHaveBeenLastCalledWith('photo','viewer',false); expect(host.textContent).toContain('4');
});
it('rolls back a failed like and shows an actionable error',async()=>{
 vi.mocked(getPhotoLikes).mockResolvedValue({count:2,liked:false}); vi.mocked(setPhotoLiked).mockRejectedValue(new Error('offline'));
 await mount(); await click(); expect(host.textContent).toContain('2'); expect(host.querySelector('button')!.getAttribute('aria-pressed')).toBe('false'); expect(mocks.toast).toHaveBeenCalled();
});
it('asks guests to sign in without writing a vote',async()=>{
 mocks.user=null; vi.mocked(getPhotoLikes).mockResolvedValue({count:2,liked:false});
 await mount(); await click(); expect(mocks.signIn).toHaveBeenCalled(); expect(setPhotoLiked).not.toHaveBeenCalled();
});
it('does not apply a previous photo’s late response to the next photo',async()=>{
 let finish!:(v:{count:number;liked:boolean})=>void;
 vi.mocked(getPhotoLikes).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({count:7,liked:false});
 await mount('old'); await mount('new'); await act(async()=>finish({count:99,liked:true}));
 expect(host.textContent).toContain('7'); expect(host.textContent).not.toContain('99');
});
