// Supabase persistence for the "Ask a local" AI assistant chat history.
// Stored as a JSONB array in user_app_data.location_chat_history — one
// row per user, same table + per-user pattern as ratings/lists/chats.
// Deletion tombstones ride inside the same array as a sentinel element
// (see the codec in ai-chat-history.ts) so deletions propagate across
// devices instead of resurrecting on the next union merge.
//
// Both functions degrade gracefully: if Supabase isn't configured, the
// user is signed out, or the column hasn't been migrated yet, they no-op
// (the app keeps working off localStorage) — mirroring saveChats /
// saveHomeMeals in supabase-db.ts.

import { supabase, supabaseConfigured } from './supabase';
import {
  decodeCloudChatPayload,
  encodeCloudChatPayload,
  type AiChatCloudPayload,
  type ChatTombstone,
  type SavedChat,
} from './ai-chat-history';

/** Returns the cloud copy, `{chats: [], tombstones: []}` for a genuinely
 *  empty account (no row yet), or NULL when the read failed (offline,
 *  column missing, …). Callers must treat null as "unknown" and skip any
 *  follow-up write — pushing local over an unreadable cloud copy is how
 *  histories get clobbered. */
export async function loadAiChatHistory(userId: string): Promise<AiChatCloudPayload | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('user_app_data')
      .select('location_chat_history')
      .eq('user_id', userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return { chats: [], tombstones: [] }; // no row for this user yet
      console.warn('[AiChat] load error (column may not exist yet):', error.message);
      return null;
    }
    return decodeCloudChatPayload((data as Record<string, unknown>)?.location_chat_history);
  } catch (err) {
    console.warn('[AiChat] load exception:', err);
    return null;
  }
}

export async function saveAiChatHistory(
  userId: string,
  chats: SavedChat[],
  tombstones: ChatTombstone[] = [],
): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    // Upsert just this column — PostgREST only writes the keys we pass, so
    // ratings/lists/chats on the same row are preserved. The row's other
    // columns have defaults, so this also creates the row if missing.
    const { error } = await supabase
      .from('user_app_data')
      .upsert(
        { user_id: userId, location_chat_history: encodeCloudChatPayload(chats, tombstones), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) {
      console.warn('[AiChat] save error (column may not exist yet):', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[AiChat] save exception:', err);
    return false;
  }
}
