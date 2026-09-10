// Retired legacy endpoint. Current cuisine lookup uses cuisine-lookup with
// handler authentication. Keep a tombstone so an old deployment cannot keep
// spending provider credits outside the supported app's usage controls.
Deno.serve(() => new Response(JSON.stringify({ error: 'Endpoint retired' }), {
  status: 410, headers: { 'Content-Type': 'application/json' },
}));
