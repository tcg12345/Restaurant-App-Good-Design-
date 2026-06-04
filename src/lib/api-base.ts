// Resolve the base URL for the `/api/*` serverless functions.
//
// On the web the app is served from the same Vercel domain as the API, so
// relative paths ('/api/foo') just work — and stay correct across preview
// deployments and custom domains. But the native (Capacitor) build serves
// the bundled web assets from capacitor://localhost, where there is no
// backend, so those relative calls have nowhere to go. There we must point
// at the deployed API explicitly via VITE_API_BASE_URL (baked into the
// native bundle at build time).
//
// VITE_API_BASE_URL is only consulted on native, so it's safe to leave set
// during web dev/builds — the web path always uses relative URLs.

import { Capacitor } from '@capacitor/core';

const PROD_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** Absolute on native (Vercel domain), relative on web. `path` should start
 *  with a leading slash, e.g. apiUrl('/api/location-chat'). */
export function apiUrl(path: string): string {
  if (Capacitor.isNativePlatform() && PROD_API_BASE) {
    return `${PROD_API_BASE}${path}`;
  }
  return path;
}
