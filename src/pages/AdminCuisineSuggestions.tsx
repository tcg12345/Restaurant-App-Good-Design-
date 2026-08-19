/**
 * Admin cuisine review — /admin/cuisine.
 *
 * Owner-only queue of proposed cuisine edits. Rows are grouped by
 * (restaurant, cuisine) so "four people say Peruvian" is one decision
 * rather than four, and approving one approves every matching row.
 *
 * A group at AUTO_APPLY_VOTES-1 is called out: one more person and it
 * applies on its own, so it's the one worth looking at first.
 *
 * Non-admins get the not-found state. Real enforcement is server-side —
 * the RLS read policy hides everyone else's rows, and the approve/deny
 * RPCs check is_app_admin() themselves.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, MapPin, Users, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  adminListCuisineSuggestions, approveCuisineSuggestion, denyCuisineSuggestion,
  groupSuggestions, AUTO_APPLY_VOTES,
  type SuggestionGroup, type SuggestionStatus,
} from '../lib/supabase-cuisine-suggestions';

const TABS: { key: SuggestionStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'auto', label: 'Auto-applied' },
  { key: 'denied', label: 'Denied' },
];

export const AdminCuisineSuggestions: React.FC = () => {
  const { isAdmin, adminChecked, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<SuggestionStatus>('pending');
  const [groups, setGroups] = useState<SuggestionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (status: SuggestionStatus) => {
    setLoading(true);
    setGroups(groupSuggestions(await adminListCuisineSuggestions(status)));
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) void load(tab); }, [isAdmin, tab, load]);

  const act = async (group: SuggestionGroup, decision: 'approve' | 'deny') => {
    setBusy(group.id);
    const res = decision === 'approve'
      ? await approveCuisineSuggestion(group.id)
      : await denyCuisineSuggestion(group.id);
    setBusy(null);
    if (!res.ok) { showToast(res.error || 'That did not go through'); return; }
    showToast(decision === 'approve'
      ? `${group.restaurantName || 'Restaurant'} is now ${group.cuisine}`
      : 'Suggestion denied');
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
  };

  // Same posture as /admin/verification: spin while the allowlist probe is
  // out, then 404 rather than admit the page exists.
  if (authLoading || adminChecked === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Loader2 size={22} className="animate-spin text-on-surface/30" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <h1 className="font-serif text-[22px] font-bold text-on-surface">Page not found</h1>
        <Link to="/" className="text-[13.5px] font-semibold text-primary">Back to Gourmet Canvas</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="sticky top-0 z-20 border-b border-on-surface/[0.06] bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 px-5 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-on-surface/70 transition-colors hover:bg-on-surface/[0.06]"
          >
            <ArrowLeft size={19} />
          </button>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Cuisine review</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[860px] px-5">
        <header className="pt-5 pb-4">
          <h1 className="font-serif text-[30px] font-bold leading-tight text-on-surface">Suggested cuisines</h1>
          <p className="mt-1 text-[13px] text-on-surface/50">
            Approving one applies it everywhere and clears every matching suggestion.
            {' '}{AUTO_APPLY_VOTES} people agreeing applies it without you.
          </p>
        </header>

        <div className="mb-5 flex gap-1.5 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
                tab === t.key ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.05] text-on-surface/60 hover:bg-on-surface/[0.09]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-on-surface/30" /></div>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-[13.5px] text-on-surface/45">Nothing here.</p>
        ) : (
          <ul className="space-y-2.5">
            {groups.map((g) => {
              const nearlyThere = tab === 'pending' && g.votes >= AUTO_APPLY_VOTES - 1;
              return (
                <li
                  key={g.id}
                  className={cn(
                    'rounded-2xl border p-4',
                    nearlyThere ? 'border-primary/30 bg-primary/[0.03]' : 'border-on-surface/[0.07]',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/restaurant/${g.restaurantId}`}
                        className="font-serif text-[17px] font-bold leading-tight text-on-surface hover:text-primary"
                      >
                        {g.restaurantName || g.restaurantId}
                      </Link>
                      {g.restaurantAddress && (
                        <p className="mt-1 flex items-center gap-1 truncate text-[12px] text-on-surface/45">
                          <MapPin size={11} className="flex-shrink-0" />{g.restaurantAddress}
                        </p>
                      )}
                    </div>
                    {g.votes > 1 && (
                      <span className={cn(
                        'inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-bold',
                        nearlyThere ? 'bg-primary/15 text-primary' : 'bg-on-surface/[0.06] text-on-surface/55',
                      )}>
                        <Users size={11} />{g.votes}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
                    <span className="text-on-surface/45">{g.currentCuisine || 'no cuisine'}</span>
                    <span className="text-on-surface/25">→</span>
                    <span className="rounded-md bg-sky-500/10 px-2 py-0.5 font-bold text-sky-700">{g.cuisine}</span>
                  </div>

                  {nearlyThere && (
                    <p className="mt-2 text-[12px] font-semibold text-primary">
                      One more and this applies on its own.
                    </p>
                  )}

                  {tab === 'pending' && (
                    <div className="mt-3.5 flex gap-2">
                      <button
                        type="button"
                        disabled={busy === g.id}
                        onClick={() => void act(g, 'approve')}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-on-surface text-[13px] font-bold text-surface disabled:opacity-50"
                      >
                        {busy === g.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy === g.id}
                        onClick={() => void act(g, 'deny')}
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-on-surface/[0.12] px-4 text-[13px] font-semibold text-on-surface/65 hover:border-on-surface/25 disabled:opacity-50"
                      >
                        <X size={14} />
                        Deny
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
