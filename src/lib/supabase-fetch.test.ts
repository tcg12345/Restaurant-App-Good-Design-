import { afterEach, expect, it, vi } from 'vitest';
import { supabaseFetch } from './supabase-fetch';
afterEach(() => vi.unstubAllGlobals());
it('keeps a small analytics batch alive across reload without changing its authorization or payload', async () => {
  const request = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal('fetch', request);
  const options = { method: 'POST', body: '{"events":[]}', headers: { Authorization: 'Bearer test-token', apikey: 'test-key' } };
  await supabaseFetch('https://example.supabase.co/rest/v1/rpc/analytics_collect', options);
  expect(request).toHaveBeenCalledWith('https://example.supabase.co/rest/v1/rpc/analytics_collect', { ...options, keepalive: true });
});
it('leaves normal Supabase requests and oversized batches unchanged', async () => {
  const request = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal('fetch', request);
  const auth = { method: 'POST', body: '{}' };
  await supabaseFetch('https://example.supabase.co/auth/v1/logout', auth);
  expect(request.mock.calls[0][1]).toBe(auth);
  const large = { method: 'POST', body: 'a'.repeat(49 * 1024) };
  await supabaseFetch('https://example.supabase.co/rest/v1/rpc/analytics_collect', large);
  expect(request.mock.calls[1][1]).toBe(large);
});
