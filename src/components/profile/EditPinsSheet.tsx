/**
 * Edit pins — the sheet behind the shelf's Edit pill.
 *
 * Same bones as the Top lists editor on the profile: what's on your
 * profile now (drag to reorder, × to remove), then what you could add,
 * split by kind. Rows toggle; a fourth tap says three is the limit rather
 * than quietly dropping one. Every change saves as it happens — there is
 * no Done button to forget.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { X, Check, Plus, Search, GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { useBottomSheet } from '../../lib/useBottomSheet';
import { MAX_PINS, isPinned, samePin, type PinnedItem, type PinnedType } from '../../lib/pins';
import { usePins } from '../../lib/pins-store';

export interface PinCandidate {
  pin: PinnedItem;
  title: string;
  subtitle?: string;
  image?: string;
}

type Kind = 'restaurant' | 'meal' | 'guide' | 'post' | 'reel';
const KINDS: Array<{ key: Kind; label: string }> = [
  { key: 'restaurant', label: 'Places' },
  { key: 'meal', label: 'Recipes' },
  { key: 'guide', label: 'Guides' },
  { key: 'post', label: 'Posts' },
  { key: 'reel', label: 'Reels' },
];

const Thumb: React.FC<{ image?: string; title: string }> = ({ image, title }) => (
  image
    ? <img src={image} alt="" className="w-11 h-11 rounded-xl object-cover flex-none bg-on-surface/[0.06]" referrerPolicy="no-referrer" />
    : <div className="w-11 h-11 rounded-xl flex-none bg-on-surface/[0.06] text-on-surface/40 flex items-center justify-center" style={{ fontSize: '14px', fontWeight: 700 }}>{title.slice(0, 1).toUpperCase()}</div>
);

export const EditPinsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Everything the owner could pin, any order; the sheet groups by kind. */
  candidates: PinCandidate[];
}> = ({ open, onClose, candidates }) => {
  const { phoneMode } = useSettings();
  const { pins, toggle, replace } = usePins();
  const [kind, setKind] = useState<Kind>('restaurant');
  const [query, setQuery] = useState('');
  // Handle-only drag: the pinned list is a Reorder.Group on the same axis.
  const { dragProps, startDrag } = useBottomSheet(open, onClose);

  useEffect(() => { if (open) { setKind('restaurant'); setQuery(''); } }, [open]);

  const byKey = useMemo(() => new Map(candidates.map((c) => [`${c.pin.type}:${c.pin.id}`, c])), [candidates]);
  const current = pins.map((p) => byKey.get(`${p.type}:${p.id}`) ?? { pin: p, title: `${p.type}` });
  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => c.pin.type === kind)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.subtitle || '').toLowerCase().includes(q));
  }, [candidates, kind, query]);
  const kindCounts = useMemo(() => {
    const m: Partial<Record<PinnedType, number>> = {};
    for (const c of candidates) m[c.pin.type] = (m[c.pin.type] ?? 0) + 1;
    return m;
  }, [candidates]);
  const full = pins.length >= MAX_PINS;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-[70]',
            phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const }, ...dragProps }
              : {
                  initial: { opacity: 0, scale: 0.94, y: -12 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.96, y: -8 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'bg-surface flex flex-col overflow-hidden',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl max-h-[85vh]'
                : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
            role="dialog"
            aria-modal="true"
            aria-label="Edit pinned items"
          >
            {phoneMode && (
              <div onPointerDown={startDrag} className="flex justify-center pt-3 pb-1 touch-none cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            <div className={cn('flex flex-shrink-0 items-start justify-between gap-4 border-b border-on-surface/[0.06]', phoneMode ? 'px-5 pb-4 pt-3' : 'px-7 pb-5 pt-6')}>
              <div className="min-w-0">
                <h3 className={cn('font-serif font-bold leading-tight text-on-surface', phoneMode ? 'text-[21px]' : 'text-[25px]')}>Pinned</h3>
                <p className="mt-1 text-[12.5px] leading-snug text-on-surface/45">
                  {pins.length === 0
                    ? `Pick up to ${MAX_PINS} things for the top of your profile.`
                    : full
                      ? `${MAX_PINS} of ${MAX_PINS} on your profile. Drag to reorder, or unpin one to add another.`
                      : `${pins.length} of ${MAX_PINS} on your profile. Drag to reorder, or add another below.`}
                </p>
              </div>
              <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface/45 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface">
                <X size={17} />
              </button>
            </div>

            <div className={cn('flex-1 overflow-y-auto', phoneMode ? 'px-5 py-5' : 'px-7 py-6')}>
              <section>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">On your profile</p>
                {current.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-on-surface/[0.12] px-4 py-6 text-center">
                    <p className="text-[13px] text-on-surface/45">Nothing pinned yet — add something below.</p>
                  </div>
                ) : (
                  <Reorder.Group axis="y" values={pins} onReorder={(next) => { void replace(next as PinnedItem[]); }} className="space-y-1.5">
                    {current.map((c) => (
                      <Reorder.Item
                        key={`${c.pin.type}:${c.pin.id}`}
                        value={pins.find((p) => samePin(p, c.pin))!}
                        className="group flex cursor-grab select-none items-center gap-3 rounded-2xl border border-on-surface/[0.07] bg-surface px-3 py-2.5 transition-colors active:cursor-grabbing hover:border-on-surface/[0.14]"
                        whileDrag={{ scale: 1.015, boxShadow: '0 14px 34px -14px rgba(0,0,0,0.3)' }}
                      >
                        <GripVertical size={15} className="flex-none text-on-surface/25" />
                        <Thumb image={c.image} title={c.title} />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{c.title}</p>
                          {c.subtitle && <p className="truncate text-on-surface/45" style={{ fontSize: '12px' }}>{c.subtitle}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => { void toggle(c.pin); }}
                          aria-label={`Unpin ${c.title}`}
                          className="flex-none h-8 w-8 rounded-full flex items-center justify-center text-on-surface/45 hover:bg-on-surface/[0.06] hover:text-on-surface transition-colors"
                        >
                          <X size={15} />
                        </button>
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                )}
              </section>

              <section className="mt-7">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">Add</p>
                <div className="flex rounded-full bg-on-surface/[0.05] p-1">
                  {KINDS.map((k) => {
                    const on = kind === k.key;
                    return (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => { setKind(k.key); setQuery(''); }}
                        aria-pressed={on}
                        className={cn('flex-1 min-w-0 rounded-full py-2 transition-colors truncate', on ? 'bg-surface dark:bg-on-surface/[0.14] text-on-surface shadow-[0_1px_4px_rgba(0,0,0,0.08)]' : 'text-on-surface/55')}
                        style={{ fontSize: '12px', fontWeight: 700 }}
                      >
                        {k.label}
                      </button>
                    );
                  })}
                </div>

                {(kindCounts[kind] ?? 0) > 8 && (
                  <label className="mt-3 flex items-center gap-2 rounded-full bg-on-surface/[0.05] px-3.5 h-10">
                    <Search size={14} className="flex-none text-on-surface/40" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={`Search ${KINDS.find((k) => k.key === kind)?.label.toLowerCase()}`}
                      className="flex-1 min-w-0 bg-transparent outline-none text-on-surface placeholder:text-on-surface/35"
                      style={{ fontSize: '14px' }}
                    />
                  </label>
                )}

                {available.length === 0 ? (
                  <p className="mt-4 text-[13px] text-on-surface/45">
                    {query ? 'Nothing matches.' : 'Nothing here yet.'}
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-on-surface/[0.06]">
                    {available.slice(0, 60).map((c) => {
                      const on = isPinned(pins, c.pin);
                      const blocked = !on && full;
                      return (
                        <li key={`${c.pin.type}:${c.pin.id}`}>
                          <button
                            type="button"
                            onClick={() => { void toggle(c.pin); }}
                            aria-pressed={on}
                            className={cn('w-full flex items-center gap-3 py-2.5 text-left transition-opacity active:opacity-70', blocked && 'opacity-45')}
                          >
                            <Thumb image={c.image} title={c.title} />
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{c.title}</p>
                              {c.subtitle && <p className="truncate text-on-surface/45" style={{ fontSize: '12px' }}>{c.subtitle}</p>}
                            </div>
                            <span className={cn('flex-none h-8 w-8 rounded-full flex items-center justify-center transition-colors', on ? 'bg-primary text-on-primary' : 'bg-on-surface/[0.06] text-on-surface/60')}>
                              {on ? <Check size={15} /> : <Plus size={15} />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
