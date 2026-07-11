/**
 * Verified-user application flow (see supabase/migrations/034_verified_users.sql).
 *
 * Users submit a verification request (one pending at a time, enforced by a
 * partial unique index); the owner reviews it on the in-app admin screen.
 * Approve/deny/acknowledge run through SECURITY DEFINER RPCs — the
 * verification_requests table has no client UPDATE/DELETE policies, and a
 * trigger on user_profiles silently ignores client-side writes to
 * is_verified, so none of this is spoofable from the browser.
 */
import { supabase, supabaseConfigured } from './supabase';

export type VerificationStatus = 'pending' | 'approved' | 'denied';

export interface VerificationLink {
  platform: string;   // 'Instagram' | 'TikTok' | 'YouTube' | 'Website' | …
  url: string;
  /** Free-text audience size ("120k", "1.2M") — optional. */
  followers?: string;
}

/** The application the user fills in, section by section. */
export interface VerificationForm {
  // Identity
  fullName: string;
  city: string;
  // Professional
  occupation: string;
  affiliation: string;   // restaurant / publication / employer
  credentials: string;   // awards, press, notable work
  // Social presence
  links: VerificationLink[];
  // Statement
  statement: string;     // why should you be verified
}

export interface VerificationRequest {
  id: string;
  user_id: string;
  status: VerificationStatus;
  full_name: string;
  city: string;
  occupation: string;
  affiliation: string;
  credentials: string;
  links: VerificationLink[];
  statement: string;
  deny_reason: string | null;
  acknowledged: boolean;
  created_at: string;
  reviewed_at: string | null;
}

/** Admin list rows carry the applicant's profile via the FK embed. */
export interface AdminVerificationRequest extends VerificationRequest {
  user_profiles?: {
    display_name: string;
    username: string;
    is_verified: boolean;
  } | null;
}

/** Templates for the one-line public status an approved user must pick.
 *  '___' marks the fill-in; 'Custom…' frees the whole line. */
export const VERIFIED_STATUS_TEMPLATES: string[] = [
  'Head chef at ___',
  'Chef at ___',
  'Restaurant critic at ___',
  'Food writer at ___',
  'Sommelier at ___',
  'Restaurateur — ___',
  'Influencer · ___ followers',
  'Custom…',
];

export async function submitVerificationRequest(
  userId: string,
  form: VerificationForm,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const { error } = await supabase.from('verification_requests').insert({
      user_id: userId,
      status: 'pending',
      full_name: form.fullName.trim(),
      city: form.city.trim(),
      occupation: form.occupation.trim(),
      affiliation: form.affiliation.trim(),
      credentials: form.credentials.trim(),
      links: form.links.filter((l) => l.url.trim() || l.platform.trim()),
      statement: form.statement.trim(),
    });
    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'You already have an application under review.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function getMyLatestVerificationRequest(
  userId: string,
): Promise<VerificationRequest | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('verification_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0] as VerificationRequest;
  } catch {
    return null;
  }
}

export async function acknowledgeVerificationRequest(
  requestId: string,
): Promise<{ success: boolean }> {
  if (!supabaseConfigured || !requestId) return { success: false };
  try {
    const { error } = await supabase.rpc('acknowledge_verification', { p_request_id: requestId });
    return { success: !error };
  } catch {
    return { success: false };
  }
}

/** Update the verified user's public status line. A direct profile UPDATE —
 *  the guard trigger permits it because the row is already is_verified. */
export async function saveVerifiedStatusLine(
  userId: string,
  statusLine: string,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured || !userId) return { success: false, error: 'Not configured' };
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ verified_status: statusLine.trim().slice(0, 80), updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/* ── Admin ── */

export async function isAppAdmin(): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { data, error } = await supabase.rpc('is_app_admin');
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function adminListVerificationRequests(
  status?: VerificationStatus,
): Promise<AdminVerificationRequest[]> {
  if (!supabaseConfigured) return [];
  try {
    let q = supabase
      .from('verification_requests')
      .select('*, user_profiles(display_name, username, is_verified)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return [];
    return (data || []) as AdminVerificationRequest[];
  } catch {
    return [];
  }
}

export async function approveVerificationRequest(
  requestId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured) return { success: false, error: 'Not configured' };
  try {
    const { error } = await supabase.rpc('approve_verification', { p_request_id: requestId });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function denyVerificationRequest(
  requestId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseConfigured) return { success: false, error: 'Not configured' };
  try {
    const { error } = await supabase.rpc('deny_verification', {
      p_request_id: requestId,
      p_reason: reason ?? null,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
