import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Search, X } from 'lucide-react';
import { acquireHardScrollLock, mergeRefs, useBottomSheet } from '../lib/useBottomSheet';
import { useGlassOccluder } from '../lib/glass-buttons';
import './LocationPicker.css';

/** Keeps viewport, scroll, focus and gesture ownership until the exit completes. */
export const LocationPickerSurface: React.FC<{
  phoneMode: boolean; sheetZ: string; query: string; onQueryChange: (value: string) => void;
  onClose: () => void; children: React.ReactNode;
}> = ({ phoneMode, sheetZ, query, onQueryChange, onClose, children }) => {
  const panel = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const { sheetRef, dragProps } = useBottomSheet(true, onClose, scroll);
  const ref = useMemo(() => mergeRefs<HTMLDivElement>(panel, sheetRef), [sheetRef]);
  const glass = useGlassOccluder();
  const reduced = useReducedMotion();
  const [viewport, setViewport] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const release = acquireHardScrollLock();
    const update = () => { const v = window.visualViewport; if (v) setViewport({ width: v.width, height: v.height, top: v.offsetTop, left: v.offsetLeft, bottom: 'auto', right: 'auto' }); };
    update(); window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
    panel.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from<HTMLElement>(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || []).filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update);
      release(); if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <motion.div ref={glass} className={`location-picker-layer ${sheetZ}${phoneMode ? ' is-phone' : ''}`} style={viewport}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div {...dragProps} ref={ref} className="location-picker-sheet" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="location-picker-title"
      initial={reduced ? false : { y: '100%' }} animate={{ y: 0 }} exit={{ y: reduced ? 0 : '100%', transition: { duration: reduced ? 0 : .18 } }}
      transition={{ duration: reduced ? 0 : .24, ease: [.22, 1, .36, 1] }} dragMomentum={false} dragTransition={{ bounceStiffness: 370, bounceDamping: 38 }}>
      <div className="location-picker-grabber" aria-hidden="true"><span /></div>
      <header className="location-picker-header"><h2 id="location-picker-title">Choose location</h2><button ref={closeButton} aria-label="Close location picker" onClick={onClose}><X size={21} /></button></header>
      <div className="location-picker-search-wrap"><label className="location-picker-search"><Search size={19} /><input type="search" aria-label="Search locations" placeholder="City, neighborhood or address" value={query} onChange={event => onQueryChange(event.target.value)} autoComplete="off" spellCheck={false} />{query && <button aria-label="Clear location search" onClick={() => onQueryChange('')}><X size={17} /></button>}</label></div>
      <div ref={scroll} className="location-picker-content">{children}</div>
    </motion.div>
  </motion.div>;
};
