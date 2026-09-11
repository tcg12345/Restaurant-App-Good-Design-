/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import hosting from './vercel.json';

export default defineConfig(({mode}) => {
  return {
    plugins: [react(), tailwindcss()],
    // Exercise the deployed browser restrictions in production previews too.
    // Development keeps its own HMR scripts and websocket unrestricted.
    preview: { headers: Object.fromEntries(hosting.headers[0].headers.map(({ key, value }) => [key, value])) },
    // Strip noisy console.log/debug and debugger statements from production
    // builds only — console.error/warn SURVIVE so field crashes leave
    // diagnostics (dropping 'console' wholesale compiled out even
    // componentDidCatch's report). Dev and vitest keep everything.
    ...(mode === 'production'
      ? {esbuild: {pure: ['console.log', 'console.debug'], drop: ['debugger'] as Array<'debugger'>}}
      : {}),
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
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
