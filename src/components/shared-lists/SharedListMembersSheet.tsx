/**
 * Who's in a shared list, and (for the owner) everything about it: name,
 * emoji, how it rates, who's in it, and the delete. A member sees the
 * people and a Leave button.
 */
import React, { useEffect, useState } from 'react';
import { Crown, UserPlus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSharedLists } from '../../contexts/SharedListsContext';
import { GroupPicker } from '../GroupPicker';
import { Avatar } from '../Avatar';
import type { UserProfile } from '../../lib/supabase-community';
import type { SharedList, SharedRatingMode } from '../../lib/supabase-shared-lists';
import { SheetShell, SheetCta } from './SheetShell';
import { RatingModePicker, SHARED_EMOJI_OPTIONS } from './CreateSharedListSheet';

export const SharedListMembersSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  list: SharedList;
  profiles: Record<string, UserProfile>;
  /** The list is gone for this person (deleted or left). */
  onGone: () => void;
}> = ({ open, onClose, list, profiles, onGone }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { update, remove, leave } = useSharedLists();
  const isOwner = user?.id === list.ownerId;
  const [name, setName] = useState(list.name);
  const [emoji, setEmoji] = useState(list.emoji);
  const [mode, setMode] = useState<SharedRatingMode>(list.ratingMode);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(list.name); setEmoji(list.emoji); setMode(list.ratingMode); setConfirm(null); setBusy(false);
  }, [open, list.name, list.emoji, list.ratingMode]);

  const dirty = name.trim() !== list.name || emoji !== list.emoji || mode !== list.ratingMode;
  const nonOwnerMembers = list.memberIds.filter((id) => id !== list.ownerId).map((id) => profiles[id]).filter(Boolean) as UserProfile[];

  const saveSettings = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    const res = await update(list.id, { name: name.trim(), emoji, ratingMode: mode });
    setBusy(false);
    if (!res.success) { showToast("Couldn't save", { subtitle: res.error }); return; }
    showToast('Saved');
  };

  const setMembers = async (people: UserProfile[]) => {
    setPickerOpen(false);
    const res = await update(list.id, { memberIds: [list.ownerId, ...people.map((p) => p.user_id)] });
    if (!res.success) showToast("Couldn't update members", { subtitle: res.error });
  };

  const removeMember = async (id: string) => {
    const res = await update(list.id, { memberIds: list.memberIds.filter((m) => m !== id) });
    if (!res.success) showToast("Couldn't remove them", { subtitle: res.error });
  };

  const doDelete = async () => {
    setBusy(true);
    const ok = await remove(list.id);
    setBusy(false);
    if (!ok) { showToast("Couldn't delete the list"); return; }
    showToast('List deleted');
    onClose(); onGone();
  };
  const doLeave = async () => {
    setBusy(true);
    const ok = await leave(list.id);
    setBusy(false);
    if (!ok) { showToast("Couldn't leave the list"); return; }
    showToast(`You left ${list.name}`);
    onClose(); onGone();
  };

  const nameOf = (p?: UserProfile) => p?.display_name || p?.username || 'Someone';

  return (
    <>
      <SheetShell
        open={open}
        onClose={onClose}
        title={isOwner ? 'List settings' : 'Members'}
        subtitle={`${list.memberIds.length} ${list.memberIds.length === 1 ? 'person' : 'people'} · rated ${list.ratingMode === 'group' ? 'as a group' : 'individually'}`}
        footer={isOwner && dirty ? <SheetCta onClick={() => { void saveSettings(); }} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</SheetCta> : undefined}
      >
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">Members</p>
            {isOwner && (
              <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2 active:opacity-70 transition-opacity" style={{ fontSize: '11.5px', fontWeight: 700 }}>
                <UserPlus size={12} /> Add friends
              </button>
            )}
          </div>
          <ul className="divide-y divide-on-surface/[0.06]">
            {list.memberIds.map((id) => {
              const p = profiles[id];
              const owner = id === list.ownerId;
              const me = id === user?.id;
              return (
                <li key={id} className="flex items-center gap-3 py-2.5">
                  <Avatar src={p?.avatar_url} name={nameOf(p)} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{nameOf(p)}{me ? ' (you)' : ''}</p>
                    {p?.username && <p className="truncate text-on-surface/45" style={{ fontSize: '12px' }}>@{p.username}</p>}
                  </div>
                  {owner ? (
                    <span className="inline-flex items-center gap-1 text-on-surface/50" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}><Crown size={12} /> Owner</span>
                  ) : isOwner ? (
                    <button type="button" onClick={() => { void removeMember(id); }} aria-label={`Remove ${nameOf(p)}`} className="h-8 w-8 rounded-full flex items-center justify-center text-on-surface/45 hover:bg-on-surface/[0.06] hover:text-on-surface"><X size={15} /></button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        {isOwner && (
          <>
            <section className="mt-6">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">Name</p>
              <div className="flex items-center gap-2">
                <span className="flex-none w-11 h-11 rounded-2xl bg-on-surface/[0.06] flex items-center justify-center text-[20px]" aria-hidden>{emoji}</span>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className="flex-1 min-w-0 h-11 rounded-2xl bg-on-surface/[0.05] px-4 text-on-surface outline-none focus:ring-2 focus:ring-primary/30" style={{ fontSize: '15px', fontWeight: 600 }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Emoji">
                {SHARED_EMOJI_OPTIONS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={emoji === e} onClick={() => setEmoji(e)} className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-[18px] transition-colors', emoji === e ? 'bg-primary/[0.1] ring-2 ring-primary' : 'bg-on-surface/[0.05]')}>{e}</button>
                ))}
              </div>
            </section>
            <section className="mt-6">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">How you rate</p>
              <RatingModePicker value={mode} onChange={setMode} />
              {mode !== list.ratingMode && (
                <p className="mt-2 text-on-surface/50" style={{ fontSize: '12px' }}>
                  {mode === 'group' ? 'Group scores start empty; individual scores stay on each person.' : "The group scores stay saved; they'll come back if you switch again."}
                </p>
              )}
            </section>
          </>
        )}

        <section className="mt-8">
          {confirm ? (
            <div className="rounded-2xl bg-score-low-tint px-4 py-3">
              <p className="text-score-low-ink" style={{ fontSize: '13px', fontWeight: 600 }}>
                {confirm === 'delete' ? 'Delete this list for everyone? This can’t be undone.' : 'Leave this list? You can be added back by the owner.'}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirm(null)} className="flex-1 h-10 rounded-full bg-surface text-on-surface" style={{ fontSize: '13px', fontWeight: 700 }}>Cancel</button>
                <button type="button" disabled={busy} onClick={() => { void (confirm === 'delete' ? doDelete() : doLeave()); }} className="flex-1 h-10 rounded-full bg-score-low text-white disabled:opacity-50" style={{ fontSize: '13px', fontWeight: 700 }}>
                  {confirm === 'delete' ? 'Delete' : 'Leave'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirm(isOwner ? 'delete' : 'leave')} className="text-score-low-ink" style={{ fontSize: '13px', fontWeight: 700 }}>
              {isOwner ? 'Delete list' : 'Leave list'}
            </button>
          )}
        </section>
      </SheetShell>
      {isOwner && (
        <GroupPicker open={pickerOpen} onClose={() => setPickerOpen(false)} title="Who’s in?" subtitle="Mutual friends can join the list" ctaLabel={(n) => (n === 0 ? 'Pick someone' : `Add ${n} ${n === 1 ? 'friend' : 'friends'}`)} userId={user?.id ?? null} selected={nonOwnerMembers} onDone={(people) => { void setMembers(people); }} />
      )}
    </>
  );
};
