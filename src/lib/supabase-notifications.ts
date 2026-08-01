/**
 * In-app notifications — reads only.
 *
 * Rows are written server-side by the SECURITY DEFINER triggers in
 * migration 065; the client can never insert one (see the migration's
 * header for why the recipient can't be resolved client-side). All this
 * module does is read your own rows, stamp them read, and clear them.
 *
 * Every call degrades to empty/false when the migration hasn't been
 * applied yet, so an un-migrated deployment shows an empty notification
 * center instead of an error — the same posture the rest of the app
 * takes toward optional tables (see the visit_history reads in
 * supabase-community).
 */

import { supabase, supabaseConfigured } from './supabase';

export type NotificationKind = 'like' | 'comment';
export type NotificationSubject = 'post' | 'reel' | 'rating';

export interface AppNotification {
  id: string;
  /** Recipient — always the signed-in user. */
  userId: string;
  /** Who liked or commented. */
  actorId: string;
  kind: NotificationKind;
  subjectType: NotificationSubject;
  subjectId: string;
  /** Restaurant name for ratings, caption excerpt for posts/reels. */
  subjectLabel: string;
  /** The comment text (empty for likes). */
  preview: string;
  /** Present when the row can route to a restaurant page. */
  restaurantId: string | null;
  commentId: string | null;
  readAt: number | null;
  createdAt: number;
}

interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string;
  kind: string;
  subject_type: string;
  subject_id: string;
  subject_label: string | null;
  preview: string | null;
  restaurant_id: string | null;
  comment_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** The table is optional until migration 065 lands — treat "no such
 *  table" as "no notifications" and stay quiet about it. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01'
    || /notifications/i.test(error.message || '') && /does not exist|not find the table/i.test(error.message || '');
}

const ts = (iso: string | null): number => {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

export function rowToNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    actorId: row.actor_id,
    kind: row.kind === 'comment' ? 'comment' : 'like',
    subjectType: (row.subject_type === 'post' || row.subject_type === 'reel') ? row.subject_type : 'rating',
    subjectId: row.subject_id,
    subjectLabel: row.subject_label || '',
    preview: row.preview || '',
    restaurantId: row.restaurant_id || null,
    commentId: row.comment_id || null,
    readAt: row.read_at ? ts(row.read_at) : null,
    createdAt: ts(row.created_at),
  };
}

/** Your notifications, newest first. RLS does the scoping; the explicit
 *  user_id filter keeps the query on the covering index. */
export async function listNotifications(userId: string, limit = 60): Promise<AppNotification[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase.from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (!isMissingTable(error)) console.warn('[Notifications] list failed:', error.message);
      return [];
    }
    return (data || []).map((r) => rowToNotification(r as NotificationRow));
  } catch { return []; }
}

/** Stamp specific rows read. Returns false if the write didn't land, so
 *  callers can roll their optimistic state back. */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<boolean> {
  if (!supabaseConfigured || !userId || ids.length === 0) return false;
  try {
    const { error } = await supabase.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', ids)
      .is('read_at', null);
    if (error) {
      if (!isMissingTable(error)) console.warn('[Notifications] mark read failed:', error.message);
      return false;
    }
    return true;
  } catch { return false; }
}

/** Stamp everything currently unread. */
export async function markAllNotificationsRead(userId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) {
      if (!isMissingTable(error)) console.warn('[Notifications] mark all read failed:', error.message);
      return false;
    }
    return true;
  } catch { return false; }
}

/** Clear the list. Deleting is allowed on your own rows only (RLS). */
export async function clearNotifications(userId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase.from('notifications').delete().eq('user_id', userId);
    if (error) {
      if (!isMissingTable(error)) console.warn('[Notifications] clear failed:', error.message);
      return false;
    }
    return true;
  } catch { return false; }
}
