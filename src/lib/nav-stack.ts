import { KEEP_ALIVE_PATHS } from './keep-alive';

/** Back follows the entry that actually presented a page. Logical parents
 * are only fallbacks for direct links or history we cannot verify. */

export interface NavEntry {
  pathname: string;
  search: string;
}

const STORAGE_KEY = 'goodeats-navigation-session';
const entries = new Map<number, NavEntry>();
// Same-tab reloads retain verified in-app history; a new tab starts empty.
try {
  const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
  for (const [idx, entry] of stored) {
    if (Number.isInteger(idx) && idx >= 0 && typeof entry?.pathname === 'string'
      && entry.pathname.startsWith('/') && !entry.pathname.startsWith('//') && typeof entry.search === 'string') entries.set(idx, entry);
  }
} catch { /* SSR, disabled storage, or an older malformed cache. */ }


/** Record the entry at a history index. PUSH invalidates forward entries. */
export function recordNavEntry(idx: number, entry: NavEntry, navType: 'POP' | 'PUSH' | 'REPLACE'): void {
  if (navType === 'PUSH') {
    for (const k of [...entries.keys()]) if (k > idx) entries.delete(k);
  }
  entries.set(idx, entry);
  if (entries.size > 150) entries.delete(entries.keys().next().value!);
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entries])); } catch { /* memory-only history */ }
}

export function navEntryAt(idx: number): NavEntry | undefined {
  return entries.get(idx);
}

/** Does this /pantry search string select a sub-view (list / trips / cooking)? */
const isPantrySubView = (search: string): boolean => {
  const sp = new URLSearchParams(search);
  return sp.has('list') || sp.has('view');
};

/**
 * The screen a back-swipe should reveal when plain history can't be trusted.
 * Only sub-views that have an unambiguous "up" belong here; detail pages
 * (restaurant, recipe, user…) legitimately return to wherever they were
 * opened from and are handled by the history pop.
 */
export function logicalParent(pathname: string, search: string): string | null {
  if (pathname === '/messages' && /(?:^|[?&])(conversation|to)=/.test(search)) return '/messages';
  const people = /^(\/user\/[^/]+)\/(followers|following|rated)$/.exec(pathname);
  if (people) return people[1];
  if (pathname === '/verify/apply') return '/settings/verification';
  if (/^\/settings\/(email|phone|password|verification|delete)$/.test(pathname)) return '/settings/account';
  if (/^\/settings\/[^/]+$/.test(pathname)) return '/settings';
  if (pathname === '/pantry' && isPantrySubView(search)) return '/pantry';
  if (pathname === '/pantry/recommended') return '/pantry';
  if (pathname === '/profile/taste' || /^\/profile\/top\/[^/]+$/.test(pathname)) return '/profile';
  const userTaste = /^(\/user\/[^/]+)\/taste$/.exec(pathname);
  if (userTaste) return userTaste[1];
  if (/^\/activity\/(saved|likes|comments|drafts)$/.test(pathname)) return '/activity';
  const circle = /^(\/restaurant\/[^/]+)\/circle$/.exec(pathname);
  if (circle) return circle[1];
  const guideEdit = /^(\/guides\/[^/]+)\/edit$/.exec(pathname);
  if (guideEdit) return guideEdit[1];
  if (pathname === '/location/map') return '/location';
  return null;
}

/**
 * Bottom-nav destinations. Swipe-back is disabled on these (tabs are switched
 * via the nav bar, never by swiping "back" into whichever tab history holds) —
 * unless the current URL is really a sub-view of the tab (e.g. /pantry?list=x).
 */
const TAB_ROOT_PATHS = new Set<string>([...KEEP_ALIVE_PATHS, '/search', '/map', '/reels']);

export function isTabRootLocation(pathname: string, search: string): boolean {
  return TAB_ROOT_PATHS.has(pathname) && logicalParent(pathname, search) === null;
}

export type BackTarget = { kind: 'pop' } | { kind: 'parent'; to: string };

/**
 * Where a back-swipe from the given location should go, or null when there is
 * no meaningful "back" (session root with no parent).
 */
export function fallbackForPath(pathname: string, search = ''): string | null {
  const parent = logicalParent(pathname, search);
  if (parent) return parent;
  if (isTabRootLocation(pathname, search)) return null;
  if (pathname.startsWith('/restaurant/')) return '/search/main';
  if (/^\/(recipe|meal|import|reorder|recipes-for-you)(\/|$)/.test(pathname)) return '/pantry';
  if (pathname.startsWith('/user/')) return '/circle';
  if (pathname === '/settings' || pathname === '/activity') return '/profile';
  return '/';
}

export function backTargetFor(idx: number, pathname: string, search: string, fallback?: string): BackTarget | null {
  const prev = idx > 0 ? entries.get(idx - 1) : undefined;
  if (prev) return { kind: 'pop' };
  const parent = logicalParent(pathname, search) || fallback || fallbackForPath(pathname, search);
  return parent && parent !== pathname + search ? { kind: 'parent', to: parent } : null;
}

/**
 * Routes presented as a SHEET — they rise from the bottom over the page
 * that opened them rather than pushing it aside. Today that is the stat
 * lists hanging off a profile (`/user/:username/followers|following|rated`),
 * which are a modal view of that profile rather than a destination.
 */
export function isSheetPath(pathname: string): boolean {
  return /^\/user\/[^/]+\/(followers|following|rated)$/.test(pathname);
}

/**
 * The identity of the SHEET a path belongs to, ignoring which tab inside it
 * is open. The route stack keys its pages by this, so switching between a
 * profile's followers / following / rated tabs updates the sheet in place
 * instead of tearing it down and playing the whole rise-from-the-bottom
 * animation again for what is really one sheet with three tabs.
 */
export function stackKeyFor(pathname: string, search = ''): string {
  if (pathname === '/messages') {
    const params = new URLSearchParams(search);
    return `${pathname}#${params.get('conversation') || params.get('to') || 'inbox'}`;
  }
  const sheet = /^(\/user\/[^/]+)\/(followers|following|rated)$/.exec(pathname);
  return sheet ? `${sheet[1]}#sheet` : pathname;
}
