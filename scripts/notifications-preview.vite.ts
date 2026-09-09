import {defineConfig,mergeConfig} from 'vite';
import path from 'node:path';
import base from '../vite.config';
export default defineConfig(env=>mergeConfig(typeof base==='function'?base(env):base,{
 plugins:[{name:'notification-preview',enforce:'pre',resolveId(source:string){
  if(/contexts\/(PushNotificationsContext|NotificationsContext)$/.test(source)||/\/supabase$/.test(source))return path.resolve('scripts/notifications-preview-mocks.tsx');
 }}],server:{port:3016,host:'127.0.0.1',strictPort:true}
}));
