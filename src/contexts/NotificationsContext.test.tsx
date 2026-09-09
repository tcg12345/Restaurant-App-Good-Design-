// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NotificationsProvider,useNotifications} from './NotificationsContext';
const mock=vi.hoisted(()=>({count:83,mark:vi.fn(),all:vi.fn()}));
vi.mock('./AuthContext',()=>({useAuth:()=>({user:{id:'owner'}})}));
vi.mock('../lib/supabase-community',()=>({getProfilesByIds:async()=>({})}));
vi.mock('../lib/supabase-notifications',()=>({listNotifications:async()=>[],markNotificationsRead:mock.mark,markAllNotificationsRead:mock.all,clearNotifications:async()=>true,rowToNotification:(r:any)=>r}));
vi.mock('../lib/supabase',()=>({supabaseConfigured:true,supabase:{from:()=>({select:()=>({eq:()=>({is:async()=>({count:mock.count,error:null})})})}),channel:()=>{const chain={on:()=>chain,subscribe:()=>chain};return chain;},removeChannel:()=>{}}}));
let root:Root,host:HTMLDivElement,value:ReturnType<typeof useNotifications>;
function Probe(){value=useNotifications();return <span>{value.unreadCount}</span>}
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();mock.count=83;mock.mark.mockResolvedValue(true);mock.all.mockResolvedValue(true);(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function mount(){await act(async()=>root.render(<NotificationsProvider><Probe/></NotificationsProvider>));await act(async()=>vi.advanceTimersByTimeAsync(160));}
it('uses the exact server unread count even when no rows are on the loaded page',async()=>{await mount();expect(host.textContent).toBe('83');});
it('marks a cold-launch notification read before it has been fetched',async()=>{await mount();await act(async()=>value.markRead(['unloaded-notification']));expect(mock.mark).toHaveBeenCalledWith('owner',['unloaded-notification']);});
it('marks older unread notifications when the visible page has none',async()=>{await mount();await act(async()=>value.markAllRead());expect(mock.all).toHaveBeenCalledWith('owner');});
