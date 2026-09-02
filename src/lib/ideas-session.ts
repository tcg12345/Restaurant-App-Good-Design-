/**
 * The AI creator's brainstorm, parked while the user leaves the modal to
 * check the real Search page for an existing recipe ("Find existing" on
 * an idea card). The modal unmounts on close, so the session has to live
 * outside React; the search page's back arrow reopens the creator, which
 * takes the session back (once) and picks up exactly where it was —
 * same ideas, same picks, same guideline pills.
 *
 * Module-level on purpose: same tab, same JS context, minutes apart. Not
 * storage — a stale brainstorm from last week resurfacing would be worse
 * than none.
 */

import type { RecipeIdea } from './build-recipe-client';

export interface IdeasSession {
  ideas: RecipeIdea[];
  selectedTitles: string[];
  ideasPrompt: string;
  shownTitles: string[];
  guidelines: {
    difficulty: string;
    timeBudget: string;
    servings: number | null;
    course: string;
    dietary: string[];
  };
  savedAt: number;
}

const MAX_AGE_MS = 30 * 60 * 1000;

let parked: IdeasSession | null = null;

export function saveIdeasSession(session: Omit<IdeasSession, 'savedAt'>): void {
  parked = { ...session, savedAt: Date.now() };
}

/** Take the parked session (clearing it). Null when there is none or it
 *  has gone stale. */
export function takeIdeasSession(now = Date.now()): IdeasSession | null {
  const s = parked;
  parked = null;
  if (!s || now - s.savedAt > MAX_AGE_MS) return null;
  return s;
}

export function hasIdeasSession(): boolean {
  return !!parked && Date.now() - parked.savedAt <= MAX_AGE_MS;
}
