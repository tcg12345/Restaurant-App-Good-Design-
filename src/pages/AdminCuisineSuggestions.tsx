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
import { ArrowLeft, Check, Loader2, Lock, MapPin, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  adminListCuisineSuggestions, approveCuisineSuggestion, denyCuisineSuggestion,
  removeRestaurantCuisine, groupSuggestions, AUTO_APPLY_VOTES,
  type SuggestionGroup, type SuggestionStatus, type ApprovalMode,
} from '../lib/supabase-cuisine-suggestions';
import { getRestaurantCuisineBatch, isCuisineRemovable, CUISINE_MAX_COUNT } from '../lib/restaurant-cuisine';

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
  /** What each restaurant in the queue currently has, WITH where each came
   *  from — the reviewer needs to see what they are adding to, whether
   *  there is room, and which ones are theirs to take away. */
  type Held = Array<{ cuisine: string; source: string }>;
  const [current, setCurrent] = useState<Record<string, Held>>({});

  const load = useCallback(async (status: SuggestionStatus) => {
    setLoading(true);
    const next = groupSuggestions(await adminListCuisineSuggestions(status));
    setGroups(next);
    setLoading(false);
    const cached = await getRestaurantCuisineBatch(next.map((g) => g.restaurantId));
    setCurrent(Object.fromEntries(Object.entries(cached).map(([id, c]) => [id, c.entries])));
  }, []);

  useEffect(() => { if (isAdmin) void load(tab); }, [isAdmin, tab, load]);

  const act = async (group: SuggestionGroup, decision: 'deny' | ApprovalMode) => {
    setBusy(group.id);
    const res = decision === 'deny'
      ? await denyCuisineSuggestion(group.id)
      // The restaurant id goes with it so the rest of the app can drop its
      // stale copy — the RPC only takes a suggestion id, so this is the
      // only place that knows which restaurant just changed.
      : await approveCuisineSuggestion(group.id, decision, group.restaurantId);
    setBusy(null);
    if (!res.ok) { showToast(res.error || 'That did not go through'); return; }
    showToast(
      decision === 'deny' ? 'Suggestion denied'
        : decision === 'primary' ? `${group.restaurantName || 'Restaurant'} is now ${group.cuisine}`
          : `${group.cuisine} added to ${group.restaurantName || 'this restaurant'}`,
    );
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    // Other rows in the queue can be for the same restaurant, and they
    // must not keep showing the cuisine list as it was a moment ago.
    if (decision !== 'deny') {
      const cached = await getRestaurantCuisineBatch([group.restaurantId]);
      setCurrent((prev) => ({ ...prev, [group.restaurantId]: cached[group.restaurantId]?.entries ?? [] }));
    }
  };

  /** Free a slot on a restaurant that is at the cap. */
  const drop = async (group: SuggestionGroup, cuisine: string) => {
    setBusy(group.id);
    const res = await removeRestaurantCuisine(group.restaurantId, cuisine);
    setBusy(null);
    if (!res.ok) { showToast(res.error || 'That did not go through'); return; }
    showToast(`Removed ${cuisine}`);
    const cached = await getRestaurantCuisineBatch([group.restaurantId]);
    setCurrent((prev) => ({ ...prev, [group.restaurantId]: cached[group.restaurantId]?.entries ?? [] }));
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
        <Link to="/" className="text-[13.5px] font-semibold text-primary">Back to GoodEats</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-24">
      <div className="sticky top-0 z-20 border-b border-on-surface/[0.08] bg-surface/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[860px] items-center gap-3 px-5 pt-safe-4 pb-3">
          <GlassButton
            id="admin-cuisine-back"
            symbol="chevron.left"
            label="Back"
            onClick={() => navigate(-1)}
            className="hit-44 flex-none w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Cuisine review</span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[860px] px-5">
        <header className="pt-5 pb-4">
          <h1 className="font-serif text-[30px] font-bold leading-tight tracking-[-0.03em] text-on-surface">Suggested cuisines</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-on-surface/55" style={{ textWrap: 'pretty' } as React.CSSProperties}>
            <b className="font-bold text-on-surface/75">Add</b> keeps what is there;
            {' '}<b className="font-bold text-on-surface/75">Make primary</b> replaces it.
            {' '}A restaurant holds at most {CUISINE_MAX_COUNT}. Either way it applies everywhere and
            clears every matching suggestion — and {AUTO_APPLY_VOTES} people agreeing adds it without you.
          </p>
        </header>

        <div className="mb-1 flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-none rounded-full border px-4 py-2.5 text-[12.5px] font-bold transition-colors',
                tab === t.key
                  ? 'bg-on-surface text-surface border-on-surface'
                  : 'bg-transparent text-on-surface border-on-surface/20 active:bg-on-surface/[0.06]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-on-surface/30" /></div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="font-serif text-[14.5px] font-bold tracking-[-0.02em] text-on-surface">Nothing here</p>
            <p className="text-[12.5px] text-on-surface/55">Suggestions land in this tab as they come in.</p>
          </div>
        ) : (
          <ul>
            {groups.map((g, idx) => {
              const nearlyThere = tab === 'pending' && g.votes >= AUTO_APPLY_VOTES - 1;
              // Fall back to the denormalized snapshot on the suggestion
              // until the live read lands, so the row is never blank.
              const held: Held = current[g.restaurantId]
                ?? (g.currentCuisine ? [{ cuisine: g.currentCuisine, source: '' }] : []);
              const full = held.length >= CUISINE_MAX_COUNT;
              return (
                <li key={g.id} className={cn('py-4', idx > 0 && 'border-t border-on-surface/[0.08]')}>
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to={`/restaurant/${g.restaurantId}`}
                      className="min-w-0 font-serif text-[16px] font-bold leading-tight tracking-[-0.025em] text-on-surface active:text-primary"
                    >
                      {g.restaurantName || g.restaurantId}
                    </Link>
                    <span className={cn(
                      'flex-none text-[11px] font-semibold',
                      nearlyThere ? 'text-primary' : 'text-on-surface/45',
                    )}>
                      {g.votes} agree
                    </span>
                  </div>
                  {g.restaurantAddress && (
                    <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11.5px] text-on-surface/50">
                      <MapPin size={11} className="flex-shrink-0" />
                      <span className="min-w-0 truncate">{g.restaurantAddress}</span>
                    </p>
                  )}

                  {/* What the restaurant has now → what is proposed. Each
                      held chip is removable, because a restaurant at the cap
                      cannot accept anything until something goes. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                    {held.length === 0 ? (
                      <span className="text-on-surface/45">no cuisine yet</span>
                    ) : held.map(({ cuisine, source }) => {
                      // A provider's answer is not ours to delete, and a
                      // derived one comes straight back on the next resolve
                      // — so there is no × to press, and a lock says why.
                      const removable = isCuisineRemovable(source);
                      return (
                        <span
                          key={cuisine}
                          className="inline-flex items-center gap-1 rounded-full bg-on-surface/[0.06] py-2 pl-3 pr-1.5 font-medium text-on-surface/75"
                        >
                          {cuisine}
                          {tab === 'pending' && (removable ? (
                            <button
                              type="button"
                              disabled={busy === g.id}
                              onClick={() => void drop(g, cuisine)}
                              aria-label={`Remove ${cuisine}`}
                              title={`Remove ${cuisine}`}
                              className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-on-surface/35 transition-colors active:bg-on-surface/10 active:text-on-surface disabled:opacity-40"
                            >
                              <X size={10} />
                            </button>
                          ) : (
                            <span
                              aria-label={`${cuisine} came from ${source || 'a provider'} and cannot be removed`}
                              title={`From ${source || 'a provider'} — make another cuisine the primary to rank it above this one`}
                              className="flex h-4.5 w-4.5 items-center justify-center text-on-surface/25"
                            >
                              <Lock size={9} />
                            </span>
                          ))}
                        </span>
                      );
                    })}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface/30"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
                    <span className="rounded-full bg-primary/10 px-3 py-2 font-bold text-primary">{g.cuisine}</span>
                  </div>

                  {nearlyThere && (
                    <p className="mt-2.5 text-[12px] font-semibold text-primary">
                      One more and this applies on its own.
                    </p>
                  )}
                  {full && (
                    <p className="mt-2.5 text-[12px] leading-relaxed text-on-surface/50">
                      Already at {CUISINE_MAX_COUNT} — remove one above to add this, or make it the primary.
                      {held.some((h) => !isCuisineRemovable(h.source)) && ' Locked ones came from a provider; ranking above them is what changes what people see.'}
                    </p>
                  )}

                  {tab === 'pending' && (
                    <div className="mt-3.5 flex flex-wrap items-center gap-2">
                      {/* Two approvals, because a suggestion is genuinely
                          ambiguous: "it is ALSO this" and "it is NOT what
                          you have, it is this" arrive as the same row. */}
                      <button
                        type="button"
                        disabled={busy === g.id || full}
                        onClick={() => void act(g, 'add')}
                        title={full ? `Already at ${CUISINE_MAX_COUNT} cuisines` : 'Keep what is there and add this'}
                        className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full bg-on-surface px-4 py-2.5 text-[12.5px] font-bold text-surface disabled:opacity-40 active:opacity-85"
                      >
                        {busy === g.id ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        Add
                      </button>
                      <button
                        type="button"
                        disabled={busy === g.id}
                        onClick={() => void act(g, 'primary')}
                        title="What is there is wrong — replace it with this"
                        className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-on-surface/20 px-4 py-2.5 text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.06] disabled:opacity-50"
                      >
                        <Check size={13} />
                        Make primary
                      </button>
                      <button
                        type="button"
                        disabled={busy === g.id}
                        onClick={() => void act(g, 'deny')}
                        className="inline-flex flex-none items-center justify-center rounded-full px-2.5 py-2.5 text-[12.5px] font-bold text-on-surface/60 active:text-on-surface disabled:opacity-50"
                      >
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
