import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import base from '../vite.config';
export default defineConfig(env => mergeConfig(typeof base === 'function' ? base(env) : base, {
  plugins: [{ name: 'message-share-preview', enforce: 'pre', resolveId(source: string) {
    if (/(contexts\/(AuthContext|ListsContext|SettingsContext)|lib\/(places|supabase-community|recipe-display|glass-buttons)|pages\/useRestaurantDetail|components\/HomeLocationBar|\.\.\/HomeLocationBar)$/.test(source)) return path.resolve('scripts/message-share-preview-mocks.tsx');
  } }], server: { port: 3023, host: '127.0.0.1', strictPort: true },
}));
