/**
 * The group's one score for a place. A slider rather than the full rating
 * flow: the table already decided over dinner, this just writes it down.
 */
import React, { useEffect, useState } from 'react';
import { scoreHex, formatScore, scoreTier } from '../../lib/score';
import { useSettings } from '../../contexts/SettingsContext';
import type { SharedListEntry } from '../../lib/supabase-shared-lists';
import { SheetShell, SheetCta } from './SheetShell';

const TIER_WORD: Record<ReturnType<typeof scoreTier>, string> = { high: 'Loved it', mid: 'It was fine', low: 'Not for us' };

export const GroupScoreSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  entry: SharedListEntry | null;
  onSave: (score: number, notes: string) => Promise<boolean> | boolean;
  onClear: () => Promise<boolean> | boolean;
}> = ({ open, onClose, entry, onSave, onClear }) => {
  const { twoDecimalScores } = useSettings();
  const [value, setValue] = useState(7.5);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue(entry?.groupScore ?? 7.5);
    setNotes(entry?.groupNotes ?? '');
    setBusy(false);
  }, [open, entry]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSave(Math.round(value * 10) / 10, notes.trim());
    setBusy(false);
    if (ok) onClose();
  };
  const clear = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onClear();
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={entry?.name || 'Group score'}
      subtitle="The score your group gives this place."
      footer={
        <div className="flex gap-2">
          {entry?.groupScore != null && (
            <button type="button" onClick={() => { void clear(); }} disabled={busy} className="flex-none h-12 px-5 rounded-full border border-on-surface/15 text-on-surface active:opacity-70 disabled:opacity-40" style={{ fontSize: '14px', fontWeight: 700 }}>
              Clear
            </button>
          )}
          <div className="flex-1"><SheetCta onClick={() => { void save(); }} disabled={busy}>{busy ? 'Saving…' : 'Save score'}</SheetCta></div>
        </div>
      }
    >
      <div className="text-center pt-2">
        <div className="font-serif font-bold tabular-nums leading-none" style={{ fontSize: '64px', color: scoreHex(value) }}>
          {formatScore(value, twoDecimalScores)}
        </div>
        <div className="mt-2 inline-flex items-center rounded-full px-3 py-1" style={{ background: `${scoreHex(value)}22`, color: scoreHex(value), fontSize: '12.5px', fontWeight: 700 }}>
          {TIER_WORD[scoreTier(value)]}
        </div>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={0.1}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        aria-label="Group score"
        className="mt-6 w-full accent-primary"
      />
      <div className="flex justify-between text-on-surface/40 mt-1" style={{ fontSize: '11px', fontWeight: 600 }}><span>1</span><span>10</span></div>
      <label className="block mt-6">
        <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">A note from the table</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          placeholder="What everyone agreed on…"
          rows={3}
          className="w-full rounded-2xl bg-on-surface/[0.05] px-4 py-3 text-on-surface placeholder:text-on-surface/35 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          style={{ fontSize: '14px' }}
        />
      </label>
    </SheetShell>
  );
};
