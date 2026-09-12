// @vitest-environment jsdom
import {beforeEach, expect, it, vi} from 'vitest';
const bridge=vi.hoisted(()=>({get:vi.fn(),set:vi.fn(),remove:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true}}));
vi.mock('@capacitor/preferences',()=>({Preferences:bridge}));
beforeEach(()=>{vi.resetModules();vi.resetAllMocks();localStorage.clear();bridge.set.mockResolvedValue(undefined);bridge.remove.mockResolvedValue(undefined);});
it('migrates an existing webview session into durable native storage',async()=>{
 localStorage.setItem('session','legacy');bridge.get.mockResolvedValue({value:null});
 const {authStorage}=await import('./auth-storage');expect(await authStorage.getItem('session')).toBe('legacy');expect(bridge.set).toHaveBeenCalledWith({key:'session',value:'legacy'});
});
it('uses the rotated token after a native write fails, including after a cold relaunch',async()=>{
 bridge.get.mockResolvedValue({value:'old-token'});bridge.set.mockRejectedValueOnce(new Error('bridge unavailable'));
 let {authStorage}=await import('./auth-storage');await authStorage.setItem('session','rotated-token');
 vi.resetModules();({authStorage}=await import('./auth-storage'));
 expect(await authStorage.getItem('session')).toBe('rotated-token');
 expect(bridge.get).not.toHaveBeenCalled();expect(bridge.set).toHaveBeenLastCalledWith({key:'session',value:'rotated-token'});
 expect(localStorage.getItem('session:pending-native')).toBeNull();
});
it('does not resurrect a signed-out session when native removal fails',async()=>{
 bridge.get.mockResolvedValue({value:'revoked-token'});bridge.remove.mockRejectedValueOnce(new Error('bridge unavailable'));
 let {authStorage}=await import('./auth-storage');await authStorage.removeItem('session');
 vi.resetModules();({authStorage}=await import('./auth-storage'));
 expect(await authStorage.getItem('session')).toBeNull();expect(bridge.get).not.toHaveBeenCalled();expect(bridge.remove).toHaveBeenCalledTimes(2);
});
it('orders overlapping rotation and logout writes so logout wins',async()=>{
 let finish!:()=>void;bridge.set.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));
 const {authStorage}=await import('./auth-storage');
 const rotation=authStorage.setItem('session','rotated'), logout=authStorage.removeItem('session');
 await vi.waitFor(()=>expect(bridge.set).toHaveBeenCalled());expect(bridge.remove).not.toHaveBeenCalled();
 finish();await Promise.all([rotation,logout]);expect(bridge.remove).toHaveBeenCalled();expect(localStorage.getItem('session')).toBeNull();
});
