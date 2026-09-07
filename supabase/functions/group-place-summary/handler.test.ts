// Offline handler checks: all auth, database and paid-provider requests are mocked.
let handler: (req: Request) => Response | Promise<Response>;
const originalServe = Deno.serve;
Deno.serve = ((fn: typeof handler) => { handler = fn; return {} as any; }) as typeof Deno.serve;
await import('./index.ts');
Deno.serve = originalServe;
function assert(value: unknown, message: string) { if (!value) throw Error(message); }
const request = (place = 'one') => new Request('https://local.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ payload: { id: '00000000-0000-0000-0000-000000000001', place } }) });
Deno.test('preflight and missing authentication never reach services', async () => {
  assert((await handler(new Request('https://local.test', { method: 'OPTIONS' }))).status === 200, 'preflight');
  assert((await handler(new Request('https://local.test', { method: 'POST' }))).status === 401, 'authentication required');
  assert((await handler(new Request('https://local.test'))).status === 405, 'only POST');
});
Deno.test('membership and deck authorization happen before quota or paid calls; generation is cached', async () => {
  const previousFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_PLACES_API_KEY'];
  const previousEnv = keys.map(key => Deno.env.get(key));
  keys.forEach(key => Deno.env.set(key, key === 'SUPABASE_URL' ? 'https://project.test' : 'test-only'));
  let member = false, allowed = true, failQuota = false, quotaCalls = 0, aiCalls = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/auth/v1/user')) return json({ id: 'member', aud: 'authenticated' });
    if (url.includes('group_room_action')) return member ? json({ deck: [{ id: 'one', name: 'Italian restaurant', cuisine: 'Italian' }] }) : json({ message: 'Not a member' }, 403);
    if (url.includes('consume_ai_rate_limit')) { quotaCalls++; return failQuota ? json({ message: 'Unavailable' }, 503) : json(allowed); }
    if (url.includes('places.googleapis.com')) return json({ editorialSummary: { text: 'Italian cooking.' } });
    if (url.includes('api.anthropic.com')) { aiCalls++; return json({ content: [{ type: 'text', text: 'A restaurant serving Italian food.' }] }); }
    throw Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    assert((await handler(request())).status === 403, 'nonmember rejected');
    assert(quotaCalls === 0 && aiCalls === 0, 'no paid work for nonmember');
    member = true;
    assert((await handler(request('outside'))).status === 403, 'outside restaurant rejected');
    assert(quotaCalls === 0, 'no quota for outside restaurant');
    allowed = false;
    assert((await handler(request())).status === 429, 'rate limit enforced');
    failQuota = true;
    assert((await handler(request())).status === 503, 'quota failure is closed');
    failQuota = false; allowed = true;
    const success = await handler(request());
    assert(success.status === 200 && (await success.json()).summary === 'A restaurant serving Italian food.', 'generated summary');
    assert((await handler(request())).status === 200 && aiCalls === 1, 'cache avoids another paid call');
    member = false;
    assert((await handler(request())).status === 403, 'cache cannot bypass membership');
  } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((key, index) => previousEnv[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previousEnv[index]!));
  }
});
