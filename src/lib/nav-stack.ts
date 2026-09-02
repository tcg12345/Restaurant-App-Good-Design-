import { KEEP_ALIVE_PATHS } from './keep-alive';

/**
 * In-app navigation model for the swipe-back gesture.
 *
 * The browser history is a flat chronological list, but the gesture needs
 * Instagram/iOS *stack* semantics: swiping back on a sub-view of a tab must
 * land on that tab's root, never on whatever tab happened to be visited
 * before it. Two pieces make that deterministic:
 *
 * 1. A record of every history entry we've seen this session, keyed by the
 *    router's history index (`recordNavEntry`, called on each location
 *    change). This lets us *know* what `navigate(-1)` would show.
 * 2. A table of logical parents (`logicalParent`): screens that are
 *    sub-views of another screen (a pantry list → the pantry root, an
 *    activity filter → the activity page, …).
 *
 * `backTargetFor` combines them: when the previous history entry belongs to
 * the same flow, a plain pop is correct (it preserves history and scroll
 * restoration). When it doesn't — deep link, tab switch, reload lost the
 * stack — we navigate to the logical parent instead, so the gesture NEVER
 * exits sideways into an unrelated screen.
 */

export interface NavEntry {
  pathname: string;
  search: string;
}

const entries = new Map<number, NavEntry>();

/** Record the entry at a history index. PUSH invalidates forward entries. */
export function recordNavEntry(idx: number, entry: NavEntry, navType: 'POP' | 'PUSH' | 'REPLACE'): void {
  if (navType === 'PUSH') {
    for (const k of [...entries.keys()]) if (k > idx) entries.delete(k);
  }
  entries.set(idx, entry);
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
const TAB_ROOT_PATHS = new Set<string>([...KEEP_ALIVE_PATHS, '/search']);

export function isTabRootLocation(pathname: string, search: string): boolean {
  return TAB_ROOT_PATHS.has(pathname) && logicalParent(pathname, search) === null;
}

export type BackTarget = { kind: 'pop' } | { kind: 'parent'; to: string };

/**
 * Where a back-swipe from the given location should go, or null when there is
 * no meaningful "back" (session root with no parent).
 */
export function backTargetFor(idx: number, pathname: string, search: string): BackTarget | null {
  const parent = logicalParent(pathname, search);
  const prev = idx > 0 ? entries.get(idx - 1) : undefined;
  if (parent) {
    // Previous entry within the same flow (the parent itself, a sibling
    // sub-view, a deeper page of the same section) → a pop is correct and
    // keeps real history. Anything else → go "up" to the parent.
    const parentPathname = parent.split('?')[0];
    if (prev && prev.pathname === parentPathname) return { kind: 'pop' };
    return { kind: 'parent', to: parent };
  }
  if (idx > 0) return { kind: 'pop' };
  return null;
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
export function stackKeyFor(pathname: string): string {
  const sheet = /^(\/user\/[^/]+)\/(followers|following|rated)$/.exec(pathname);
  return sheet ? `${sheet[1]}#sheet` : pathname;
}
