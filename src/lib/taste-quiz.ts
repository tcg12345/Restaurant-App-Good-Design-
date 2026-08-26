import { supabase, supabaseConfigured } from './supabase';

/**
 * Persistence for the signup wizard's taste steps (components/onboarding/TasteSteps.tsx).
 *
 * Answers land in two places: a localStorage mirror (instant reads, works
 * for guests, survives until the profile refetch catches up) and
 * user_profiles.taste_profile (migration 059) so the signal follows the
 * account across devices. lib/recommendations.ts blends the cuisines in as
 * cold-start priors that fade as real ratings accumulate.
 */

export interface TasteQuizAnswers {
  atmosphere?: string;
  /** Legacy — the flavor question was cut (nothing ever consumed it). Old
   *  rows still carry it; new writes don't. */
  flavor?: string;
  /** Display-cased cuisine labels ("Italian") — the same tokens rating
   *  cuisines use, so recommendations can credit them directly. */
  cuisines?: string[];
  /** Stated spending comfort, Google price tiers 1–4 ($–$$$$). Seeds the
   *  price prior + priceDist so a $$$$ palate gets $$$$ recommendations
   *  before any rating exists. */
  prices?: number[];
  /** Legacy — the frequency question was cut (nothing ever consumed it). */
  frequency?: string;
  completedAt?: number;
}

const LOCAL_KEY = 'gourmad-taste-quiz';

function sanitize(raw: unknown): TasteQuizAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const answers: TasteQuizAnswers = {
    atmosphere: typeof o.atmosphere === 'string' ? o.atmosphere : undefined,
    flavor: typeof o.flavor === 'string' ? o.flavor : undefined,
    cuisines: Array.isArray(o.cuisines) ? o.cuisines.filter((c): c is string => typeof c === 'string') : undefined,
    prices: Array.isArray(o.prices)
      ? o.prices.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 4)
      : undefined,
    frequency: typeof o.frequency === 'string' ? o.frequency : undefined,
    completedAt: typeof o.completedAt === 'number' ? o.completedAt : undefined,
  };
  const hasAnything = answers.atmosphere || answers.flavor || answers.frequency
    || (answers.cuisines && answers.cuisines.length > 0)
    || (answers.prices && answers.prices.length > 0);
  return hasAnything ? answers : null;
}

function readLocal(): TasteQuizAnswers | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch { return null; }
}

/**
 * The current quiz answers: profile row first (cross-device truth), the
 * local mirror as fallback (guest mode, or a just-finished quiz whose
 * profile refetch hasn't landed yet).
 */
export function getTasteQuiz(profile?: { taste_profile?: unknown } | null): TasteQuizAnswers | null {
  return sanitize(profile?.taste_profile) ?? readLocal();
}

/** Persist quiz answers: local mirror always, profile row when signed in. */
export async function saveTasteQuiz(userId: string | null | undefined, answers: TasteQuizAnswers): Promise<void> {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(answers)); } catch { /* storage unavailable */ }
  if (!userId || !supabaseConfigured) return;
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ taste_profile: answers, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) console.warn('[taste-quiz] persist failed (local mirror kept):', error.message);
  } catch (err) {
    console.warn('[taste-quiz] persist failed (local mirror kept):', err);
  }
}
