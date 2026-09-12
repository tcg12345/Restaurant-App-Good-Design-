import { COMMUNITY_CONTENT_CHANGED, isCommunityWrite } from './community-screening';
/** Let a small, already-authenticated telemetry request finish when its page
 * reloads. Keep this scoped to analytics; normal app requests retain their
 * existing fetch behavior. Reserve space below the browser's 64 KiB budget. */
export const supabaseFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let isAnalytics = false;
  try { isAnalytics = new URL(url).pathname === '/rest/v1/rpc/analytics_collect'; } catch { /* other request */ }
  const smallBatch = typeof init?.body === 'string' && new TextEncoder().encode(init.body).byteLength <= 48 * 1024;
  const response = fetch(input, isAnalytics && smallBatch ? { ...init, keepalive: true } : init);
  const method = init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
  if (isCommunityWrite(url, method)) void response.then(result => {
    if (result.ok && typeof window !== 'undefined') window.dispatchEvent(new Event(COMMUNITY_CONTENT_CHANGED));
  }).catch(() => {});
  return response;
};
