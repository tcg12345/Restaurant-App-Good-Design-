import { supabase } from './supabase';

export const FEEDBACK_TYPES = { problem: 'Report a problem', feedback: 'Feature feedback', suggestion: 'Suggest an idea', other: 'Something else' } as const;
export const FEEDBACK_STATUSES = { new: 'New', reviewing: 'Reviewing', planned: 'Planned', resolved: 'Resolved' } as const;
export const FEEDBACK_FEATURES = ['General', 'Home', 'Search & discovery', 'Restaurant details', 'Wishlist & lists', 'Ratings & reviews', 'Recipes & cooking', 'Guides', 'AI assistant', 'Social & messages', 'Profile & account', 'GoodEats Pro', 'Other'];
export type FeedbackType = keyof typeof FEEDBACK_TYPES;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUSES;
export interface FeedbackDraft {
  id: string; user_id: string; category: FeedbackType; feature: string; message: string;
  allow_contact: boolean; contact_email: string | null; app_version: string;
  platform: 'web' | 'ios'; device_type: 'desktop' | 'tablet' | 'phone'; browser: string; source_page: string;
}
export interface FeedbackItem extends FeedbackDraft {
  screenshot_path: string | null; status: FeedbackStatus; created_at: string; updated_at: string;
}
const bucket = 'feedback-screenshots';
export function validateScreenshot(file: File): string | null {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return 'Choose a PNG, JPEG, or WebP screenshot.';
  if (!file.size || file.size > 5 * 1024 * 1024) return 'Choose a screenshot smaller than 5 MB.';
  return null;
}
export async function submitFeedback(draft: FeedbackDraft, screenshot: File | null): Promise<void> {
  // A retry first checks whether the previous request succeeded but its response was lost.
  const prior = await supabase.from('user_feedback').select('id').eq('id', draft.id).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) return;
  let screenshot_path: string | null = null;
  if (screenshot) {
    const invalid = validateScreenshot(screenshot);
    if (invalid) throw new Error(invalid);
    const extension = screenshot.type === 'image/jpeg' ? 'jpg' : screenshot.type === 'image/webp' ? 'webp' : 'png';
    screenshot_path = `${draft.user_id}/${draft.id}.${extension}`;
    const upload = await supabase.storage.from(bucket).upload(screenshot_path, screenshot, { contentType: screenshot.type, upsert: false });
    if (upload.error && String((upload.error as { statusCode?: string }).statusCode) !== '409') throw upload.error;
  }
  const result = await supabase.from('user_feedback').insert({ ...draft, message: draft.message.trim(), contact_email: draft.allow_contact ? draft.contact_email?.trim() : null, screenshot_path });
  if (result.error) {
    if (result.error.code === '23505') {
      const retry = await supabase.from('user_feedback').select('id').eq('id', draft.id).maybeSingle();
      if (!retry.error && retry.data) return;
    }
    throw result.error;
  }
}
export async function listFeedback(filters: { status: string; category: string; feature: string; search: string; page: number }) {
  let query = supabase.from('user_feedback').select('*', { count: 'exact' });
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.feature) query = query.eq('feature', filters.feature);
  if (filters.search.trim()) query = query.ilike('message', `%${filters.search.trim().replace(/[\\%_]/g, '\\$&')}%`);
  const result = await query.order('created_at', { ascending: false }).order('id').range(filters.page * 25, filters.page * 25 + 24);
  if (result.error) throw result.error;
  return { items: (result.data || []) as FeedbackItem[], total: result.count || 0 };
}
export async function updateFeedbackStatus(id: string, status: FeedbackStatus) {
  const result = await supabase.from('user_feedback').update({ status }).eq('id', id).select('*').single();
  if (result.error) throw result.error;
  return result.data as FeedbackItem;
}
export async function feedbackScreenshot(path: string) {
  const result = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (result.error) throw result.error;
  return result.data.signedUrl;
}
