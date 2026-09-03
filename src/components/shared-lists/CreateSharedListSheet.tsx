/**
 * Create a shared list: a name, an emoji, who's in it, and how it rates.
 *
 * The rating mode is the one decision worth explaining in the sheet
 * itself, because it changes what a row means: "Individual" lays each
 * person's own score side by side; "Group" keeps one score the table
 * agreed on. It can be changed later from the members sheet.
 */
import React, { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSharedLists } from '../../contexts/SharedListsContext';
import { GroupPicker } from '../GroupPicker';
import { Avatar } from '../Avatar';
import type { UserProfile } from '../../lib/supabase-community';
import type { SharedList, SharedRatingMode } from '../../lib/supabase-shared-lists';
import { SheetShell, SheetCta } from './SheetShell';

export const SHARED_EMOJI_OPTIONS = ['👥', '🍽️', '🥂', '🍕', '🍣', '🌮', '🍜', '🔥', '💎', '🎉', '✈️', '🏙️', '🌿', '☕', '🍰', '⭐'];

export const RATING_MODES: Array<{ key: SharedRatingMode; label: string; blurb: string }> = [
  { key: 'individual', label: 'Individually', blurb: "Everyone's own score sits side by side, with the average." },
  { key: 'group', label: 'As a group', blurb: 'One score the table agrees on. Anyone in the list can set it.' },
];

export const RatingModePicker: React.FC<{ value: SharedRatingMode; onChange: (m: SharedRatingMode) => void }> = ({ value, onChange }) => (
  <div className="space-y-2">
    {RATING_MODES.map((m) => {
      const on = value === m.key;
      return (
        <button
          key={m.key}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => onChange(m.key)}
          className={cn('w-full flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors', on ? 'border-primary bg-primary/[0.04]' : 'border-on-surface/[0.1]')}
        >
          <span className={cn('mt-0.5 flex-none w-4 h-4 rounded-full border-2 flex items-center justify-center', on ? 'border-primary' : 'border-on-surface/30')}>
            {on && <span className="w-2 h-2 rounded-full bg-primary" />}
          </span>
          <span className="min-w-0">
            <span className="block text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>Rate {m.label.toLowerCase()}</span>
            <span className="block text-on-surface/50 mt-0.5" style={{ fontSize: '12.5px', lineHeight: 1.4 }}>{m.blurb}</span>
          </span>
        </button>
      );
    })}
  </div>
);

export const CreateSharedListSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (list: SharedList) => void;
}> = ({ open, onClose, onCreated }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { create } = useSharedLists();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👥');
  const [mode, setMode] = useState<SharedRatingMode>('individual');
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setEmoji('👥'); setMode('individual'); setMembers([]); setSaving(false); }
  }, [open]);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const res = await create({ name: name.trim(), emoji, ratingMode: mode, memberIds: members.map((m) => m.user_id) });
    setSaving(false);
    if ('error' in res) { showToast("Couldn't create the list", { subtitle: res.error }); return; }
    showToast('Shared list created', { subtitle: members.length ? `${members.length} ${members.length === 1 ? 'friend' : 'friends'} can add to it now.` : 'Add friends from the members sheet.' });
    onCreated(res.list);
    onClose();
  };

  return (
    <>
      <SheetShell
        open={open}
        onClose={onClose}
        title="New shared list"
        subtitle="A list you and your friends keep together."
        footer={<SheetCta onClick={() => { void submit(); }} disabled={!name.trim() || saving}>{saving ? 'Creating…' : 'Create list'}</SheetCta>}
      >
        <label className="block">
          <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">Name</span>
          <div className="flex items-center gap-2">
            <span className="flex-none w-11 h-11 rounded-2xl bg-on-surface/[0.06] flex items-center justify-center text-[20px]" aria-hidden>{emoji}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              placeholder="Friday dinner club"
              autoFocus
              className="flex-1 min-w-0 h-11 rounded-2xl bg-on-surface/[0.05] px-4 text-on-surface placeholder:text-on-surface/35 outline-none focus:ring-2 focus:ring-primary/30"
              style={{ fontSize: '15px', fontWeight: 600 }}
            />
          </div>
        </label>

        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Emoji">
          {SHARED_EMOJI_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              role="radio"
              aria-checked={emoji === e}
              onClick={() => setEmoji(e)}
              className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-[18px] transition-colors', emoji === e ? 'bg-primary/[0.1] ring-2 ring-primary' : 'bg-on-surface/[0.05]')}
            >
              {e}
            </button>
          ))}
        </div>

        <section className="mt-6">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">How you rate</p>
          <RatingModePicker value={mode} onChange={setMode} />
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">Members</p>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2 active:opacity-70 transition-opacity"
              style={{ fontSize: '11.5px', fontWeight: 700 }}
            >
              <UserPlus size={12} />
              {members.length ? 'Edit' : 'Add friends'}
            </button>
          </div>
          {members.length === 0 ? (
            <p className="text-on-surface/45" style={{ fontSize: '13px' }}>Just you for now. Mutual friends can be added any time.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {members.map((m) => (
                <li key={m.user_id} className="inline-flex items-center gap-2 rounded-full bg-on-surface/[0.05] pl-1 pr-2 py-1">
                  <Avatar src={m.avatar_url} name={m.display_name || m.username} size={24} />
                  <span className="text-on-surface" style={{ fontSize: '12.5px', fontWeight: 600 }}>{m.display_name || m.username}</span>
                  <button type="button" onClick={() => setMembers((prev) => prev.filter((p) => p.user_id !== m.user_id))} aria-label={`Remove ${m.display_name || m.username}`} className="text-on-surface/40 hover:text-on-surface">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </SheetShell>
      <GroupPicker open={pickerOpen} onClose={() => setPickerOpen(false)} title="Who’s in?" subtitle="Mutual friends can join the list" ctaLabel={(n) => (n === 0 ? 'Pick someone' : `Add ${n} ${n === 1 ? 'friend' : 'friends'}`)} userId={user?.id ?? null} selected={members} onDone={(people) => { setMembers(people); setPickerOpen(false); }} />
    </>
  );
};
