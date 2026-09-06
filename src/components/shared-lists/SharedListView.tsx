import { DeleteConfirmation } from '../DeleteConfirmation';
/**
 * A shared list on screen — the Pantry renders this in place of the
 * personal list view when the selected list is one several people keep.
 *
 * The row is the whole feature: what a place's score means depends on how
 * the list rates.
 *   individual — every member's own score in a row (avatar + number) and
 *                the average. "Rate it" opens your normal rating flow;
 *                your score shows up here like everyone else's.
 *   group      — one score chip the table agreed on; tapping it opens the
 *                group score sheet. Empty until someone sets it.
 * Long-press (or right-click) a row for its actions, like the profile
 * grids. Tap opens the restaurant.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, Users, Star, Trash2, Search, Check, ListPlus, Utensils } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatScore, scoreHex, scoreTint } from '../../lib/score';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useLists, type RestaurantMeta } from '../../contexts/ListsContext';
import { useSharedLists } from '../../contexts/SharedListsContext';
import { getProfilesByIds, type CommunityRating, type UserProfile } from '../../lib/supabase-community';
import { getMembersRatings, type SharedList, type SharedListEntry } from '../../lib/supabase-shared-lists';
import { Avatar } from '../Avatar';
import { GlassButton } from '../../lib/glass-buttons';
import { useCardLongPress, CardActionMenu, type CardAction } from '../CardActionMenu';
import { SheetShell } from './SheetShell';
import { GroupScoreSheet } from './GroupScoreSheet';
import { SharedListMembersSheet } from './SharedListMembersSheet';

const nameOf = (p?: UserProfile) => p?.display_name || p?.username || 'Someone';

/* ── Avatar stack ─────────────────────────────────────────────────── */
export const MemberStack: React.FC<{ ids: string[]; profiles: Record<string, UserProfile>; size?: number; max?: number }> = ({ ids, profiles, size = 26, max = 4 }) => {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <span className="inline-flex items-center">
      {shown.map((id, i) => (
        <span key={id} className="rounded-full ring-2 ring-surface" style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar src={profiles[id]?.avatar_url} name={nameOf(profiles[id])} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-full ring-2 ring-surface bg-on-surface/[0.08] text-on-surface/70 flex items-center justify-center" style={{ width: size, height: size, marginLeft: -size * 0.3, fontSize: size * 0.4, fontWeight: 700 }}>+{extra}</span>
      )}
    </span>
  );
};

/* ── Add places ───────────────────────────────────────────────────── */
const AddPlacesSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  list: SharedList;
  entries: SharedListEntry[];
}> = ({ open, onClose, list, entries }) => {
  const { ratings, wishlist } = useLists();
  const { addPlace, removePlace } = useSharedLists();
  const { showToast } = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (open) setQ(''); }, [open]);

  const inList = useMemo(() => new Set(entries.map((e) => e.restaurantId)), [entries]);
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ meta: RestaurantMeta; score?: number; kind: 'rated' | 'wishlist' }> = [];
    for (const r of [...ratings].sort((a, b) => b.score - a.score)) {
      if (seen.has(r.restaurantId)) continue; seen.add(r.restaurantId);
      out.push({ meta: { id: r.restaurantId, name: r.name, image: r.photos?.[0]?.url || r.image || '', cuisine: r.cuisine, price: r.price, address: r.address }, score: r.score, kind: 'rated' });
    }
    for (const w of wishlist) {
      if (seen.has(w.restaurantId)) continue; seen.add(w.restaurantId);
      out.push({ meta: { id: w.restaurantId, name: w.name, image: w.image || '', cuisine: w.cuisine || '', price: w.price || '', address: w.address || '' }, kind: 'wishlist' });
    }
    const s = q.trim().toLowerCase();
    return s ? out.filter((c) => c.meta.name.toLowerCase().includes(s) || c.meta.cuisine.toLowerCase().includes(s) || c.meta.address.toLowerCase().includes(s)) : out;
  }, [ratings, wishlist, q]);

  const toggle = async (meta: RestaurantMeta) => {
    if (busy) return;
    setBusy(meta.id);
    if (inList.has(meta.id)) {
      await removePlace(list.id, meta.id);
    } else {
      const res = await addPlace(list.id, meta);
      if (!res.success) showToast("Couldn't add that place", { subtitle: res.error });
    }
    setBusy(null);
  };

  return (
    <SheetShell open={open} onClose={onClose} title="Add places" subtitle={`From what you've rated and saved. ${entries.length} in ${list.name}.`}>
      {candidates.length > 8 && (
        <label className="mb-3 flex items-center gap-2 rounded-full bg-on-surface/[0.05] px-3.5 h-10">
          <Search size={14} className="flex-none text-on-surface/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your places" className="flex-1 min-w-0 bg-transparent outline-none text-on-surface placeholder:text-on-surface/35" style={{ fontSize: '14px' }} />
        </label>
      )}
      {candidates.length === 0 ? (
        <p className="text-on-surface/45" style={{ fontSize: '13px' }}>{q ? 'Nothing matches.' : 'Rate or save a few places first, then add them here.'}</p>
      ) : (
        <ul className="divide-y divide-on-surface/[0.06]">
          {candidates.slice(0, 80).map(({ meta, score, kind }) => {
            const on = inList.has(meta.id);
            return (
              <li key={meta.id}>
                <button type="button" onClick={() => { void toggle(meta); }} aria-pressed={on} className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-70 transition-opacity">
                  {meta.image
                    ? <img src={meta.image} alt="" className="w-11 h-11 rounded-xl object-cover flex-none bg-on-surface/[0.06]" referrerPolicy="no-referrer" />
                    : <div className="w-11 h-11 rounded-xl flex-none bg-on-surface/[0.06] text-on-surface/40 flex items-center justify-center"><Utensils size={16} /></div>}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{meta.name}</p>
                    <p className="truncate text-on-surface/45" style={{ fontSize: '12px' }}>{[meta.cuisine, meta.price, kind === 'wishlist' ? 'Want to try' : score != null ? score.toFixed(1) : ''].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className={cn('flex-none h-8 w-8 rounded-full flex items-center justify-center transition-colors', on ? 'bg-primary text-on-primary' : 'bg-on-surface/[0.06] text-on-surface/60', busy === meta.id && 'opacity-50')}>
                    {on ? <Check size={15} /> : <Plus size={15} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SheetShell>
  );
};

/* ── The view ─────────────────────────────────────────────────────── */
export const SharedListView: React.FC<{
  list: SharedList;
  /** The Pantry's phone header already shows the title; drop ours. */
  hidePhoneHeader?: boolean;
  onBack: () => void;
  /** The list vanished for this person (deleted, left, or removed). */
  onGone: () => void;
}> = ({ list, hidePhoneHeader = false, onBack, onGone }) => {
  const navigate = useNavigate();
  const { phoneMode, twoDecimalScores } = useSettings();
  const { user } = useAuth();
  const { entriesFor, loadEntries, removePlace, setGroupScore } = useSharedLists();
  const { openAddRestaurantModal, getRating, scoresUnlocked } = useLists();
  const entries = entriesFor(list.id);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [memberRatings, setMemberRatings] = useState<CommunityRating[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [scoring, setScoring] = useState<SharedListEntry | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ entry: SharedListEntry; rect: DOMRect } | null>(null);
  const press = useCardLongPress<SharedListEntry>((entry, target) => setMenu({ entry, rect: target.getBoundingClientRect() }));

  useEffect(() => { void loadEntries(list.id); }, [list.id, list.updatedAt, loadEntries]);

  const memberKey = list.memberIds.join(',');
  useEffect(() => {
    let alive = true;
    void getProfilesByIds(list.memberIds).then((p) => { if (alive) setProfiles(p); });
    return () => { alive = false; };
  }, [memberKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const entryKey = (entries || []).map((e) => e.restaurantId).join(',');
  useEffect(() => {
    if (list.ratingMode !== 'individual' || !entries || entries.length === 0) { setMemberRatings([]); return; }
    let alive = true;
    void getMembersRatings(list.memberIds, entries.map((e) => e.restaurantId)).then((rows) => { if (alive) setMemberRatings(rows); });
    return () => { alive = false; };
  }, [list.ratingMode, memberKey, entryKey, list.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // restaurantId → userId → score. My own local rating wins for me, so an
  // unpublished score still shows on my row.
  const scores = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of memberRatings) {
      if (!m.has(r.restaurant_id)) m.set(r.restaurant_id, new Map());
      m.get(r.restaurant_id)!.set(r.user_id, Number(r.score));
    }
    if (user?.id) {
      for (const e of entries || []) {
        const mine = getRating(e.restaurantId);
        if (mine) { if (!m.has(e.restaurantId)) m.set(e.restaurantId, new Map()); m.get(e.restaurantId)!.set(user.id, mine.score); }
      }
    }
    return m;
  }, [memberRatings, entries, user?.id, getRating]);

  const toMeta = (e: SharedListEntry): RestaurantMeta => ({ id: e.restaurantId, name: e.name, image: e.image, cuisine: e.cuisine, price: e.price, address: e.address });
  const fmt = (s: number) => (scoresUnlocked ? formatScore(s, twoDecimalScores) : '—');
  const modeLabel = list.ratingMode === 'group' ? 'Group score' : 'Individual';

  const rows = entries || [];
  const header = (
    <div className={cn('flex items-center gap-3', phoneMode ? 'mt-1 mb-3' : 'mb-4')}>
      <button type="button" onClick={() => setMembersOpen(true)} className="flex items-center gap-2 rounded-full bg-on-surface/[0.05] pl-1.5 pr-3 py-1.5 active:opacity-70 transition-opacity" aria-label="Members and settings">
        <MemberStack ids={list.memberIds} profiles={profiles} size={24} />
        <span className="text-on-surface/70" style={{ fontSize: '12px', fontWeight: 700 }}>{list.memberIds.length}</span>
      </button>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-on-surface/[0.12] px-3 py-1.5 text-on-surface/60" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {list.ratingMode === 'group' ? <Users size={11} /> : <Star size={11} />}
        {modeLabel}
      </span>
      <div className="flex-1" />
      <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary text-on-primary px-3.5 h-9 active:opacity-85 transition-opacity" style={{ fontSize: '12.5px', fontWeight: 700 }}>
        <Plus size={14} /> Add
      </button>
    </div>
  );

  return (
    <div className={cn(phoneMode ? 'px-4' : '')}>
      {phoneMode && !hidePhoneHeader && (
        <div className="pt-safe-4 flex items-center gap-2.5 mb-3.5">
          <GlassButton id="shared-list-back" symbol="chevron.left" label="Back" onClick={onBack} className="hit-44 flex-none w-11 h-11 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform">
            <ChevronLeft size={18} strokeWidth={2.1} />
          </GlassButton>
          <div className="flex-1 min-w-0">
            <p className="truncate text-on-surface" style={{ fontSize: '17px', fontWeight: 700 }}>{list.emoji} {list.name}</p>
          </div>
        </div>
      )}
      {!phoneMode && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface">{list.emoji} {list.name}</h2>
          <span className="text-on-surface/45" style={{ fontSize: '13px' }}>{rows.length} {rows.length === 1 ? 'place' : 'places'}</span>
        </div>
      )}
      {header}

      {entries === undefined ? (
        <p className="text-on-surface/45 py-8 text-center" style={{ fontSize: '13px' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div className="py-12 flex flex-col items-center text-center">
          <span className="w-14 h-14 rounded-full bg-on-surface/[0.06] text-on-surface/50 flex items-center justify-center"><ListPlus size={22} /></span>
          <p className="mt-4 text-on-surface" style={{ fontSize: '17px', fontWeight: 700 }}>Nothing here yet</p>
          <p className="mt-1 text-on-surface/50 max-w-[26ch]" style={{ fontSize: '13px', lineHeight: 1.5 }}>Anyone in the list can add places. {list.ratingMode === 'group' ? 'Then score them together.' : 'Everyone rates on their own.'}</p>
          <button type="button" onClick={() => setAddOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary text-on-primary px-5 h-11 active:opacity-85" style={{ fontSize: '13.5px', fontWeight: 700 }}><Plus size={14} /> Add places</button>
        </div>
      ) : (
        <ul className={cn(phoneMode ? 'divide-y divide-on-surface/[0.06]' : 'space-y-2.5')}>
          {rows.map((e, idx) => {
            const meta = toMeta(e);
            const perUser = scores.get(e.restaurantId);
            const memberScores = list.memberIds.map((id) => ({ id, score: perUser?.get(id) })).filter((x): x is { id: string; score: number } => typeof x.score === 'number');
            const avg = memberScores.length ? memberScores.reduce((s, x) => s + x.score, 0) / memberScores.length : null;
            const mine = user?.id ? perUser?.get(user.id) : undefined;
            const addedBy = profiles[e.addedBy];
            return (
              <li key={e.id} className={cn(!phoneMode && 'rounded-2xl border border-on-surface/[0.07] bg-white px-4')}>
                <div
                  role="button"
                  tabIndex={0}
                  {...press.getHandlers(e)}
                  onClick={() => { if (press.suppressClickRef.current) { press.suppressClickRef.current = false; return; } navigate(`/restaurant/${e.restaurantId}`); }}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') navigate(`/restaurant/${e.restaurantId}`); }}
                  className="w-full flex items-center gap-3 py-3 text-left"
                >
                  <span className="flex-none w-6 text-on-surface/35 tabular-nums text-center" style={{ fontSize: '12px', fontWeight: 700 }}>{idx + 1}</span>
                  {e.image
                    ? <img src={e.image} alt="" className="w-14 h-14 rounded-2xl object-cover flex-none bg-on-surface/[0.06]" referrerPolicy="no-referrer" />
                    : <div className="w-14 h-14 rounded-2xl flex-none bg-on-surface/[0.06] text-on-surface/40 flex items-center justify-center"><Utensils size={18} /></div>}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.01em' }}>{e.name}</p>
                    <p className="truncate text-on-surface/50 mt-0.5" style={{ fontSize: '12px' }}>{[e.cuisine, e.price].filter(Boolean).join(' · ')}{addedBy ? ` · added by ${e.addedBy === user?.id ? 'you' : nameOf(addedBy)}` : ''}</p>
                    {list.ratingMode === 'individual' && memberScores.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                        {memberScores.map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-on-surface/[0.05] pl-0.5 pr-2 py-0.5 flex-none">
                            <Avatar src={profiles[s.id]?.avatar_url} name={nameOf(profiles[s.id])} size={18} />
                            <span className="tabular-nums" style={{ fontSize: '11.5px', fontWeight: 700, color: scoreHex(s.score) }}>{fmt(s.score)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {list.ratingMode === 'group' && e.groupNotes && (
                      <p className="mt-1 truncate text-on-surface/60 italic" style={{ fontSize: '12px' }}>“{e.groupNotes}”</p>
                    )}
                  </div>
                  {list.ratingMode === 'group' ? (
                    e.groupScore != null ? (
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); setScoring(e); }} className={cn('flex-none inline-flex items-center h-9 px-3 rounded-full tabular-nums', scoreTint(e.groupScore))} style={{ fontSize: '14px', fontWeight: 700 }} aria-label="Edit group score">
                        {fmt(e.groupScore)}
                      </button>
                    ) : (
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); setScoring(e); }} className="flex-none inline-flex items-center gap-1 h-9 px-3 rounded-full border border-on-surface/15 text-on-surface" style={{ fontSize: '12px', fontWeight: 700 }}>
                        <Users size={12} /> Score
                      </button>
                    )
                  ) : avg != null ? (
                    <div className="flex-none text-right">
                      <div className={cn('inline-flex items-center h-9 px-3 rounded-full tabular-nums', scoreTint(avg))} style={{ fontSize: '14px', fontWeight: 700 }}>{fmt(avg)}</div>
                      <div className="text-on-surface/40 mt-0.5" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em' }}>{memberScores.length === 1 ? '1 SCORE' : `AVG OF ${memberScores.length}`}</div>
                    </div>
                  ) : (
                    <button type="button" onClick={(ev) => { ev.stopPropagation(); openAddRestaurantModal(meta); }} className="flex-none inline-flex items-center gap-1 h-9 px-3 rounded-full border border-on-surface/15 text-on-surface" style={{ fontSize: '12px', fontWeight: 700 }}>
                      <Star size={12} /> Rate
                    </button>
                  )}
                  {list.ratingMode === 'individual' && avg != null && mine == null && (
                    <span className="sr-only">You haven’t rated this</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {removingId && <DeleteConfirmation title="Remove this place?" message="It will be removed from this shared list. Your rating is kept." confirmLabel="Remove" onCancel={() => setRemovingId(null)} onConfirm={() => { void removePlace(list.id, removingId); setRemovingId(null); }} />}
      {menu && (
        <CardActionMenu
          rect={menu.rect}
          onClose={() => setMenu(null)}
          actions={[
            list.ratingMode === 'group'
              ? { label: menu.entry.groupScore != null ? 'Edit group score' : 'Score as a group', icon: <Users size={16} />, onClick: () => setScoring(menu.entry) }
              : { label: 'Rate it yourself', icon: <Star size={16} />, onClick: () => openAddRestaurantModal(toMeta(menu.entry)) },
            { label: 'Remove from list', icon: <Trash2 size={16} />, onClick: () => setRemovingId(menu.entry.restaurantId), danger: true },
          ] as CardAction[]}
        />
      )}

      <AddPlacesSheet open={addOpen} onClose={() => setAddOpen(false)} list={list} entries={rows} />
      <GroupScoreSheet
        open={!!scoring}
        onClose={() => setScoring(null)}
        entry={scoring}
        onSave={(score, notes) => setGroupScore(list.id, scoring!.restaurantId, score, notes)}
        onClear={() => setGroupScore(list.id, scoring!.restaurantId, null, '')}
      />
      <SharedListMembersSheet open={membersOpen} onClose={() => setMembersOpen(false)} list={list} profiles={profiles} onGone={onGone} />
    </div>
  );
};
