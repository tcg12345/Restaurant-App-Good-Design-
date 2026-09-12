import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),callbacks:[] as any[]}));
vi.mock('./supabase',()=>({supabase:{functions:{invoke:mocks.invoke},auth:{onAuthStateChange:(cb:any)=>mocks.callbacks.push(cb)}}}));
import {fetchMuxTokens,requestMuxUpload} from './mux';
import {resetMediaAccess} from './media-access-scope';
import {notifyFollowAccessChange, onFollowAccessChange} from './follow-access';
const items=[{kind:'reel' as const,id:'video'}];
const result=(playback='current')=>({data:{tokens:{video:{playback,thumbnail:'t',storyboard:'s',expiresAt:Date.now()/1000+900}}},error:null});
beforeEach(()=>{resetMediaAccess();mocks.invoke.mockReset().mockResolvedValue(result());});
it('reuses fresh tokens but reauthorizes after an identity change',async()=>{
 await fetchMuxTokens(items);await fetchMuxTokens(items);expect(mocks.invoke).toHaveBeenCalledTimes(1);
 mocks.callbacks[0]('SIGNED_IN',{user:{id:'another'}});await fetchMuxTokens(items);expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
it('discards a previous accounts in-flight response and does not overwrite the new cache',async()=>{
 let finish!:(r:any)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>finish=done));
 const old=fetchMuxTokens(items);mocks.callbacks[0]('SIGNED_OUT',null);
 expect((await fetchMuxTokens(items)).get('video')?.playback).toBe('current');
 finish(result('previous'));expect((await old).size).toBe(0);
 expect((await fetchMuxTokens(items)).get('video')?.playback).toBe('current');
});
it('rejects an old servers public fallback for a requested private upload',async()=>{
 mocks.invoke.mockResolvedValue({data:{uploadUrl:'https://example.invalid',uploadId:'upload',playbackPolicy:'public'}});
 await expect(requestMuxUpload({passthrough:'video',isPublic:false})).rejects.toThrow('Private video uploads are unavailable');
});
it('reauthorizes cached playback and notifies feeds after unfollowing',async()=>{
 await fetchMuxTokens(items);
 const changed=vi.fn();const unsubscribe=onFollowAccessChange(changed);
 mocks.invoke.mockResolvedValue({data:{tokens:{}},error:null});
 notifyFollowAccessChange('author',false);
 expect(changed).toHaveBeenCalledWith({authorId:'author',following:false});
 expect((await fetchMuxTokens(items)).size).toBe(0);
 expect(mocks.invoke).toHaveBeenCalledTimes(2);
 unsubscribe();notifyFollowAccessChange('author',true);
 expect(changed).toHaveBeenCalledTimes(1);
});
