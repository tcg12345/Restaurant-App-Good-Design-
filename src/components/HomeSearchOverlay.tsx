import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Navigation, X } from 'lucide-react';
import { SearchMain } from '../pages/SearchMain';
import { SearchField } from './SearchField';
import { HomeLocationBar, isExactAddress } from './HomeLocationBar';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { GlassButton, useGlassButtonsActive } from '../lib/glass-buttons';
import { acquireHardScrollLock, liftOverlayToTopLayer } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';
import './HomeSearchOverlay.css';

/** The same live results as Search, presented above the retained Home tab. */
export function HomeSearchOverlay({ active, onClose }: { active: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [locationOpen, setLocationOpen] = useState(false);
  const home = useHomeLocation();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const glass = useGlassButtonsActive();
  const parts = home?.location?.label.split(',').map(part => part.trim()) ?? [];
  const city = home?.location && isExactAddress(home.location) ? parts[1] || parts[0] : parts[0];

  // A detail route can cover this screen without destroying its query or scroll.
  // Only the visible takeover owns the overlay lock / native tab-bar visibility.
  useLayoutEffect(() => {
    if (!active) return;
    const node = root.current;
    liftOverlayToTopLayer(node);
    const releaseOverlay = pushOverlay();
    const releaseScroll = acquireHardScrollLock();
    return () => {
      if (node?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
      if (node?.matches(':popover-open')) node.hidePopover();
      releaseScroll();
      releaseOverlay();
    };
  }, [active]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      });
    };
  }, []);

  return <motion.div ref={root} role="dialog" aria-modal="true" aria-label="Search" className="home-search-overlay kb-pad"
    initial={{ opacity: 0, y: reduced ? 0 : -24 }} animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: reduced ? 0 : -16 }}
    transition={{ duration: reduced ? .12 : .3, ease: [.22, 1, .36, 1] }}
    onAnimationComplete={() => { if (active && !glass && !locationOpen && !query) input.current?.focus({ preventScroll: true }); }}
    onKeyDown={event => {
      // Nested portaled sheets handle their own keyboard navigation.
      if (locationOpen || !event.currentTarget.contains(event.target as Node)) return;
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from<HTMLElement>(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not([readonly]), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true');
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <div className="home-search-overlay-chrome">
      <div className="home-search-overlay-toolbar">
        <GlassButton id="home-search-close" symbol="xmark" label="Close search" onClick={onClose} className="home-search-overlay-close"><X size={24} /></GlassButton>
        <button className="home-search-overlay-location glass-control" onClick={() => setLocationOpen(true)} aria-label={`Search location: ${city || 'Current location'}`}><Navigation size={19} /><span>{city || 'Current location'}</span></button>
      </div>
      <SearchField glassId="home-search-field" variant="floating" tall value={query} onChange={setQuery}
        inputRef={input} autoFocus={glass && active} placeholder="Restaurants, recipes, people" aria-label="Search"
        onSubmit={() => input.current?.blur()} />
    </div>
    <div className="home-search-overlay-results">
      <SearchMain embedded query={query} onQueryChange={setQuery} inputRef={glass ? undefined : input} />
    </div>
    {home && <HomeLocationBar variant="headless" open={active && locationOpen} onOpenChange={setLocationOpen} sheetZ="z-[220]"
      location={home.location} onChange={home.setLocation} onUseCurrent={home.useCurrent} />}
  </motion.div>;
}
