import { AsyncLocalStorage } from 'node:async_hooks';
import { classifyApi, safeProperties } from './analytics-schema.ts';
type Context = { source: string; userId?: string; requestId: string; sessionId?: string; page?: string; rows: Record<string, unknown>[] };
const context = new AsyncLocalStorage<Context>();
export function setTelemetryUser(userId: string) { const c = context.getStore(); if(c) c.userId = userId; }

async function write(c: Context) {
  if ((globalThis as any).Deno?.env.get('ANALYTICS_ENABLED') !== 'true' || !c.rows.length) return;
  const key = (globalThis as any).Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) return;
  try {
    const response = await globalThis.fetch(`${(globalThis as any).Deno?.env.get('SUPABASE_URL')}/rest/v1/analytics_events`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(c.rows.map(row => ({ ...row, user_id: c.userId || null }))), signal: AbortSignal.timeout(3000) });
    if (!response.ok) console.warn('[analytics] server batch rejected', response.status);
  } catch { console.warn('[analytics] server batch unavailable'); }
}
export function withRequestTelemetry(source: string, handler: (req: Request, ...args: any[]) => Response | Promise<Response>) {
  return (req: Request, ...args: any[]) => context.run({ source, requestId: crypto.randomUUID(), rows: [] }, async () => {
    const c = context.getStore()!;
    const info = req.headers.get('x-client-info') || '';
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    c.sessionId = info.match(new RegExp(`(?:^|; )ge_session=(${uuid})(?:;|$)`))?.[1];
    c.requestId = info.match(new RegExp(`(?:^|; )ge_request=(${uuid})(?:;|$)`))?.[1] || c.requestId;
    c.page = info.match(/(?:^|; )ge_page=([a-z_]{1,80})(?:;|$)/)?.[1];
    try { return await handler(req, ...args); }
    finally {
      // Keep streaming responses fast while Supabase completes the telemetry write.
      const promise = write(c);
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(promise); else await promise;
    }
  });
}
/** Locally imported as fetch. No global replacement and no cross-request identity leakage. */
export async function instrumentedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const c = context.getStore();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const api = classifyApi(url, init?.method);
  if (!c || !api || (globalThis as any).Deno?.env.get('ANALYTICS_ENABLED') !== 'true') return globalThis.fetch(input, init);
  const start = performance.now(); let status = 0;
  try { const response = await globalThis.fetch(input, init); status = response.status; return response; }
  finally {
    if (c.rows.length < 300) c.rows.push({ id: crypto.randomUUID(), anon_id: `server:${c.requestId}`, session_id: c.sessionId || c.requestId, occurred_at: new Date().toISOString(), event: 'api_request', page: c.page || c.source, origin: 'server', platform: 'server', restaurant_id: api.restaurant_id, duration_ms: Math.min(3600000,Math.round(performance.now()-start)), properties: safeProperties({ ...api, source: c.source, request_id: c.requestId, status, field_mask: api.provider==='google_places' ? new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).get('X-Goog-FieldMask') || '' : undefined }) });
  }
}
