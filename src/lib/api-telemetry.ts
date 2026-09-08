import { rememberRestaurantSource } from './restaurant-provenance';
import { analyticsEnabled, track, trackRestaurant, analyticsContext } from './analytics';
import { classifyApi } from '../../supabase/functions/_shared/analytics-schema';
let installed = false;
export function installApiTelemetry() {
  if (installed || !analyticsEnabled || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    let capture: { api: NonNullable<ReturnType<typeof classifyApi>>; ctx: ReturnType<typeof analyticsContext>; requestId: string; fieldMask?: string; started: number };
    let options = init;
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const api = classifyApi(raw, init?.method || (input instanceof Request ? input.method : 'GET'));
      if (!api) return original(input, init);
      const ctx = analyticsContext();
      const requestId = crypto.randomUUID();
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      capture = { api, ctx, requestId, started: performance.now(), fieldMask: api.provider === 'google_places' ? headers.get('X-Goog-FieldMask') || '' : undefined };
      if (api.provider === 'edge_function') {
        headers.set('x-client-info', `${headers.get('x-client-info') || 'goodeats'}; ge_session=${ctx.session_id}; ge_page=${ctx.page}; ge_request=${requestId}`);
        options = { ...init, headers };
      }
    } catch { return original(input, init); }
    let status = 0;
    try {
      const response = await original(input, options); status = response.status;
      return response;
    } finally {
      try {
        const { api, ctx, requestId, started, fieldMask } = capture;
        // Do not stamp an earlier account's request with the next account's JWT.
        if (analyticsContext().user_id === ctx.user_id) track('api_request', {
          page: ctx.page, restaurant_id: api.restaurant_id || undefined,
          duration_ms: Math.min(3600000, Math.round(performance.now() - started)),
          properties: { provider: api.provider, endpoint: api.endpoint, status, source: ctx.page, request_id: requestId, field_mask: fieldMask },
        });
      } catch { /* Telemetry must never change a fetch response or exception. */ }
    }
  };
}
export function trackPlacesResults(places: Array<{id: string; name: string}>) {
  for (const p of places) {
    rememberRestaurantSource(p.id, 'google_places');
    trackRestaurant('restaurant_returned', p.id, p.name, { data_source: 'google_places' });
  }
}
