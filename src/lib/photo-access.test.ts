import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sign:vi.fn(), onAuth:vi.fn(), callbacks:[] as Array<(event:string,session:any)=>void> }));
vi.mock('./supabase', () => ({
  supabaseConfigured:true, supabaseUrl:'https://photos-test.supabase.co',
  supabase:{ storage:{from:()=>({createSignedUrls:mocks.sign})}, auth:{onAuthStateChange:(cb:any)=>{mocks.callbacks.push(cb); return {};}} },
}));
import { cachedPhotoUrl, canonicalPhotoUrl, photoReference, PHOTO_URL_TTL_SECONDS, resolvePhotoUrl } from './photo-access';
import { resetMediaAccess } from './media-access-scope';
const source = (path='owner/photo.jpg', bucket='photos') => `https://photos-test.supabase.co/storage/v1/object/public/${bucket}/${path}`;
const success = (paths:string[]) => ({data:paths.map(path=>({path,signedUrl:`https://signed.example/${path}`})),error:null});
beforeEach(()=>{ resetMediaAccess(); mocks.sign.mockReset().mockImplementation(async paths=>success(paths)); });
describe('photo references',()=>{
  it.each(['https://attacker.example/storage/v1/object/public/photos/owner/a.jpg','https://photos-test.supabase.co.attacker.example/storage/v1/object/public/photos/owner/a.jpg','data:image/jpeg;base64,AAA','blob:preview'])('leaves external/inline sources alone: %s',async url=>{
    expect(photoReference(url)).toBeNull();expect(await resolvePhotoUrl(url)).toBe(url);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('normalizes signed and encoded references without retaining tokens',()=>{
    expect(canonicalPhotoUrl('https://photos-test.supabase.co/storage/v1/object/sign/photos/owner/a%20b.jpg?token=old')).toBe(source('owner/a%20b.jpg'));
    expect(photoReference(source('restaurant-photos/owner/a.jpg','avatars'))?.path).toBe('restaurant-photos/owner/a.jpg');
    expect(photoReference(source('user.jpg','avatars'))?.bucket).toBe('avatars');
  });
  it.each(['owner/%ZZ.jpg','owner/%2e%2e/file.jpg','owner/%00.jpg','owner/%5c.jpg'])('rejects malformed object paths %s',path=>expect(photoReference(source(path))).toBeNull());
});
describe('batched, identity-scoped photo signing',()=>{
  it('batches concurrent photos and deduplicates repeated references',async()=>{
    const a=resolvePhotoUrl(source()), b=resolvePhotoUrl(source('owner/other.jpg')), c=resolvePhotoUrl(source());
    expect(await Promise.all([a,b,c])).toEqual(['https://signed.example/owner/photo.jpg','https://signed.example/owner/other.jpg','https://signed.example/owner/photo.jpg']);
    expect(mocks.sign).toHaveBeenCalledTimes(1);expect(mocks.sign).toHaveBeenCalledWith(['owner/photo.jpg','owner/other.jpg'],PHOTO_URL_TTL_SECONDS);
    await resolvePhotoUrl(source());expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
  it('never uses public or stale signed URLs when permission is denied',async()=>{
    mocks.sign.mockResolvedValue({data:null,error:{message:'denied'}});
    expect(await resolvePhotoUrl(source())).toBeNull();expect(cachedPhotoUrl(source())).toBeNull();
  });
  it('handles per-object failures without hiding other authorized photos',async()=>{
    mocks.sign.mockResolvedValue({data:[{path:'owner/photo.jpg',signedUrl:'allowed'},{path:'owner/other.jpg',error:'denied',signedUrl:''}],error:null});
    expect(await Promise.all([resolvePhotoUrl(source()),resolvePhotoUrl(source('owner/other.jpg'))])).toEqual(['allowed',null]);
  });
  it('drops pending results when identity changes and cannot overwrite the new identity cache',async()=>{
    let finish!: (r:any)=>void;
    mocks.sign.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const old=resolvePhotoUrl(source());await Promise.resolve();
    resetMediaAccess();expect(await old).toBeNull();
    const fresh=resolvePhotoUrl(source());await fresh;
    finish({data:[{path:'owner/photo.jpg',signedUrl:'old-account-token'}],error:null});await Promise.resolve();
    expect(cachedPhotoUrl(source())).toBe('https://signed.example/owner/photo.jpg');
  });
  it('does not sign already in-flight paths again when another image mounts',async()=>{
    let finish!: (r:any)=>void;
    mocks.sign.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const a=resolvePhotoUrl(source());await Promise.resolve();
    await resolvePhotoUrl(source('owner/other.jpg'));expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(mocks.sign.mock.calls[1][0]).toEqual(['owner/other.jpg']);finish(success(['owner/photo.jpg']));await a;
  });
  it('renews before expiration and invalidates on sign-out',async()=>{
    const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
    await resolvePhotoUrl(source());clock.mockReturnValue(1000+PHOTO_URL_TTL_SECONDS*1000-30_000);
    expect(cachedPhotoUrl(source())).toBeNull();await resolvePhotoUrl(source());expect(mocks.sign).toHaveBeenCalledTimes(2);
    mocks.callbacks[0]('SIGNED_IN',{user:{id:'owner'}});mocks.callbacks[0]('SIGNED_OUT',null);
    expect(cachedPhotoUrl(source())).toBeNull();clock.mockRestore();
  });
});
it('settles a stalled signing request without falling back to public access',async()=>{
 vi.useFakeTimers();
 try {
  mocks.sign.mockImplementation(()=>new Promise(()=>{}));const pending=resolvePhotoUrl(source());
  await vi.advanceTimersByTimeAsync(12_001);expect(await pending).toBeNull();
 } finally {vi.useRealTimers();}
});
