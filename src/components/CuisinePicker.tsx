/**
 * Pick (or correct) a restaurant's cuisine.
 *
 * The shared cuisine cache ranks a person's answer above every derived
 * source (migration 068), but until this existed nothing could write that
 * tier — a wrong label, including one the app guessed off the restaurant's
 * name, was permanent. This is the way in.
 *
 * A bottom sheet on a phone and a centred dialog on a desktop, from the
 * same component: the list is long enough to need a search box either way,
 * and duplicating it once per viewport is how the two drift apart.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Pencil, Plus, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { CUISINE_TYPES } from '../lib/places';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';

/** Every label the taxonomy knows, minus the "All" sentinel. */
const ALL_LABELS = CUISINE_TYPES.filter((c) => c.type).map((c) => c.label).sort((a, b) => a.localeCompare(b));

export const CuisinePicker: React.FC<{
  open: boolean;
  onClose: () => void;
  onSelect: (cuisine: string) => void;
  /** The cuisine currently shown, ticked in the list. */
  current?: string;
  /** Named in the header so it's obvious what is being labelled. */
  restaurantName?: string;
}> = ({ open, onClose, onSelect, current, restaurantName }) => {
  const { phoneMode } = useSettings();
  const [query, setQuery] = useState('');
  const sheet = useBottomSheet(open && phoneMode, onClose);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) setQuery(''); }, [open]);

  // Escape closes on desktop, where there's no drag-to-dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_LABELS;
    // Prefix matches first — typing "ch" should reach Chinese before
    // French, which merely contains the letters.
    const starts = ALL_LABELS.filter((c) => c.toLowerCase().startsWith(q));
    const contains = ALL_LABELS.filter((c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [query]);

  const pick = (label: string) => { onSelect(label); onClose(); };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="cuisine-picker-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className={cn(
            'fixed inset-0 z-[200] flex justify-center bg-black/55 backdrop-blur-sm',
            phoneMode ? 'items-end' : 'items-center px-6',
          )}
        >
          <motion.div
            key="cuisine-picker"
            initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97 }}
            animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97 }}
            transition={phoneMode ? { type: 'spring', damping: 30, stiffness: 320 } : { duration: 0.16 }}
            {...(phoneMode ? sheet.dragProps : {})}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a cuisine"
            className={cn(
              'flex w-full flex-col overflow-hidden bg-surface',
              phoneMode
                ? 'max-h-[82vh] rounded-t-[28px]'
                : 'max-h-[70vh] max-w-[440px] rounded-[24px] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.45)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {phoneMode && (
              <div className="flex justify-center pt-2.5 pb-1" onPointerDown={sheet.startDrag} aria-hidden>
                <div className="h-1 w-9 rounded-full bg-on-surface/15" />
              </div>
            )}

            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
              <div className="min-w-0">
                <h2 className="font-serif text-[19px] font-bold leading-tight text-on-surface">
                  {current ? 'Change the cuisine' : 'Add a cuisine'}
                </h2>
                <p className="mt-0.5 truncate text-[12.5px] text-on-surface/45">
                  {restaurantName
                    ? `for ${restaurantName} — everyone sees it`
                    : 'Everyone sees this, so make it the one that fits.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1.5 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface/45 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
              >
                <X size={17} />
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 rounded-2xl bg-on-surface/[0.05] px-3.5 h-11">
                <Search size={15} className="flex-shrink-0 text-on-surface/35" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search cuisines…"
                  // No autoFocus on a phone: it throws the keyboard up over
                  // the list the moment the sheet opens.
                  autoFocus={!phoneMode}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-on-surface outline-none placeholder:text-on-surface/35"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="flex-shrink-0 text-on-surface/35 hover:text-on-surface"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              {filtered.length === 0 ? (
                <p className="px-2 py-8 text-center text-[13.5px] text-on-surface/45">
                  Nothing matches “{query.trim()}”.
                </p>
              ) : (
                <ul>
                  {filtered.map((label) => {
                    const active = !!current && label.toLowerCase() === current.toLowerCase();
                    return (
                      <li key={label}>
                        <button
                          type="button"
                          onClick={() => pick(label)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-on-surface/[0.05]',
                            active && 'bg-on-surface/[0.05]',
                          )}
                        >
                          <span className={cn('text-[15px] text-on-surface', active ? 'font-bold' : 'font-medium')}>
                            {label}
                          </span>
                          {active && <Check size={16} className="flex-shrink-0 text-primary" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

/**
 * The cuisine · price eyebrow on a restaurant header, made editable.
 *
 * Three headers show this line — phone, desktop-over-photo, desktop
 * editorial — and each has its own typography, so the caller supplies the
 * classes and this owns only the behaviour: tap to correct when there is a
 * cuisine, and an explicit "Add cuisine" when there isn't. The add state is
 * the one that matters; it appears exactly on the places this whole effort
 * is about, where nothing else could work the cuisine out.
 */
export const EditableCuisineLine: React.FC<{
  cuisine: string;
  priceStr?: string;
  onEdit: () => void;
  /** Sits over a photo, so the affordance has to read on a dark wash. */
  onPhoto?: boolean;
  className?: string;
}> = ({ cuisine, priceStr, onEdit, onPhoto, className }) => {
  if (!cuisine) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 align-middle transition-colors',
            onPhoto
              ? 'border-white/45 text-white/85 hover:border-white/80 hover:text-white'
              : 'border-on-surface/25 text-on-surface/50 hover:border-on-surface/45 hover:text-on-surface/80',
          )}
        >
          <Plus size={11} strokeWidth={2.6} />
          Add cuisine
        </button>
        {priceStr && <span className="ml-2 align-middle">{priceStr}</span>}
      </div>
    );
  }
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onEdit}
        title="Not right? Set the cuisine"
        className="inline-flex items-center gap-1.5 rounded transition-opacity hover:opacity-70"
      >
        {cuisine}
        <Pencil size={10} strokeWidth={2.4} className="opacity-0 transition-opacity group-hover/cuisine:opacity-60" />
      </button>
      {priceStr && <span>{`  ·  ${priceStr}`}</span>}
    </div>
  );
};
