import { useState } from 'react';
import { defaultNotificationPreferences } from '../src/lib/notification-policy';
export function usePushNotifications() {
 const [preferences,setPreferences]=useState(defaultNotificationPreferences());
 const [permission,setPermission]=useState('prompt');
 return {preferences,permission,native:true,loading:false,busy:false,error:'',registered:preferences.enabled,
 update:async(patch:any)=>setPreferences(p=>({...p,...patch})), enable:async()=>{setPermission('granted');setPreferences(p=>({...p,enabled:true}));},refresh:async()=>{},test:async()=>{}};
}
export function useNotifications() {
 const [read,setRead]=useState(false);
 return {notifications:[{id:'preview',actorId:'friend',userId:'demo',kind:'friend_request',subjectType:'friend',subjectId:'friend',title:'New friend request',preview:'Alex would like to connect.',createdAt:Date.now()-300000,readAt:read?Date.now():null,path:'/messages?tab=friends'}],unreadCount:read?0:1,actors:{},loading:false,markRead:()=>setRead(true),markAllRead:()=>setRead(true)};
}
export const supabase = {};
export const supabaseConfigured = false;
