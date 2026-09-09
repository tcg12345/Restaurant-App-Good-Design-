import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import base from '../vite.config';
export default defineConfig(env=>mergeConfig(typeof base==='function'?base(env):base,{
 plugins:[{name:'photo-likes-local-preview',enforce:'pre',resolveId(source:string){
  if (/(contexts\/(AuthContext|SignInModalContext|ToastContext)|lib\/photo-likes)$/.test(source)) return path.resolve('scripts/photo-likes-preview-mocks.ts');
 }}],server:{port:3025,host:'127.0.0.1',strictPort:true},
}));
