import {defineConfig,mergeConfig} from 'vite';
import path from 'node:path';
import base from '../vite.config';
export default defineConfig(env=>mergeConfig(typeof base==='function'?base(env):base,{
 plugins:[{name:'custom-room-preview',enforce:'pre',resolveId(source:string){
  if(/(contexts\/(AuthContext|SignInModalContext|HomeLocationContext)|lib\/supabase|components\/(RestaurantPanel|ShareDialog|HomeLocationBar))$/.test(source))return path.resolve('scripts/group-custom-preview-mocks.tsx');
  if(/lib\/group-swipe$/.test(source))return path.resolve('scripts/group-custom-preview-service.ts');
  if(/lib\/places$/.test(source))return path.resolve('scripts/group-custom-preview-places.ts');
 }}],server:{port:3014,host:'127.0.0.1',strictPort:true}
}));
