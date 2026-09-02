// Persistent saved drafts for the Advanced Recipe Builder.
//
// Two separate concerns:
//
//   1. AUTO-RESUME — the always-on debounced snapshot the wizard
//      writes on every keystroke. Lives in a single slot so the
//      "Resume your draft?" prompt on next modal-open has something
//      to offer. Cleared on Publish. NOT exposed in Activity.
//
//   2. SAVED DRAFTS — explicit "Save draft" entries. Each click of
//      the footer button writes (or updates) a row in an array keyed
//      by user. These are what surfaces on Activity → Recipe drafts
//      and what the user picks when they want to come back to an
//      old in-progress recipe later.
//
// Resume handoff from Activity → modal uses a tiny one-shot flag in
// localStorage so the Activity page doesn't need a callback into the
// builder.

import type { AdvancedRecipeState } from '../components/AdvancedRecipeBuilder';

const SAVED_KEY = (userId: string | null) => `goodeats-recipe-drafts-${userId || 'anon'}`;
const RESUME_FLAG_KEY = 'goodeats-resume-draft-id';
const MAX_DRAFTS = 30;

export interface RecipeDraft {
  /** Stable identifier; persistent across edits to the same draft. */
  id: string;
  /** Derived from state.name; falls back to "Untitled recipe". */
  title: string;
  /** Optional cover thumbnail snapshot — base64 or URL. */
  coverPhoto?: string;
  /** When this draft was last explicitly saved (ms since epoch). */
  savedAt: number;
  /** When the draft was first created (ms since epoch). */
  createdAt: number;
  /** Which step the user was on when they last saved. */
  currentStep: number;
  /** Full reducer snapshot — reloads into the wizard verbatim. */
  state: AdvancedRecipeState;
  /** Optional: the existing meal id this draft is editing. Lets the
   *  builder know to call updateHomeMeal vs createHomeMeal when
   *  publishing. Undefined for brand-new recipe drafts. */
  editingMealId?: string;
}

/* ── Load / store ────────────────────────────────────────────── */

export function loadDrafts(userId: string | null): RecipeDraft[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to entries that at least look like RecipeDraft.
    return parsed.filter((d): d is RecipeDraft =>
      d && typeof d === 'object' && typeof d.id === 'string' && d.state && typeof d.state === 'object',
    );
  } catch { return []; }
}

function persist(userId: string | null, drafts: RecipeDraft[]): void {
  // Cap at MAX_DRAFTS — newest first when over the cap.
  const bounded = [...drafts]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_DRAFTS);
  try {
    localStorage.setItem(SAVED_KEY(userId), JSON.stringify(bounded));
  } catch (err) {
    // Quota exceeded — drop oldest one at a time until it fits.
    let working = bounded;
    while (working.length > 1) {
      working = working.slice(0, -1);
      try {
        localStorage.setItem(SAVED_KEY(userId), JSON.stringify(working));
        return;
      } catch { /* keep trimming */ }
    }
    console.warn('[recipe-drafts] persist failed:', err);
  }
}

/** Add or update. If `id` matches an existing draft, that one is
 *  updated in place; otherwise the entry is appended. Returns the
 *  saved draft (with its final id, in case the caller didn't pass one). */
export function saveDraft(
  userId: string | null,
  payload: Omit<RecipeDraft, 'createdAt' | 'savedAt'> & { id?: string; createdAt?: number },
): RecipeDraft {
  const now = Date.now();
  const drafts = loadDrafts(userId);
  const id = payload.id || `draft-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const idx = drafts.findIndex((d) => d.id === id);
  const next: RecipeDraft = {
    id,
    title: payload.title,
    coverPhoto: payload.coverPhoto,
    createdAt: idx >= 0 ? drafts[idx].createdAt : (payload.createdAt || now),
    savedAt: now,
    currentStep: payload.currentStep,
    state: payload.state,
    editingMealId: payload.editingMealId,
  };
  if (idx >= 0) drafts[idx] = next;
  else drafts.unshift(next);
  persist(userId, drafts);
  return next;
}

export function removeDraft(userId: string | null, id: string): void {
  const drafts = loadDrafts(userId).filter((d) => d.id !== id);
  persist(userId, drafts);
}

export function getDraft(userId: string | null, id: string): RecipeDraft | null {
  return loadDrafts(userId).find((d) => d.id === id) || null;
}

/* ── Resume handoff (Activity page → modal) ──────────────────── */

/** Stash a draft id so the next-mounted AdvancedRecipeBuilder picks it
 *  up. The Activity drafts row calls this just before triggering the
 *  modal open, so the modal hydrates from that specific draft. */
export function setPendingResumeDraftId(id: string): void {
  try { localStorage.setItem(RESUME_FLAG_KEY, id); } catch { /* quota */ }
}

/** Read + clear the resume flag in one shot — designed for a mount
 *  effect inside the builder. */
export function consumePendingResumeDraftId(): string | null {
  try {
    const id = localStorage.getItem(RESUME_FLAG_KEY);
    if (id) localStorage.removeItem(RESUME_FLAG_KEY);
    return id || null;
  } catch { return null; }
}

/** Peek without consuming — used by AddHomeMealModal to decide
 *  whether to force the Advanced tab on open. */
export function peekPendingResumeDraftId(): string | null {
  try { return localStorage.getItem(RESUME_FLAG_KEY); } catch { return null; }
}

/* ── Display helpers ─────────────────────────────────────────── */

export function deriveDraftTitle(state: AdvancedRecipeState): string {
  const t = state.name.trim();
  if (t) return t;
  return 'Untitled recipe';
}

export function formatDraftTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
