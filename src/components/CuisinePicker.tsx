/**
 * Suggest a restaurant's cuisine.
 *
 * A cuisine everyone reads is not something one person gets to write.
 * Picking here files a proposal (migration 069): it applies when an admin
 * approves it, or when AUTO_APPLY_VOTES independent people propose the
 * same thing. The copy says so — a control that looks like it edited
 * something, and didn't, is worse than no control.
 *
 * A bottom sheet on a phone and a centred dialog on a desktop, from the
 * same component: the list is long enough to need a search box either way,
 * and duplicating it once per viewport is how the two drift apart.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Clock, Loader2, Plus, Search, SquarePen, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { SUGGESTABLE_CUISINES, searchCuisines } from '../lib/cuisine';
import { AUTO_APPLY_VOTES } from '../lib/supabase-cuisine-suggestions';
import { CUISINE_MAX_COUNT } from '../lib/restaurant-cuisine';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';

const ALL_LABELS = SUGGESTABLE_CUISINES;

export const CuisinePicker: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Files the suggestion. Resolves false when it didn't go through, so
   *  the sheet can stay open rather than pretending it worked. */
  onSelect: (cuisine: string) => Promise<boolean> | boolean | void;
  /** Every cuisine the restaurant already has, ticked in the list. A place
   *  can hold up to CUISINE_MAX_COUNT of them (migration 071). */
  current?: string | string[];
  /** Named in the header so it's obvious what is being labelled. */
  restaurantName?: string;
  /** A proposal this user already has in for this place. */
  pending?: string;
}> = ({ open, onClose, onSelect, current, restaurantName, pending }) => {
  const existing = useMemo(
    () => (Array.isArray(current) ? current : current ? [current] : [])
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
    [current],
  );
  const full = existing.length >= CUISINE_MAX_COUNT;
  const { phoneMode } = useSettings();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState('');
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const sheet = useBottomSheet(open && phoneMode, onClose, listScrollRef);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) { setQuery(''); setSaving(''); } }, [open]);

  // Escape closes on desktop, where there's no drag-to-dismiss.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Ranking and alias handling live in lib/cuisine, where they are tested
  // — the list is long enough now that "type three letters and hope" is
  // not a search.
  const filtered = useMemo(() => searchCuisines(query, ALL_LABELS), [query]);

  const pick = async (label: string) => {
    if (saving) return;
    setSaving(label);
    const ok = await onSelect(label);
    setSaving('');
    if (ok !== false) onClose();
  };

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
            ref={phoneMode ? (sheet.sheetRef as React.RefObject<HTMLDivElement>) : undefined}
            initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97 }}
            animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97 }}
            transition={phoneMode ? { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const } : { duration: 0.16 }}
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
              <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
                <div className="h-1 w-9 rounded-full bg-on-surface/15" />
              </div>
            )}

            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
              <div className="min-w-0">
                <h2 className="font-serif text-[19px] font-bold leading-tight text-on-surface">
                  Suggest a cuisine
                </h2>
                <p className="mt-0.5 text-[12.5px] leading-snug text-on-surface/45">
                  {restaurantName ? <>for <span className="font-semibold text-on-surface/65">{restaurantName}</span>. </> : null}
                  {existing.length > 0
                    ? <>A restaurant can have up to {CUISINE_MAX_COUNT}, so this is an <em className="not-italic font-semibold text-on-surface/65">additional</em> one. </>
                    : null}
                  Sent for review — it goes live once it's approved, or once {AUTO_APPLY_VOTES} people suggest the same thing.
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

            {full && (
              <div className="mx-5 mb-3 rounded-xl bg-on-surface/[0.05] px-3 py-2.5 text-[12.5px] leading-snug text-on-surface/60">
                This restaurant already has {CUISINE_MAX_COUNT} cuisines, the most it can hold. You
                can still suggest one — a reviewer would have to swap it for an existing one.
              </div>
            )}

            {pending && (
              <div className="mx-5 mb-3 flex items-center gap-2 rounded-xl bg-primary/[0.07] px-3 py-2.5 text-[12.5px] text-on-surface/70">
                <Clock size={13} className="flex-shrink-0 text-primary" />
                <span>You suggested <span className="font-bold text-on-surface">{pending}</span> — waiting on review. Picking again replaces it.</span>
              </div>
            )}

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

            <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              {filtered.length === 0 ? (
                <p className="px-2 py-8 text-center text-[13.5px] text-on-surface/45">
                  Nothing matches “{query.trim()}”.
                </p>
              ) : (
                <ul>
                  {filtered.map((label) => {
                    const active = existing.includes(label.toLowerCase());
                    return (
                      <li key={label}>
                        <button
                          type="button"
                          onClick={() => { if (!active) void pick(label); }}
                          aria-disabled={active}
                          title={active ? 'Already one of this restaurant’s cuisines' : undefined}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors',
                            active ? 'cursor-default bg-on-surface/[0.05]' : 'hover:bg-on-surface/[0.05]',
                          )}
                        >
                          <span className={cn('text-[15px] text-on-surface', active ? 'font-bold' : 'font-medium')}>
                            {label}
                          </span>
                          {saving === label
                            ? <Loader2 size={15} className="flex-shrink-0 animate-spin text-primary" />
                            : active && <Check size={16} className="flex-shrink-0 text-primary" />}
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
 * The cuisine · price eyebrow on a restaurant header, with a way to
 * propose a change.
 *
 * Three headers show this line — phone, desktop-over-photo, desktop
 * editorial — and each has its own typography, so the caller supplies the
 * classes and this owns only the behaviour.
 *
 * The affordance is deliberately a distinct blue: everything else on these
 * headers is the app's own voice, and this is the one control that hands
 * something to a human to review. It reads "Suggest a cuisine" when there
 * is none — the state this whole effort is about — and "Suggest edit"
 * when there is one. Never "Edit": it doesn't edit anything.
 */
export const EditableCuisineLine: React.FC<{
  cuisine: string;
  priceStr?: string;
  onEdit: () => void;
  /** Sits over a photo, so the affordance has to read on a dark wash. */
  onPhoto?: boolean;
  /** This user already has a proposal in for this place. */
  pending?: boolean;
  /**
   * A credit for where this cuisine came from, when it came from
   * somewhere that requires one. Only OpenStreetMap does (ODbL), and only
   * for the minority of places it answered, so this line is absent from
   * almost every restaurant.
   */
  credit?: string;
  className?: string;
}> = ({ cuisine, priceStr, onEdit, onPhoto, pending, credit, className }) => {
  // Warm and quiet. This chip sits under a serif name on cream paper: a
  // blue dashed outline was the one cold thing on the page, and a bordered
  // pill made an editorial footnote look like a call to action. It is a
  // small tinted affordance now, and it only firms up on press.
  const tone = onPhoto
    ? 'text-white/70 active:text-white'
    : 'text-on-surface/35 active:text-primary';
  const label = pending ? 'Suggestion pending' : cuisine ? 'Suggest edit' : 'Suggest a cuisine';
  const Icon = pending ? Clock : cuisine ? SquarePen : Plus;
  return (
    <div className={className}>
      {cuisine && <span className="align-middle">{cuisine}</span>}
      {cuisine && priceStr && <span className="align-middle">{`  ·  ${priceStr}`}</span>}
      {!cuisine && priceStr && <span className="align-middle">{priceStr}</span>}
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          'ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 align-middle text-[11px] tracking-normal transition-colors',
          pending ? 'opacity-70' : '',
          tone,
        )}
      >
        <Icon size={11} strokeWidth={2.2} />
        {label}
      </button>
      {credit && (
        // Its own line, and outside the header's uppercase tracking: a
        // licence notice that has to be read is not a design element.
        <span className={cn(
          'mt-1 block text-[10px] font-normal normal-case tracking-normal',
          onPhoto ? 'text-white/60' : 'text-on-surface/40',
        )}>
          {credit}
        </span>
      )}
    </div>
  );
};
