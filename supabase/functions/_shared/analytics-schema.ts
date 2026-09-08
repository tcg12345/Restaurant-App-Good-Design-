/** Shared, deliberately content-free API classification. Never persist raw URLs,
 * request/response bodies, headers, tokens, chat text, or coordinates. */
export function classifyApi(raw: string, method = 'GET') {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const path = u.pathname;
  if (u.hostname === 'places.googleapis.com') {
    const id = path.match(/^\/v1\/places\/([^/:]+)/)?.[1];
    return { provider: 'google_places', endpoint: path.includes('/photos/') ? 'photo' : path.endsWith(':searchText') ? 'search_text' : path.endsWith(':searchNearby') ? 'search_nearby' : 'details', restaurant_id: id ? decodeURIComponent(id).slice(0, 160) : null };
  }
  if (u.hostname.endsWith('.supabase.co')) {
    if (/analytics|is_app_admin/.test(path)) return null;
    const fn = path.match(/\/functions\/v1\/([\w-]+)/)?.[1];
    const table = path.match(/\/rest\/v1\/(?:rpc\/)?([\w-]+)/)?.[1];
    return { provider: fn ? 'edge_function' : 'supabase', endpoint: fn ?? (table ? `${method.toLowerCase()}:${table}` : path.startsWith('/auth/') ? 'auth' : 'storage'), restaurant_id: null };
  }
  const known: Record<string, string> = { 'api.anthropic.com': 'anthropic', 'api.openai.com': 'openai', 'api.mapbox.com': 'mapbox', 'events.mapbox.com': 'mapbox', 'api.stripe.com': 'stripe', 'api.revenuecat.com': 'revenuecat', 'api.mux.com': 'mux', 'overpass-api.de': 'overpass', 'overpass.kumi.systems': 'overpass' };
  const provider = known[u.hostname];
  if (!provider) return null;
  const endpoint = provider === 'anthropic' ? 'messages' : provider === 'openai' ? (path.includes('images') ? 'images' : 'responses') : provider === 'mapbox' ? (path.includes('geocod') ? 'geocoding' : path.includes('directions') ? 'directions' : 'map_resource') : provider === 'stripe' ? (path.includes('checkout') ? 'checkout' : 'billing') : provider === 'mux' ? (path.includes('uploads') ? 'upload' : 'asset') : 'request';
  return { provider, endpoint, restaurant_id: null };
}

export function pageName(path: string): string {
  const p = path.split(/[?#]/)[0];
  if (p === '/') return 'home';
  if (p.startsWith('/admin')) return 'admin';
  const parts = p.split('/').filter(Boolean);
  const root = parts[0] || 'home';
  if (['restaurant', 'recipe', 'meal', 'review', 'user', 'guides'].includes(root)) {
    const suffix = parts.at(-1);
    return `${root}${parts.length > 1 ? '_detail' : ''}${['circle', 'taste', 'followers', 'following', 'rated', 'edit'].includes(suffix || '') ? `_${suffix}` : ''}`;
  }
  return p.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-z_-]/g, '').slice(0, 80) || 'other';
}

const allowed = new Set(['visit_id', 'data_source', 'source', 'destination', 'action', 'outcome', 'query', 'result_count', 'search_id', 'provider', 'endpoint', 'status', 'cache_hit', 'request_id', 'field_mask', 'error_type', 'plan', 'verdict', 'surface', 'city', 'cuisine', 'reason', 'model', 'input_tokens', 'output_tokens', 'stage', 'rating', 'is_new', 'attempt', 'version']);
export function safeProperties(input: Record<string, unknown> = {}) {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    if (key === 'visit_id') {
      if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) out[key] = value;
      continue;
    }
    if (key === 'data_source' && !['google_places', 'own_data', 'mixed', 'unknown'].includes(String(value))) continue;
    if (typeof value === 'string') {
      // Search terms are opt-in, with a second scrub for obvious identifiers.
      out[key] = value.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]').replace(/\b(?:\+?\d[\s().-]*){8,}\b/g, '[number]').slice(0, key === 'field_mask' ? 1200 : 160);
    } else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
  }
  return out;
}
