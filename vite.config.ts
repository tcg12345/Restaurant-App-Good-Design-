/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({mode}) => {
  return {
    plugins: [react(), tailwindcss()],
    // Strip console.* and debugger statements from production builds only —
    // dev and vitest keep them for debugging.
    ...(mode === 'production'
      ? {esbuild: {drop: ['console', 'debugger'] as Array<'console' | 'debugger'>}}
      : {}),
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
