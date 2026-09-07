/** Preview-only service stubs: no account access, AI requests, or quota usage. */
import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import base from '../vite.config';
export default defineConfig(env => mergeConfig(typeof base === 'function' ? base(env) : base, {
  plugins: [{ name: 'recipe-preview-mocks', enforce: 'pre', resolveId(source: string) {
    if (/(contexts\/(PaywallContext|PlanContext)|hooks\/useTastePreferences|lib\/(build-recipe-client|import-recipe-client))$/.test(source)) return path.resolve('scripts/recipe-preview-mocks.ts');
  } }], server: { port: 3012, host: '127.0.0.1', strictPort: true },
}));
