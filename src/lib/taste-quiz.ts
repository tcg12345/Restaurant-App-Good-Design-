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
  /** Legacy flat shape — stated spending comfort, Google price tiers 1–4,
   *  in selection order. Still written by the current multi-select step and
   *  still read (quizPriceTiers takes [0] as primary, [1] as secondary), so
   *  no row needs migrating. */
  prices?: number[];
  /** "A normal night out" — the dominant tier. A single dominant tier is
   *  what crosses priceDist's concentration threshold and switches on the
   *  price-restricted Places query; a flat multi-select does not. */
  pricePrimary?: number;
  /** "…and when I'm celebrating" — optional, half the primary's weight. */
  priceSecondary?: number;
  /** Cuisines to steer AWAY from → negative priors (negativeMult). */
  avoidCuisines?: string[];
  /** Dietary preference keys → positive ALL_TAGS priors. Preferences, not
   *  health data: keep it optional and keep the vocabulary coarse. */
  dietary?: string[];
  /** Stated home city label → seeds city affinity, which is otherwise only
   *  ever derived from the addresses of already-rated places. */
  city?: string;
  /** Legacy — the frequency question was cut (nothing ever consumed it). */
  frequency?: string;
  completedAt?: number;
}

const LOCAL_KEY = 'gourmad-taste-quiz';

const isTier = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4;

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
    pricePrimary: isTier(o.pricePrimary) ? o.pricePrimary : undefined,
    priceSecondary: isTier(o.priceSecondary) ? o.priceSecondary : undefined,
    avoidCuisines: Array.isArray(o.avoidCuisines)
      ? o.avoidCuisines.filter((c): c is string => typeof c === 'string')
      : undefined,
    dietary: Array.isArray(o.dietary)
      ? o.dietary.filter((c): c is string => typeof c === 'string')
      : undefined,
    city: typeof o.city === 'string' ? o.city : undefined,
    frequency: typeof o.frequency === 'string' ? o.frequency : undefined,
    completedAt: typeof o.completedAt === 'number' ? o.completedAt : undefined,
  };
  const hasAnything = answers.atmosphere || answers.flavor || answers.frequency
    || (answers.cuisines && answers.cuisines.length > 0)
    || (answers.prices && answers.prices.length > 0)
    || answers.pricePrimary !== undefined
    || (answers.avoidCuisines && answers.avoidCuisines.length > 0)
    || (answers.dietary && answers.dietary.length > 0)
    || !!answers.city;
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
