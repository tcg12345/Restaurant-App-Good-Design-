// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), onAuth: vi.fn(), signOut: vi.fn(), profile: vi.fn(), requests: vi.fn(), admin: vi.fn(), stored: vi.fn() }));
vi.mock('../lib/supabase', () => ({supabaseConfigured: true, SESSION_STORAGE_KEY: 'session', supabase: {auth: {getSession: mock.getSession, onAuthStateChange: mock.onAuth, signOut: mock.signOut}}}));
vi.mock('../lib/supabase-community', () => ({fetchProfile: mock.profile, getPendingRequests: mock.requests}));
vi.mock('../lib/supabase-verification', () => ({isAppAdmin: mock.admin}));
vi.mock('../lib/auth-storage', () => ({readStoredSession: mock.stored}));
vi.mock('../lib/native-oauth', () => ({isNativeRuntime: () => false}));
vi.mock('../lib/native-apple', () => ({}));
vi.mock('../lib/native-share', () => ({}));
vi.mock('../lib/native-widgets', () => ({clearWidgets: vi.fn().mockResolvedValue(undefined)}));
vi.mock('../lib/native-notifications', () => ({disconnectNotifications: vi.fn().mockResolvedValue(undefined)}));
vi.mock('../lib/analytics', () => ({flushAnalyticsBeforeSignOut: vi.fn().mockResolvedValue(undefined)}));
vi.mock('../lib/supabase-account', () => ({clearLocalAppData: vi.fn().mockResolvedValue(undefined)}));
import { AuthProvider, useAuth } from './AuthContext';
const user = {id: 'one', email: 'one@example.invalid'};
function deferred<T>() { let resolve!: (v:T)=>void; const promise = new Promise<T>(r=>{resolve=r;}); return {promise, resolve}; }
let root: Root; let host: HTMLDivElement; let auth: ReturnType<typeof useAuth>; let event: (type: string, session: any)=>void;
function Probe() { auth = useAuth(); return <span>{auth.user?.id}:{String(auth.loading)}:{String(auth.profileLoading)}</span>; }
async function mount() { host=document.createElement('div'); root=createRoot(host); await act(async()=>root.render(<AuthProvider><Probe/></AuthProvider>)); }
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear(); vi.clearAllMocks();
  mock.onAuth.mockImplementation(cb=>{event=cb;return {data:{subscription:{unsubscribe:vi.fn()}}};});
  mock.getSession.mockResolvedValue({data:{session:{user}}});
  mock.profile.mockResolvedValue({id:'one', username:'one'});
  mock.requests.mockResolvedValue([]); mock.admin.mockResolvedValue(false); mock.stored.mockResolvedValue(null);
  mock.signOut.mockResolvedValue({error:null});
});
afterEach(async()=>{await act(async()=>root?.unmount()); vi.useRealTimers();});
it('opens after the profile resolves even while auxiliary probes are pending', async()=>{
  const requests=deferred<any[]>(), admin=deferred<boolean>(); mock.requests.mockReturnValue(requests.promise); mock.admin.mockReturnValue(admin.promise);
  await mount(); expect(auth.loading).toBe(false); expect(auth.profileLoading).toBe(false); expect(auth.profile?.username).toBe('one');
  await act(async()=>{requests.resolve([]);admin.resolve(false);});
});
it('does not refetch profile or replace user identity on token refresh and repeated sign-in events', async()=>{
  await mount(); const original=auth.user;
  await act(async()=>{event('TOKEN_REFRESHED',{user:{...user}}); event('SIGNED_IN',{user:{...user}});});
  expect(auth.user).toBe(original); expect(mock.profile).toHaveBeenCalledTimes(1);
});
it('deduplicates bootstrap and the initial auth event', async()=>{
  const session=deferred<any>(); mock.getSession.mockReturnValue(session.promise);
  await mount(); await act(async()=>event('INITIAL_SESSION',{user}));
  await act(async()=>session.resolve({data:{session:{user}}}));
  expect(mock.profile).toHaveBeenCalledTimes(1); expect(auth.user?.id).toBe('one');
});
it('does not resurrect a signed-out user from a late bootstrap or profile response',async()=>{
  const session=deferred<any>(), profile=deferred<any>(); mock.getSession.mockReturnValue(session.promise); mock.profile.mockReturnValue(profile.promise);
  await mount(); await act(async()=>event('SIGNED_IN',{user})); await act(async()=>event('SIGNED_OUT',null));
  await act(async()=>{session.resolve({data:{session:{user}}});profile.resolve({id:'one',username:'one'});});
  expect(auth.user).toBeNull(); expect(auth.profile).toBeNull(); expect(auth.loading).toBe(false);
});
it('keeps the existing-profile retry gate when fetching the profile fails',async()=>{
  mock.profile.mockRejectedValue(new Error('offline')); await mount();
  expect(auth.user?.id).toBe('one'); expect(auth.profileError).toBe(true); expect(auth.profileLoading).toBe(false);
});
it('signs out only this device',async()=>{
  await mount(); await act(async()=>auth.signOut());
  expect(mock.signOut).toHaveBeenCalledWith({scope:'local'});
});
