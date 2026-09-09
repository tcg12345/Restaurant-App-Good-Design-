/** Profile pins: a compact live preview above a searchable content picker. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder, useReducedMotion } from 'motion/react';
import { X, Check, Plus, Search, ChevronDown, Utensils, ChefHat, BookOpen, Image as ImageIcon, Film } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { useBottomSheet } from '../../lib/useBottomSheet';
import { MAX_PINS, isPinned, samePin, type PinnedItem, type PinnedType } from '../../lib/pins';
import { usePins } from '../../lib/pins-store';
import { useSocialDialog } from '../social/useSocialDialog';
import './EditPinsSheet.css';

export interface PinCandidate {
  pin: PinnedItem;
  title: string;
  subtitle?: string;
  image?: string;
}

type Kind = 'all' | 'restaurant' | 'meal' | 'guide' | 'post' | 'reel';
const KINDS: Array<{ key: Kind; label: string }> = [
  { key: 'all', label: 'All items' }, { key: 'restaurant', label: 'Places' },
  { key: 'meal', label: 'Recipes' }, { key: 'guide', label: 'Guides' },
  { key: 'post', label: 'Posts' }, { key: 'reel', label: 'Reels' },
];
const ICONS = { restaurant: Utensils, meal: ChefHat, recipe: ChefHat, guide: BookOpen, post: ImageIcon, reel: Film };
const LABELS: Record<PinnedType, string> = { restaurant: 'Place', meal: 'Recipe', recipe: 'Recipe', guide: 'Guide', post: 'Post', reel: 'Reel' };
const keyFor = (pin: PinnedItem) => `${pin.type}:${pin.id}`;

const Thumb: React.FC<{ candidate: PinCandidate }> = ({ candidate }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [candidate.image]);
  const Icon = ICONS[candidate.pin.type];
  return <span className="pins-editor-thumb" aria-hidden="true">
    {candidate.image && !failed ? <img src={candidate.image} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon size={21} strokeWidth={1.6} />}
  </span>;
};

export const EditPinsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  candidates: PinCandidate[];
}> = ({ open, onClose, candidates }) => {
  const { phoneMode } = useSettings();
  const { pins, toggle, replace } = usePins();
  const reduced = useReducedMotion();
  const [kind, setKind] = useState<Kind>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const [order, setOrder] = useState(pins);
  const orderRef = useRef(order); orderRef.current = order;
  const dragging = useRef(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const { dragProps, startDrag } = useBottomSheet(open, onClose);
  const dialogRef = useSocialDialog(open, onClose);

  useEffect(() => {
    dragging.current = false;
    if (open) { setKind('all'); setQuery(''); }
    setOrder(pins);
  }, [open]);
  useEffect(() => { setLimit(60); }, [kind, query]);
  useEffect(() => { if (!dragging.current) setOrder(pins); }, [pins]);
  const byKey = useMemo(() => new Map(candidates.map(c => [keyFor(c.pin), c])), [candidates]);
  const current = order.map(pin => byKey.get(keyFor(pin)) ?? { pin, title: LABELS[pin.type] });
  const available = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return candidates.filter(c => (kind === 'all' || c.pin.type === kind || (kind === 'meal' && c.pin.type === 'recipe'))
      && (!q || `${c.title} ${c.subtitle || ''}`.toLocaleLowerCase().includes(q)));
  }, [candidates, kind, query]);
  const full = pins.length >= MAX_PINS;

  // Keep reordering local during the gesture. Persist only the final order,
  // rather than issuing a save each time two tiles cross under the finger.
  const saveOrder = async (next: PinnedItem[]) => {
    dragging.current = false;
    if (saving.current || next.every((pin, i) => pins[i] && samePin(pin, pins[i]))) return;
    saving.current = true; setBusy(true);
    try { if (!await replace(next)) setOrder(pins); }
    finally { saving.current = false; setBusy(false); }
  };
  const toggleItem = async (pin: PinnedItem) => {
    if (saving.current || dragging.current) return;
    saving.current = true; setBusy(true);
    try { await toggle(pin); } finally { saving.current = false; setBusy(false); }
  };
  const movePin = (index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= order.length || saving.current) return;
    const next = [...order]; [next[index], next[target]] = [next[target], next[index]];
    setOrder(next); void saveOrder(next);
  };

  return <AnimatePresence>{open && <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}
    className={cn('pins-editor-backdrop', !phoneMode && 'is-desktop')} onClick={onClose}>
    <motion.div
      {...(phoneMode ? {
        initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
        transition: { duration: reduced ? 0 : .42, ease: [.32, .72, 0, 1] as const }, ...dragProps,
      } : {
        initial: { opacity: 0, scale: .98, y: 12 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: .98, y: 12 },
        transition: { duration: reduced ? 0 : .22 },
      })}
      ref={dialogRef} onClick={event => event.stopPropagation()}
      className={cn('pins-editor', phoneMode && 'is-phone')} role="dialog" aria-modal="true" aria-label="Edit pinned items">
      {phoneMode && <div onPointerDown={startDrag} className="pins-editor-grabber"><span /></div>}
      <header className="pins-editor-header">
        <h2 tabIndex={-1} data-dialog-initial-focus>Pinned <span aria-label={`${pins.length} of ${MAX_PINS} pinned`} aria-live="polite">{pins.length}/{MAX_PINS}</span></h2>
        <button type="button" className="pins-editor-done" onClick={onClose}>Done</button>
      </header>
      <section className="pins-editor-preview" aria-label="Pinned items in profile order">
        <Reorder.Group axis="x" values={order} onReorder={next => { orderRef.current = next; setOrder(next); }} className="pins-editor-slots">
          {current.map((candidate, index) => <Reorder.Item
            key={keyFor(candidate.pin)} value={order[index]} dragListener={!busy}
            onDragStart={() => { dragging.current = true; }} onDragEnd={event => {
              if (event.type === 'pointercancel' || event.type === 'touchcancel') { dragging.current = false; setOrder(pins); }
              else void saveOrder(orderRef.current);
            }}
            whileDrag={{ scale: 1.04, zIndex: 2 }} className="pins-editor-slot is-filled"
            tabIndex={0} aria-label={`Pin ${index + 1}: ${candidate.title}`} aria-describedby="pins-editor-reorder-help"
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); movePin(index, event.key === 'ArrowLeft' ? -1 : 1); }
            }}>
            <Thumb candidate={candidate} />
            <span className="pins-editor-slot-title">{candidate.title}</span>
            <button type="button" aria-label={`Unpin ${candidate.title}`} disabled={busy} onPointerDown={event => event.stopPropagation()}
              onClick={() => { void toggleItem(candidate.pin); }} className="pins-editor-remove"><span><X size={13} strokeWidth={2.5} /></span></button>
          </Reorder.Item>)}
          {Array.from({ length: MAX_PINS - current.length }, (_, i) => <li key={`empty-${i}`} className="pins-editor-slot is-empty" aria-label={`Empty pin ${current.length + i + 1}`}><Plus size={19} strokeWidth={1.5} /></li>)}
        </Reorder.Group>
        <p className="pins-editor-hint">{full ? 'Unpin one to add another' : pins.length ? 'Drag pins to reorder' : 'Choose up to 3 favorites'}</p>
        <span id="pins-editor-reorder-help" className="sr-only">Drag to reorder, or use the left and right arrow keys.</span>
      </section>
      <div className="pins-editor-tools">
        <label data-search-field className="pins-editor-search"><Search size={18} aria-hidden="true" />
          <input data-search-input="embedded" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" aria-label="Search items to pin"
            type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button>}
        </label>
        <label className="pins-editor-category"><span className="sr-only">Content type</span>
          <select aria-label="Content type" value={kind} onChange={event => setKind(event.target.value as Kind)}>{KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
      </div>
      <div className="pins-editor-results">
        {available.length ? <ul>{available.slice(0, limit).map(candidate => {
          const selected = isPinned(pins, candidate.pin);
          return <li key={keyFor(candidate.pin)}><button type="button" className={cn('pins-editor-row', selected && 'is-selected', !selected && full && 'is-unavailable')}
            disabled={busy || (!selected && full)} aria-pressed={selected} onClick={() => { void toggleItem(candidate.pin); }}>
            <Thumb candidate={candidate} />
            <span className="pins-editor-row-copy"><strong>{candidate.title}</strong><span>{candidate.subtitle || LABELS[candidate.pin.type]}</span></span>
            <span className="pins-editor-check" aria-hidden="true">{selected ? <Check size={13} strokeWidth={2.6} /> : <Plus size={15} />}</span>
          </button></li>;
        })}</ul> : <div className="pins-editor-empty"><Search size={25} strokeWidth={1.5} /><strong>{query ? 'No matches' : 'Nothing here yet'}</strong>{query && <button type="button" onClick={() => setQuery('')}>Clear search</button>}</div>}
        {available.length > limit && <button type="button" className="pins-editor-more" onClick={() => setLimit(value => value + 60)}>Show more</button>}
      </div>
    </motion.div>
  </motion.div>}</AnimatePresence>;
};
