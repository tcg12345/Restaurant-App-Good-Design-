import { PhotoImage } from '../PhotoImage';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { X, ChevronLeft, ChevronRight, LayoutGrid, ImageOff } from 'lucide-react';
import { acquireHardScrollLock, liftOverlayToTopLayer } from '../../lib/useBottomSheet';
import { pushOverlay } from '../../lib/overlay-registry';
import { useSocialDialog } from '../social/useSocialDialog';
import './GuidePhotoGallery.css';

export function GalleryImage({ url, alt, eager = false }: { url: string; alt: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return failed ? <span className="guide-gallery-unavailable" role="img" aria-label={`${alt}. Photo unavailable`}><ImageOff size={24} /><span>Photo unavailable</span></span>
    : <PhotoImage src={url} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function GuidePhotoGallery({ name, photos, initialIndex, onClose }: {
  name: string; photos: string[]; initialIndex: number; onClose: () => void;
}) {
  const [active, setActive] = useState(Math.max(0, Math.min(initialIndex, photos.length - 1)));
  const activeRef = useRef(active); activeRef.current = active;
  const [grid, setGrid] = useState(false);
  const track = useRef<HTMLDivElement>(null), thumbs = useRef<HTMLDivElement>(null);
  const dialog = useSocialDialog(true, onClose);
  const reduced = useReducedMotion();
  useLayoutEffect(() => { liftOverlayToTopLayer(dialog.current); }, [dialog]);
  useEffect(() => { const unlock = acquireHardScrollLock(); const release = pushOverlay({ dimPresenter: false }); return () => { release(); unlock(); }; }, []);
  useLayoutEffect(() => {
    const align = () => { const element = track.current; if (element) element.scrollTo({ left: activeRef.current * element.clientWidth, behavior: 'instant' }); };
    align(); window.addEventListener('resize', align);
    return () => window.removeEventListener('resize', align);
  }, [grid]);
  useEffect(() => {
    const rail = thumbs.current, thumb = rail?.children[active] as HTMLElement | undefined;
    if (rail && thumb) rail.scrollTo({ left: thumb.offsetLeft - rail.clientWidth / 2 + thumb.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
  }, [active, grid, reduced]);
  const go = (index: number) => {
    const next = Math.max(0, Math.min(index, photos.length - 1));
    setActive(next); activeRef.current = next;
    if (grid) { setGrid(false); return; }
    const element = track.current;
    element?.scrollTo({ left: next * element.clientWidth, behavior: reduced ? 'instant' : 'smooth' });
  };
  return createPortal(<motion.div ref={dialog} className="guide-gallery" role="dialog" aria-modal="true" aria-label={`Photos of ${name}`}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .2 }}
    onKeyDown={event => {
      if (grid || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); go(activeRef.current + (event.key === 'ArrowLeft' ? -1 : 1)); }
    }}>
    <header className="guide-gallery-header">
      <div><h2 tabIndex={-1} data-dialog-initial-focus>{name}</h2><p aria-live="polite">{grid ? `${photos.length} photos` : `${active + 1} of ${photos.length}`}</p></div>
      {photos.length > 1 && <button type="button" aria-label={grid ? 'Show selected photo' : 'Show all photos'} aria-pressed={grid} onClick={() => setGrid(value => !value)}><LayoutGrid size={20} /></button>}
      <button type="button" aria-label="Close photo gallery" onClick={onClose}><X size={21} /></button>
    </header>
    {grid ? <div className="guide-gallery-grid">{photos.map((url, index) => <button type="button" key={url} aria-label={`Open photo ${index + 1}`} onClick={() => go(index)}><GalleryImage url={url} alt={`${name}, photo ${index + 1}`} /></button>)}</div> : <>
      <div className="guide-gallery-stage">
        <div ref={track} className="guide-gallery-track" onScroll={event => {
          const element = event.currentTarget;
          if (element.clientWidth) setActive(Math.max(0, Math.min(photos.length - 1, Math.round(element.scrollLeft / element.clientWidth))));
        }}>{photos.map((url, index) => <figure key={url} aria-hidden={index !== active}><GalleryImage url={url} alt={`${name}, photo ${index + 1}`} eager={Math.abs(index - active) <= 1} /></figure>)}</div>
        {photos.length > 1 && <div className="guide-gallery-arrows"><button type="button" aria-label="Previous photo" disabled={active === 0} onClick={() => go(active - 1)}><ChevronLeft size={21} /></button><button type="button" aria-label="Next photo" disabled={active === photos.length - 1} onClick={() => go(active + 1)}><ChevronRight size={21} /></button></div>}
      </div>
      {photos.length > 1 && <div ref={thumbs} className="guide-gallery-thumbs" aria-label="Choose a photo">{photos.map((url, index) => <button type="button" key={url} aria-label={`Photo ${index + 1}`} aria-current={index === active} onClick={() => go(index)}><GalleryImage url={url} alt="" /></button>)}</div>}
    </>}
  </motion.div>, document.body);
}
