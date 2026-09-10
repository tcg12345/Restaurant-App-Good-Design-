// Retired legacy endpoint; no current app callers. Never invoke a paid
// provider here. An explicit tombstone prevents accidental legacy redeploys.
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint retired' }), {
  status: 410, headers: { 'Content-Type': 'application/json' },
}));
