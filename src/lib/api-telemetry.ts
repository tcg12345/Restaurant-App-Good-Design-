import { analyticsEnabled, track, trackRestaurant, analyticsContext } from './analytics';
import { classifyApi } from '../../supabase/functions/_shared/analytics-schema';
let installed = false;
export function installApiTelemetry() {
  if (installed || !analyticsEnabled || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const api = classifyApi(raw, method);
    if (!api) return original(input, init);
    const started = performance.now();
    const ctx = analyticsContext();
    let status = 0;
    const requestId = crypto.randomUUID();
    try {
      let options = init;
      if (api.provider === 'edge_function') {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('x-client-info', `${headers.get('x-client-info') || 'goodeats'}; ge_session=${ctx.session_id}; ge_page=${ctx.page}; ge_request=${requestId}`);
        options = { ...init, headers };
      }
      const response = await original(input, options); status = response.status;
      return response;
    } finally {
      // Captured at initiation so a navigation during the request doesn't change its origin.
      track('api_request', { restaurant_id: api.restaurant_id || undefined, duration_ms: Math.round(performance.now() - started), properties: { provider: api.provider, endpoint: api.endpoint, status, source: ctx.page, request_id: requestId, field_mask: api.provider === 'google_places' ? new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)).get('X-Goog-FieldMask') || '' : undefined } });
    }
  };
}
export function trackPlacesResults(places: Array<{id: string; name: string}>) {
  for (const p of places) trackRestaurant('restaurant_returned', p.id, p.name);
}
