import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import base from '../vite.config';
export default defineConfig(env => mergeConfig(typeof base === 'function' ? base(env) : base, {
 plugins: [{ name: 'pins-preview', enforce: 'pre', resolveId(source: string) {
  if (/(contexts\/SettingsContext|lib\/pins-store)$/.test(source)) return path.resolve('scripts/pins-preview-mocks.tsx');
 } }], server: { port: 3024, host: '127.0.0.1', strictPort: true },
}));
