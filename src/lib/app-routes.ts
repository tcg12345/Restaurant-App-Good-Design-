// Whitelist of in-app route PATTERNS the AI assistant's `navigate` tool is
// allowed to send the user to. Mirrors the <Route> table in App.tsx.
//
// The assistant runs with third-party text (expert bios, place names, recipe
// titles) in its context, so a prompt-injection can try to drive `navigate`.
// The old guard only checked `path.startsWith('/')`, which happily accepts
// protocol-relative URLs ("//evil.example"), path traversal ("/../secret"),
// and any made-up route. Matching against the real route table instead means
// navigation can only ever land on a genuine in-app page.
//
// Keep this list in sync with App.tsx. `:param` segments match any single
// non-empty path segment.
const ROUTE_PATTERNS: string[] = [
  '/',
  '/map',
  '/circle',
  '/create',
  '/search',
  '/search/main',
  '/reels',
  '/r/:focusKey',
  '/activity',
  '/activity/saved',
  '/activity/likes',
  '/activity/comments',
  '/activity/drafts',
  '/experts',
  '/verify/apply',
  '/admin/verification',
  '/profile',
  '/pantry',
  '/pantry/recommended',
  '/restaurant/:id',
  '/restaurant/:id/circle',
  '/import',
  '/reorder',
  '/recipes-for-you',
  '/recipe/:userId/:id',
  '/recipe/:id',
  '/guides/:id',
  '/guides/:id/edit',
  '/meal/:userId/:mealId',
  '/user/:username',
  '/messages',
  '/review/:ratingId',
  '/location',
  '/location/map',
];

/** Split a path into its segments, dropping the leading empty one and a
 *  single trailing slash. '/' → [''], '/pantry/' → ['pantry']. */
function segmentsOf(path: string): string[] {
  const segs = path.split('/').slice(1);
  if (segs.length > 1 && segs[segs.length - 1] === '') segs.pop();
  return segs;
}

const PATTERN_SEGMENTS = ROUTE_PATTERNS.map(segmentsOf);

/**
 * True when `rawPath` is a real, same-origin in-app route.
 *
 * Rejects anything that isn't an absolute single-slash path (blocks
 * "//host" protocol-relative URLs and scheme URLs, which don't start with a
 * lone '/'), anything with a `..` traversal or a backslash, and anything that
 * doesn't structurally match one of the known route patterns.
 */
export function isAllowedAppPath(rawPath: string): boolean {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/') || rawPath.startsWith('//')) {
    return false;
  }
  // Route matching ignores the query string / hash.
  const path = rawPath.split(/[?#]/, 1)[0];
  if (path.includes('..') || path.includes('\\')) return false;

  const segs = segmentsOf(path);
  return PATTERN_SEGMENTS.some((pat) => {
    if (pat.length !== segs.length) return false;
    return pat.every((ps, i) => (ps.startsWith(':') ? segs[i].length > 0 : ps === segs[i]));
  });
}
