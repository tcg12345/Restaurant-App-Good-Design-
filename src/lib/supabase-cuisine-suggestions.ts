/**
 * Cuisine suggestions (cuisine_suggestions, migration 069).
 *
 * A cuisine everyone sees is no longer something a user can just write.
 * They propose one; it applies when an admin approves it, or when enough
 * independent people propose the same thing. Nothing here can change what
 * anyone sees on its own — the approve/deny RPCs check is_app_admin()
 * server-side, and the tiers those RPCs write are refused outright when
 * the caller is `authenticated` (see the guard in 069).
 */
import { supabase, supabaseConfigured } from './supabase';

export type SuggestionStatus = 'pending' | 'approved' | 'denied' | 'auto';

export interface CuisineSuggestion {
  id: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  currentCuisine: string;
  cuisine: string;
  userId: string;
  status: SuggestionStatus;
  denyReason: string | null;
  createdAt: string;
}

/** How many people suggesting the same thing applies it without review.
 *  Mirrors cuisine_auto_apply_votes() in 069 — the DB is authoritative;
 *  this is here so the UI can say what the number is. */
export const AUTO_APPLY_VOTES = 5;

interface Row {
  id: string;
  restaurant_id: string;
  restaurant_name: string | null;
  restaurant_address: string | null;
  current_cuisine: string | null;
  cuisine: string;
  user_id: string;
  status: SuggestionStatus;
  deny_reason: string | null;
  created_at: string;
}

const toSuggestion = (r: Row): CuisineSuggestion => ({
  id: r.id,
  restaurantId: r.restaurant_id,
  restaurantName: r.restaurant_name || '',
  restaurantAddress: r.restaurant_address || '',
  currentCuisine: r.current_cuisine || '',
  cuisine: r.cuisine,
  userId: r.user_id,
  status: r.status,
  denyReason: r.deny_reason,
  createdAt: r.created_at,
});

const SELECT = 'id, restaurant_id, restaurant_name, restaurant_address, current_cuisine, cuisine, user_id, status, deny_reason, created_at';

/**
 * Propose a cuisine. Replaces this user's own earlier proposal for the
 * same restaurant rather than adding a second one — changing your mind is
 * not a second vote (the UNIQUE (restaurant_id, user_id) in 069 enforces
 * it either way).
 */
export async function submitCuisineSuggestion(opts: {
  userId: string;
  restaurantId: string;
  cuisine: string;
  restaurantName?: string;
  restaurantAddress?: string;
  currentCuisine?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cuisine = (opts.cuisine || '').trim();
  if (!supabaseConfigured) return { ok: false, error: 'Not configured' };
  if (!opts.userId || !opts.restaurantId || !cuisine) return { ok: false, error: 'Missing details' };
  try {
    const { error } = await supabase.from('cuisine_suggestions').upsert({
      restaurant_id: opts.restaurantId,
      restaurant_name: (opts.restaurantName || '').slice(0, 200),
      restaurant_address: (opts.restaurantAddress || '').slice(0, 300),
      current_cuisine: (opts.currentCuisine || '').slice(0, 60),
      cuisine,
      user_id: opts.userId,
      status: 'pending',
    }, { onConflict: 'restaurant_id,user_id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** This user's own suggestion for one restaurant, whatever became of it. */
export async function getMyCuisineSuggestion(userId: string, restaurantId: string): Promise<CuisineSuggestion | null> {
  if (!supabaseConfigured || !userId || !restaurantId) return null;
  try {
    const { data, error } = await supabase.from('cuisine_suggestions')
      .select(SELECT)
      .eq('user_id', userId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (error || !data) return null;
    return toSuggestion(data as Row);
  } catch { return null; }
}

/** Withdraw a still-pending suggestion of your own. */
export async function withdrawCuisineSuggestion(id: string): Promise<boolean> {
  if (!supabaseConfigured || !id) return false;
  try {
    const { error } = await supabase.from('cuisine_suggestions').delete().eq('id', id);
    return !error;
  } catch { return false; }
}

/** The review queue. RLS returns nothing to non-admins, so this is safe
 *  to call from anywhere — but the page that shows it is gated too. */
export async function adminListCuisineSuggestions(status: SuggestionStatus, limit = 200): Promise<CuisineSuggestion[]> {
  if (!supabaseConfigured) return [];
  try {
    const { data, error } = await supabase.from('cuisine_suggestions')
      .select(SELECT)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[Cuisine] suggestion list failed (migration 069 applied?):', error.message);
      return [];
    }
    return (data as Row[] || []).map(toSuggestion);
  } catch { return []; }
}

/**
 * How a reviewer means an approval.
 *
 * A suggestion is genuinely ambiguous and only a person can resolve it:
 * "this place is also Korean" and "this place is not Italian, it's Korean"
 * arrive as the same row. So the reviewer says which.
 *
 *   add      keep what is there and add this alongside it (migration 071
 *            allows up to CUISINE_MAX_COUNT). What consensus uses too:
 *            when strangers agree, adding is the safe reading.
 *   primary  what is there is wrong. Replaces it outright — this is what
 *            makes a correction actually stick.
 */
export type ApprovalMode = 'add' | 'primary';

export async function approveCuisineSuggestion(
  id: string,
  mode: ApprovalMode = 'add',
): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Not configured' };
  const { error } = await supabase.rpc('approve_cuisine_suggestion', { p_id: id, p_mode: mode });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Drop one of a restaurant's cuisines. Admin-only, enforced server-side.
 *
 * Needed for more than tidiness: a restaurant at the cap cannot accept
 * another suggestion, so without this the queue for it is permanently
 * un-actionable. Removing the primary promotes the best-agreed additional
 * cuisine rather than leaving the restaurant blank.
 */
export async function removeRestaurantCuisine(
  restaurantId: string,
  cuisine: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Not configured' };
  const { error } = await supabase.rpc('remove_restaurant_cuisine', {
    p_restaurant_id: restaurantId,
    p_cuisine: cuisine,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function denyCuisineSuggestion(id: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Not configured' };
  const { error } = await supabase.rpc('deny_cuisine_suggestion', {
    p_id: id,
    p_reason: (reason || '').trim() || null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Group a pending queue by (restaurant, cuisine) so a reviewer sees "four
 * people say Peruvian" as one decision instead of four rows — and can tell
 * at a glance which ones are one vote short of applying themselves.
 */
export interface SuggestionGroup {
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  currentCuisine: string;
  cuisine: string;
  votes: number;
  /** The one to act on — approving it approves every matching row. */
  id: string;
  createdAt: string;
}

export function groupSuggestions(rows: CuisineSuggestion[]): SuggestionGroup[] {
  const byKey = new Map<string, SuggestionGroup>();
  for (const r of rows) {
    const key = `${r.restaurantId}::${r.cuisine.toLowerCase()}`;
    const found = byKey.get(key);
    if (found) {
      found.votes += 1;
      // Keep the oldest row as the one to act on, so a queue sorted by
      // age doesn't reshuffle as votes arrive.
      if (r.createdAt < found.createdAt) { found.id = r.id; found.createdAt = r.createdAt; }
      if (!found.currentCuisine && r.currentCuisine) found.currentCuisine = r.currentCuisine;
    } else {
      byKey.set(key, {
        restaurantId: r.restaurantId,
        restaurantName: r.restaurantName,
        restaurantAddress: r.restaurantAddress,
        currentCuisine: r.currentCuisine,
        cuisine: r.cuisine,
        votes: 1,
        id: r.id,
        createdAt: r.createdAt,
      });
    }
  }
  // Most-agreed first: those are both the most likely correct and the
  // closest to applying on their own.
  return [...byKey.values()].sort((a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt));
}
