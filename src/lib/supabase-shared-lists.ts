/**
 * Shared lists — restaurant lists several people keep together
 * (migration 086). Unlike personal lists, which live in the per-user
 * user_app_data blob, these are real rows: one for the list, one per
 * restaurant in it, so members add and remove without overwriting each
 * other.
 *
 * Reads are scoped by RLS to members. Writes: the owner edits the list
 * row (name, emoji, rating mode, members); every member edits entries;
 * a member leaves through the leave_shared_list RPC.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { RestaurantMeta } from '../contexts/ListsContext';
import type { CommunityRating } from './supabase-community';

export type SharedRatingMode = 'individual' | 'group';

export interface SharedList {
  id: string;
  ownerId: string;
  name: string;
  emoji: string;
  ratingMode: SharedRatingMode;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SharedListEntry {
  id: string;
  listId: string;
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  addedBy: string;
  addedAt: string;
  groupScore: number | null;
  groupNotes: string;
  groupScoredBy: string | null;
  groupScoredAt: string | null;
}

export const MAX_SHARED_LIST_MEMBERS = 12;

/* eslint-disable @typescript-eslint/no-explicit-any */
const rowToList = (r: any): SharedList => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name ?? '',
  emoji: r.emoji ?? '👥',
  ratingMode: r.rating_mode === 'group' ? 'group' : 'individual',
  memberIds: Array.isArray(r.member_ids) ? r.member_ids : [],
  createdAt: r.created_at ?? '',
  updatedAt: r.updated_at ?? '',
});

const rowToEntry = (r: any): SharedListEntry => ({
  id: r.id,
  listId: r.list_id,
  restaurantId: r.restaurant_id,
  name: r.name ?? '',
  image: r.image ?? '',
  cuisine: r.cuisine ?? '',
  price: r.price ?? '',
  address: r.address ?? '',
  addedBy: r.added_by,
  addedAt: r.added_at ?? '',
  groupScore: r.group_score == null ? null : Number(r.group_score),
  groupNotes: r.group_notes ?? '',
  groupScoredBy: r.group_scored_by ?? null,
  groupScoredAt: r.group_scored_at ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Every shared list the signed-in person is in, newest activity first. */
export async function getMySharedLists(): Promise<SharedList[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase
    .from('shared_lists')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) {
    // A database that hasn't run 086 answers with "relation does not exist";
    // the feature simply isn't there yet.
    console.warn('[SharedLists] load failed:', error.message);
    return [];
  }
  return (data || []).map(rowToList);
}

export async function getSharedListEntries(listId: string): Promise<SharedListEntry[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase
    .from('shared_list_entries')
    .select('*')
    .eq('list_id', listId)
    .order('added_at', { ascending: true });
  if (error) {
    console.warn('[SharedLists] entries failed:', error.message);
    return [];
  }
  return (data || []).map(rowToEntry);
}

export async function createSharedList(input: {
  ownerId: string;
  name: string;
  emoji: string;
  ratingMode: SharedRatingMode;
  /** Friends to include; the owner is added automatically. */
  memberIds: string[];
}): Promise<{ list: SharedList } | { error: string }> {
  if (!supabaseConfigured) return { error: 'Not configured' };
  const members = Array.from(new Set([input.ownerId, ...input.memberIds])).slice(0, MAX_SHARED_LIST_MEMBERS);
  const { data, error } = await supabase
    .from('shared_lists')
    .insert({
      owner_id: input.ownerId,
      name: input.name.trim().slice(0, 80),
      emoji: input.emoji || '👥',
      rating_mode: input.ratingMode,
      member_ids: members,
    })
    .select('*')
    .single();
  if (error || !data) return { error: friendlyError(error?.message) };
  return { list: rowToList(data) };
}

export async function updateSharedList(
  id: string,
  patch: Partial<{ name: string; emoji: string; ratingMode: SharedRatingMode; memberIds: string[] }>,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured) return { success: false, error: 'Not configured' };
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim().slice(0, 80);
  if (patch.emoji !== undefined) row.emoji = patch.emoji;
  if (patch.ratingMode !== undefined) row.rating_mode = patch.ratingMode;
  if (patch.memberIds !== undefined) row.member_ids = Array.from(new Set(patch.memberIds)).slice(0, MAX_SHARED_LIST_MEMBERS);
  const { error } = await supabase.from('shared_lists').update(row).eq('id', id);
  return error ? { success: false, error: friendlyError(error.message) } : { success: true };
}

export async function deleteSharedList(id: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase.from('shared_lists').delete().eq('id', id);
  return !error;
}

export async function leaveSharedList(id: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase.rpc('leave_shared_list', { p_list: id });
  return !error;
}

export async function addSharedListEntry(listId: string, addedBy: string, meta: RestaurantMeta): Promise<{ entry: SharedListEntry } | { error: string }> {
  if (!supabaseConfigured) return { error: 'Not configured' };
  const { data, error } = await supabase
    .from('shared_list_entries')
    .upsert({
      list_id: listId,
      restaurant_id: meta.id,
      name: meta.name,
      image: meta.image || '',
      cuisine: meta.cuisine || '',
      price: meta.price || '',
      address: meta.address || '',
      added_by: addedBy,
    }, { onConflict: 'list_id,restaurant_id', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();
  if (error) return { error: friendlyError(error.message) };
  if (data) return { entry: rowToEntry(data) };
  // Already there (ignoreDuplicates returned nothing) — fetch it.
  const { data: existing } = await supabase
    .from('shared_list_entries').select('*').eq('list_id', listId).eq('restaurant_id', meta.id).maybeSingle();
  return existing ? { entry: rowToEntry(existing) } : { error: 'Could not add that place.' };
}

export async function removeSharedListEntry(listId: string, restaurantId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase
    .from('shared_list_entries').delete().eq('list_id', listId).eq('restaurant_id', restaurantId);
  return !error;
}

/** Group mode: set (or clear with null) the one score the list gives a place. */
export async function setSharedGroupScore(
  listId: string,
  restaurantId: string,
  scoredBy: string,
  score: number | null,
  notes = '',
): Promise<boolean> {
  if (!supabaseConfigured) return false;
  const { error } = await supabase
    .from('shared_list_entries')
    .update({
      group_score: score == null ? null : Math.round(Math.max(0, Math.min(10, score)) * 100) / 100,
      group_notes: notes.slice(0, 500),
      group_scored_by: score == null ? null : scoredBy,
      group_scored_at: score == null ? null : new Date().toISOString(),
    })
    .eq('list_id', listId)
    .eq('restaurant_id', restaurantId);
  return !error;
}

/**
 * Individual mode: every member's own rating of every place in the list,
 * in one query. RLS (046) already limits this to authors the caller may
 * see — members are mutual friends, so in practice all of them.
 */
export async function getMembersRatings(memberIds: string[], restaurantIds: string[]): Promise<CommunityRating[]> {
  if (!supabaseConfigured || memberIds.length === 0 || restaurantIds.length === 0) return [];
  const { data, error } = await supabase
    .from('community_ratings')
    .select('*')
    .in('user_id', memberIds)
    .in('restaurant_id', restaurantIds);
  if (error) {
    console.warn('[SharedLists] member ratings failed:', error.message);
    return [];
  }
  return (data || []) as CommunityRating[];
}

function friendlyError(message?: string): string {
  const m = message || '';
  if (/mutual friends/i.test(m)) return 'Only mutual friends can be added to a shared list.';
  if (/owner must stay/i.test(m)) return 'The owner stays in the list.';
  if (/does not exist/i.test(m)) return 'Shared lists need a database update first.';
  if (/cardinality/i.test(m)) return `A shared list holds up to ${MAX_SHARED_LIST_MEMBERS} people.`;
  return m || 'Something went wrong.';
}
