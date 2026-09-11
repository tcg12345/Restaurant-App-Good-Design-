import { retiredEndpoint } from '../_shared/retired-endpoint.ts';

// Retired legacy API; the current application has no callers.
Deno.serve(retiredEndpoint);
