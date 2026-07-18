/**
 * Minimal production crash reporting.
 *
 * Production builds used to drop ALL console output, so crashes left zero
 * diagnostics anywhere. Reports now go two places: console.error (which
 * the build keeps — see vite.config.ts) and a best-effort insert into the
 * client_errors table (migration 055, insert-only for signed-in users).
 * The reporter never throws and self-throttles so an error loop can't
 * flood the table.
 */
import { supabase, supabaseConfigured } from './supabase';

const MAX_REPORTS_PER_SESSION = 10;
let reportsSent = 0;

export function reportClientError(context: string, error: unknown, extra?: string): void {
  try {
    console.error(`[app:${context}]`, error, extra ?? '');
    if (!supabaseConfigured || reportsSent >= MAX_REPORTS_PER_SESSION) return;
    reportsSent++;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const stack = (error instanceof Error ? error.stack || '' : '').slice(0, 4000);
    void supabase.auth.getSession()
      .then(({ data }) => {
        const uid = data.session?.user?.id;
        if (!uid) return; // insert policy is authenticated-only
        return supabase.from('client_errors').insert({
          user_id: uid,
          message,
          stack,
          context: `${context}${extra ? ` | ${extra.slice(0, 500)}` : ''}`,
        }).then(({ error: e }) => {
          if (e) console.warn('[app:report] failed:', e.message);
        });
      })
      .catch(() => { /* reporting is best-effort, never rethrow */ });
  } catch { /* never let the reporter itself throw */ }
}
