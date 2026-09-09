// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { PushNotificationsProvider, usePushNotifications } from './PushNotificationsContext';
import { defaultNotificationPreferences } from '../lib/notification-policy';
const mock=vi.hoisted(()=>({uid:'owner', adminChecked:false as boolean | 'unknown', track:vi.fn(), data:null as any, failure:null as any, listeners:{} as Record<string,Function>, upsert:vi.fn(), request:vi.fn(), status:vi.fn(), register:vi.fn(), sync:vi.fn(), context:vi.fn(), badge:vi.fn(), disconnect:vi.fn(), refresh:vi.fn(), markRead:vi.fn()}));
vi.mock('./AuthContext',()=>({useAuth:()=>({user:mock.uid?{id:mock.uid}:null,loading:false,adminChecked:mock.adminChecked})}));
vi.mock('../lib/analytics',()=>({track:mock.track}));
vi.mock('./CalendarContext',()=>({useCalendar:()=>({plans:[]})}));
vi.mock('./ListsContext',()=>({useLists:()=>({ratings:[]})}));
vi.mock('./NotificationsContext',()=>({useNotifications:()=>({unreadCount:0,refresh:mock.refresh,markRead:mock.markRead})}));
vi.mock('@capacitor/app',()=>({App:{addListener:async()=>({remove:vi.fn()})}}));
vi.mock('../lib/supabase',()=>({supabase:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:mock.data,error:null})})}),upsert:mock.upsert}),rpc:async()=>({error:null})}}));
vi.mock('../lib/native-notifications',()=>({supportsIOSNotifications:()=>true,disconnectNotifications:mock.disconnect,NativeNotifications:{status:mock.status,requestPermission:mock.request,register:mock.register,syncMeals:mock.sync,setContext:mock.context,setBadge:mock.badge,test:async()=>{},addListener:async(name:string,fn:Function)=>{mock.listeners[name]=fn;return{remove:vi.fn()};}}}));
let host:HTMLDivElement,root:Root,value:ReturnType<typeof usePushNotifications>;
function Probe(){value=usePushNotifications();return <span>{useLocation().pathname}{useLocation().search}</span>}
const render=async()=>{await act(async()=>{root.render(<MemoryRouter><PushNotificationsProvider><Probe/></PushNotificationsProvider></MemoryRouter>)});};
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();mock.uid='owner';mock.adminChecked=false;mock.data=null;mock.failure=null;mock.listeners={};
 mock.status.mockResolvedValue({permission:'prompt',installationId:'device'});mock.request.mockResolvedValue({permission:'granted'});mock.register.mockResolvedValue(undefined);mock.sync.mockResolvedValue(undefined);mock.context.mockResolvedValue(undefined);mock.badge.mockResolvedValue(undefined);mock.disconnect.mockResolvedValue(undefined);mock.upsert.mockImplementation(async()=>({error:mock.failure}));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('does not prompt or register until the user enables notifications',async()=>{
 await render();expect(mock.request).not.toHaveBeenCalled();expect(mock.register).not.toHaveBeenCalled();
 await act(async()=>value.enable());expect(mock.request).toHaveBeenCalledTimes(1);expect(value.preferences.enabled).toBe(true);expect(mock.register).toHaveBeenCalled();
});
it('keeps previous preferences on a failed save and reports an actionable error',async()=>{
 mock.data={...defaultNotificationPreferences(),enabled:true};await render();mock.failure={message:'offline'};
 await act(async()=>value.update({sound:false}));expect(value.preferences.sound).toBe(true);expect(value.error).toContain('Couldn’t save');
});
it('disconnects the installation when notifications are paused',async()=>{
 mock.data={...defaultNotificationPreferences(),enabled:true};await render();await act(async()=>value.update({enabled:false}));
 expect(mock.disconnect).toHaveBeenCalledTimes(1);expect(value.preferences.enabled).toBe(false);
});
it('rejects taps for another account and unsafe routes, but opens an owned conversation',async()=>{
 await render();await act(async()=>mock.listeners.action({userId:'other',path:'/calendar',notificationId:'wrong'}));expect(host.textContent).toBe('/');expect(mock.markRead).not.toHaveBeenCalled();
 await act(async()=>mock.listeners.action({userId:'owner',path:'https://evil.test',notificationId:'unsafe'}));expect(host.textContent).toBe('/');
 await act(async()=>mock.listeners.action({userId:'owner',path:'/messages?conversation=one',notificationId:'right'}));expect(host.textContent).toBe('/messages?conversation=one');expect(mock.markRead).toHaveBeenCalledWith(['right']);
});

it.each([['granted','allowed'],['denied','denied'],['provisional','provisional']])('records the actual %s result with its source',async(permission,outcome)=>{
 await render();mock.track.mockClear();mock.request.mockResolvedValue({permission});
 await act(async()=>value.enable('onboarding'));
 expect(mock.track).toHaveBeenCalledWith('notification_permission_result',expect.objectContaining({properties:{source:'onboarding',stage:'system_prompt',outcome}}));
 if(permission==='denied') expect(mock.upsert).not.toHaveBeenCalled();
});
it('records a verified initial status and only records changes on subsequent reads',async()=>{
 await render();expect(mock.track).toHaveBeenCalledWith('notification_permission_status',expect.objectContaining({properties:{outcome:'not_asked',source:'app_open',action:'initial'}}));
 mock.track.mockClear();await act(async()=>value.refresh());expect(mock.track).not.toHaveBeenCalled();
 mock.status.mockResolvedValue({permission:'denied',installationId:'device'});
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(mock.track).toHaveBeenCalledWith('notification_permission_status',expect.objectContaining({properties:{outcome:'denied',source:'app_resume',action:'changed',reason:'not_asked'}}));
});
it('keeps skipping and in-app disabling separate from denying iOS permission',async()=>{
 mock.data={...defaultNotificationPreferences(),enabled:true};mock.status.mockResolvedValue({permission:'granted',installationId:'device'});
 await render();mock.track.mockClear();await act(async()=>value.skipPermission());
 expect(mock.track).toHaveBeenCalledWith('notification_prompt_skipped',expect.objectContaining({properties:{source:'onboarding',outcome:'not_now'}}));
 await act(async()=>value.update({enabled:false}));
 expect(mock.track).toHaveBeenCalledWith('notification_preference_changed',expect.objectContaining({properties:{source:'settings',outcome:'disabled'}}));
 expect(mock.track.mock.calls.some(call=>call[1]?.properties?.outcome==='denied')).toBe(false);
});
it('does not count permission errors as refusals or emit late results for a different account',async()=>{
 await render();mock.track.mockClear();mock.request.mockRejectedValueOnce(new Error('native error'));
 await act(async()=>value.enable());expect(mock.track).toHaveBeenCalledWith('notification_permission_error',expect.anything());
 expect(mock.track.mock.calls.some(call=>call[0]==='notification_permission_result')).toBe(false);
 let finish!:(value:any)=>void;mock.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 let request!:Promise<void>;await act(async()=>{request=value.enable();});
 mock.uid='new-owner';await render();mock.track.mockClear();
 await act(async()=>{finish({permission:'granted'});await request;});
 expect(mock.track).not.toHaveBeenCalled();
});
it('waits for analytics identity classification before recording the first status',async()=>{
 mock.adminChecked='unknown';await render();expect(mock.track).not.toHaveBeenCalled();
 mock.adminChecked=false;await render();expect(mock.track).toHaveBeenCalledWith('notification_permission_status',expect.anything());
});
