import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform, useDragControls } from 'motion/react';
import { ArrowUp, ChevronLeft, ChevronRight, Images, LayoutGrid, ImageOff, Sparkles, Search, X } from 'lucide-react';
import { acquireHardScrollLock } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';
import { holdGlass, releaseGlass } from '../lib/glass-buttons';
import { useNightStatusBar } from '../lib/night-status-bar';
import { homeHaptic } from '../lib/haptics';
import { photoPullDestination, photoPullIntent } from '../lib/restaurant-photo-gesture';
import type { GalleryRecreatePhoto } from './PhotoGallery';
import type { CommunityPhoto } from '../lib/supabase-community';
import { PhotoLikeButton } from './PhotoLikeButton';
import './RestaurantPhotoStage.css';

function Photo({ url, alt, className = '', lazy = false }: { url: string; alt: string; className?: string; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return failed ? <span className={`rps-photo-failed ${className}`} role="img" aria-label={`${alt}. Photo unavailable`}><ImageOff size={28} /><span>Photo unavailable</span></span>
    : <img loading={lazy ? "lazy" : "eager"} decoding="async" className={className} src={url} alt={alt} referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} />;
}
interface Props {
  name: string;
  photos: string[];
  communityPhotos?: Array<CommunityPhoto & { rawUrl?: string }>;
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interactionBlocked?: boolean;
  onRecreate?: (photo: GalleryRecreatePhoto) => void;
  children: React.ReactNode;
}
/** The photo header and restaurant card stay mounted throughout the reveal. */
export const RestaurantPhotoStage: React.FC<Props> = ({ name, photos, communityPhotos = [], index, onIndexChange, open, onOpenChange, onRecreate, interactionBlocked = false, children }) => {
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const progress = useMotionValue(open ? 1 : 0);
  const coverDrag = useDragControls();
  const reduced = useReducedMotion();
  const [presented, setPresented] = useState(open);
  const [grid, setGrid] = useState(false);
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const entries = photos.map((url, i) => {
    const community = communityPhotos.find(p => p.url === url);
    return { url, index: i, caption: community?.caption?.trim() || '', source: community ? 'GoodEats community' : 'Restaurant photos' };
  });
  const results = entries.filter(entry => `${entry.caption} ${entry.source} ${name} photo ${entry.index + 1}`.toLocaleLowerCase().includes(search));
  const showGrid = grid || !!search;
  useNightStatusBar(presented && !interactionBlocked);
  const presentedRef = useRef(presented); presentedRef.current = presented;
  const [geometry, setGeometry] = useState({ height: 852, hero: 307, travel: 485, left: 0, width: 393 });
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const releaseVelocity = useRef(0);
  const dragging = useRef(false);
  const suppressClickUntil = useRef(0);
  const current = Math.min(Math.max(0, index), photos.length - 1);
  const photo = communityPhotos.find(p => p.url === photos[current]);
  const caption = photo?.caption?.trim();
  const y = useTransform(progress, value => geometry.travel * Math.max(0, Math.min(1, value)));
  const imageOpacity = useTransform(progress, [0, .75], [1, 0]);
  const galleryOpacity = useTransform(progress, [.08, .65], [0, 1]);
  const coverOpacity = useTransform(progress, [0, .18], [1, 0]);
  const detailsOpacity = useTransform(progress, [.45, .85], [1, 0]);
  const dockOpacity = useTransform(progress, [.6, .95], [0, 1]);
  const latest = useRef({ open, grid: showGrid, onOpenChange, interactionBlocked });
  latest.current = { open, grid: showGrid, onOpenChange, interactionBlocked };

  const measure = useCallback(() => {
    if (!root.current) return;
    const rect = root.current.getBoundingClientRect();
    const viewport = window.visualViewport?.height || window.innerHeight;
    const hero = Math.min(360, Math.max(250, window.innerHeight * .36));
    const safeBottom = parseFloat(getComputedStyle(root.current).getPropertyValue('--rps-safe-bottom')) || 0;
    const next = { height: viewport, hero, travel: Math.max(1, viewport - 44 - safeBottom - (hero - 26)), left: rect.left, width: rect.width };
    setGeometry(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
  }, []);
  const prepare = useCallback(() => {
    measure();
    if (!presentedRef.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPresented(true);
  }, [measure]);
  const settle = useCallback((expanded: boolean, velocity = 0) => {
    animation.current?.stop();
    animation.current = animate(progress, expanded ? 1 : 0, {
      ...(reduced ? { duration: 0 } : {
        type: 'spring' as const, stiffness: 280, damping: 34, mass: 1,
        velocity: Math.max(-4, Math.min(4, velocity)), restDelta: .001, restSpeed: .01,
      }),
      onComplete: () => {
        if (!expanded) { setPresented(false); setGrid(false); setQuery(''); }
      },
    });
  }, [progress, reduced]);
  useEffect(() => {
    if (open) prepare();
    if (!dragging.current) { settle(open, releaseVelocity.current); releaseVelocity.current = 0; }
  }, [open, settle]); // prepare only snapshots geometry at the transition boundary.
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [measure]);
  useEffect(() => () => animation.current?.stop(), []);
  useEffect(() => {
    if (!presented) return;
    const releaseLock = acquireHardScrollLock();
    const releaseOverlay = pushOverlay({ dimPresenter: false });
    holdGlass();
    return () => { releaseGlass(); releaseOverlay(); releaseLock(); };
  }, [presented]);
  useEffect(() => {
    if (open && !interactionBlocked) closeButton.current?.focus({ preventScroll: true });
    else if (!presented && opener.current) {
      const target = opener.current.isConnected && opener.current !== document.body ? opener.current : handle.current;
      if (document.activeElement === document.body || root.current?.contains(document.activeElement)) target?.focus({ preventScroll: true });
      opener.current = null;
    }
  }, [open, presented, interactionBlocked]);
  // A browser/history navigation can leave a reading page retained but inert.
  // Release its modal/scroll ownership immediately, not only on unmount.
  useEffect(() => {
    const layer = root.current?.closest('[data-retained-route]');
    if (!presented || !layer) return;
    const observer = new MutationObserver(() => {
      if (layer.hasAttribute('inert')) {
        animation.current?.stop(); progress.set(0); setPresented(false); setGrid(false); latest.current.onOpenChange(false);
      }
    });
    observer.observe(layer, { attributes: true, attributeFilter: ['inert'] });
    return () => observer.disconnect();
  }, [presented, progress]);

  // Non-passive touch handling allows native upward scrolling everywhere,
  // taking ownership only for a downward pull begun at the top of the card.
  useEffect(() => {
    const element = root.current;
    if (!element || !photos.length) return;
    let gesture: { x: number; y: number; lastY: number; time: number; velocity: number; base: number; atTop: boolean; intent: string } | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) { end(true); return; }
      if (latest.current.interactionBlocked) return;
      suppressClickUntil.current = 0;
      const target = event.target as HTMLElement;
      const t = event.touches[0];
      if (t.clientX < 28 || target.closest('[data-horizontal-gesture],input,textarea,select,a') || (target.closest('button') && !target.closest('.rps-handle,.rps-dock'))) return;
      if (latest.current.grid && !target.closest(".rps-dock")) return;
      gesture = { x: t.clientX, y: t.clientY, lastY: t.clientY, time: event.timeStamp, velocity: 0, base: progress.get(), atTop: element.getBoundingClientRect().top >= -2, intent: 'wait' };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) { end(true); return; }
      const t = event.touches[0];
      if (gesture.intent === 'wait') gesture.intent = photoPullIntent(latest.current.open, t.clientX - gesture.x, t.clientY - gesture.y, gesture.atTop);
      if (gesture.intent !== 'pull') return;
      if (event.cancelable) event.preventDefault();
      if (!dragging.current) { animation.current?.stop(); dragging.current = true; prepare(); }
      const dt = event.timeStamp - gesture.time;
      if (dt > 0) gesture.velocity = (t.clientY - gesture.lastY) / dt;
      gesture.lastY = t.clientY; gesture.time = event.timeStamp;
      progress.set(Math.max(0, Math.min(1, gesture.base + (t.clientY - gesture.y) / geometry.travel)));
    };
    const end = (cancelled = false, time = 0) => {
      if (dragging.current && gesture) {
        dragging.current = false;
        suppressClickUntil.current = performance.now() + 500;
        const velocity = cancelled || time - gesture.time > 100 ? 0 : gesture.velocity;
        const next = cancelled ? latest.current.open : photoPullDestination(latest.current.open, progress.get(), velocity);
        // Motion uses progress/second; touch samples use pixels/millisecond.
        const normalizedVelocity = velocity * 1000 / geometry.travel;
        if (next !== latest.current.open) { releaseVelocity.current = normalizedVelocity; latest.current.onOpenChange(next); homeHaptic(); }
        else settle(next, normalizedVelocity);
      }
      gesture = null;
    };
    const finish = (event: TouchEvent) => end(false, event.timeStamp); const cancel = () => end(true);
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', finish);
    element.addEventListener('touchcancel', cancel);
    return () => { element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move); element.removeEventListener('touchend', finish); element.removeEventListener('touchcancel', cancel); };
  }, [photos.length, geometry.travel, prepare, settle, progress]);
  const step = (direction: number) => {
    if (photos.length < 2) return;
    onIndexChange((current + direction + photos.length) % photos.length);
  };
  useEffect(() => {
    if (!open || interactionBlocked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onOpenChange(false); }
      if (event.key !== 'Tab' && event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'Tab') {
        const buttons = (Array.from(root.current?.querySelectorAll('button:not(:disabled),input:not(:disabled)') || []) as HTMLButtonElement[]).filter(el => !el.closest('[inert]') && el.getClientRects().length > 0);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, current, photos.length, onOpenChange, interactionBlocked]);
  useEffect(() => {
    if (!open || showGrid) return;
    const rail = root.current?.querySelector('.rps-filmstrip');
    const thumb = rail?.querySelector<HTMLElement>('[aria-current=true]');
    if (rail && thumb) rail.scrollTo({ left: thumb.offsetLeft - rail.clientWidth / 2 + thumb.offsetWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
  }, [open, current, showGrid, reduced]);

  if (!photos.length) return <><div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 60px)' }} />{children}</>;
  return <div ref={root} data-no-pull-refresh="" className={`restaurant-photo-stage${presented ? ' is-presented' : ''}${open ? ' is-gallery' : ''}`}
    onClickCapture={event => { if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); suppressClickUntil.current = 0; } }}
    inert={interactionBlocked} role={open ? 'dialog' : undefined} aria-modal={(open && !interactionBlocked) || undefined} aria-label={open ? `Photos of ${name}` : undefined}
    style={{ '--rps-hero': `${geometry.hero}px`, '--rps-left': `${geometry.left}px`, '--rps-width': `${geometry.width}px` } as React.CSSProperties}>
    {/* The opaque details sheet reveals the canvas as it moves. Only the resting
        header needs clipping; changing a full-screen clip on every frame repaints on iOS. */}
    <div className="rps-canvas" style={{ height: geometry.height, clipPath: presented ? undefined : `inset(0 0 ${Math.max(0, geometry.height - geometry.hero)}px)` }}>
      <motion.div className="rps-cover" aria-hidden={presented} style={{ opacity: imageOpacity, height: geometry.hero }}>
        <motion.div className="rps-cover-track" data-horizontal-gesture="" dragListener={false} dragControls={coverDrag} onPointerDown={event => { if (!open && event.clientX > 28) coverDrag.start(event); }} onTap={() => { if (!latest.current.open && !dragging.current && performance.now() >= suppressClickUntil.current) onOpenChange(true); }} drag={!open && photos.length > 1 ? 'x' : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={.18}
          onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 45) step(info.offset.x < 0 ? 1 : -1); }}>
          <Photo url={photos[current]} alt={`${name}, photo ${current + 1}`} />
        </motion.div>
      </motion.div>
      <motion.div className="rps-cover-shade" style={{ opacity: progress }} />
      <motion.div className="rps-cover-controls" style={{ opacity: coverOpacity }} inert={presented} aria-hidden={presented}>
        <button onClick={() => onOpenChange(true)} className="rps-photo-count"><Images size={15} /> {photos.length} photos</button>
        <span className="rps-cover-position">{current + 1}<span> / {photos.length}</span></span>
      </motion.div>
      <motion.div className="rps-gallery" style={{ opacity: galleryOpacity }} inert={!open} aria-hidden={!open}>
        <>
        <header className="rps-gallery-header">
          <div><h2>Photos</h2><span>{name}</span></div>
          <button aria-label={showGrid ? 'Show selected photo' : 'Show all photos'} aria-pressed={showGrid} onClick={() => { setQuery(''); setGrid(!showGrid); }}><LayoutGrid size={19} /></button>
          <button ref={closeButton} aria-label="Return to restaurant details" onClick={() => onOpenChange(false)}><X size={20} /></button>
        </header>
        <div className="rps-search-row">
          <label data-search-field className="rps-search"><Search size={18} aria-hidden="true" /><input data-search-input="embedded" type="search" aria-label="Search restaurant photos" placeholder="Search captions & photos" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />{query && <button aria-label="Clear photo search" onClick={() => setQuery('')}><X size={16} /></button>}</label>
        </div>
        {showGrid ? <div className="rps-grid" data-horizontal-gesture="">
          <div className="rps-grid-title"><span aria-live="polite">{search ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : `${photos.length} photos`}</span><span>{search ? 'Matching captions & sources' : 'Explore every angle'}</span></div>
          {results.length ? <div className="rps-grid-items">{results.map(entry => <button key={`${entry.url}-${entry.index}`} aria-label={`View photo ${entry.index + 1}`} onClick={() => { onIndexChange(entry.index); setQuery(''); setGrid(false); }}><Photo lazy url={entry.url} alt={entry.caption || `${name}, photo ${entry.index + 1}`} />{entry.caption && <span>{entry.caption}</span>}</button>)}</div>
            : <div className="rps-empty"><Search size={28} /><strong>No matching photos</strong><p>Try a dish name or words from a caption. Photos without captions can be found under “restaurant” or “community”.</p><button onClick={() => { setQuery(''); setGrid(true); }}>Show all photos</button></div>}
        </div>
          : <>
            <div className="rps-photo-display">
              <motion.div key={photos[current]} className="rps-photo-full" initial={false}
                drag={photos.length > 1 ? 'x' : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={.18}
                onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 45) step(info.offset.x < 0 ? 1 : -1); }}>
                <Photo url={photos[current]} alt={caption || `${name}, photo ${current + 1}`} />
              </motion.div>
              {photos.length > 1 && <div className="rps-arrows"><button aria-label="Previous photo" onClick={() => step(-1)}><ChevronLeft size={19} /></button><button aria-label="Next photo" onClick={() => step(1)}><ChevronRight size={19} /></button></div>}
            </div>
            <div className="rps-photo-meta"><div><strong>{caption || name}</strong><span aria-live="polite">{current + 1} of {photos.length} · {photo ? 'GoodEats community' : 'Restaurant photos'}</span></div>
              {photo?.id && <PhotoLikeButton photoId={photo.id} onSignInNeeded={() => onOpenChange(false)} />}
              {photo && onRecreate && <button aria-label="Recreate this dish" onClick={() => { opener.current = null; onRecreate({ url: photo.url, rawUrl: photo.rawUrl || photo.url, caption: photo.caption || '', ownerUserId: photo.user_id }); }}><Sparkles size={17} /></button>}
            </div>
            <div className="rps-filmstrip" data-horizontal-gesture="" aria-label="Choose a photo">{photos.map((url, i) => <button key={`${url}-${i}`} aria-label={`Photo ${i + 1}`} aria-current={i === current} onClick={() => onIndexChange(i)}><Photo lazy url={url} alt="" /></button>)}</div>
          </>}
        </>
      </motion.div>
    </div>
    <div className="rps-hero-spacer" aria-hidden />
    <motion.div ref={sheet} className="rps-sheet" style={{ y }}>
      <button ref={handle} className="rps-handle" aria-label="Pull down to explore restaurant photos" aria-expanded={open} onClick={() => onOpenChange(!open)} inert={open}><span /></button>
      <motion.div className="rps-details" style={{ opacity: detailsOpacity }} inert={open} aria-hidden={open}>{children}</motion.div>
      <motion.button className="rps-dock" style={{ opacity: dockOpacity }} inert={!open} aria-hidden={!open} onClick={() => onOpenChange(false)}><span className="rps-dock-grabber" /><span><strong>Restaurant details</strong></span><ArrowUp size={20} /></motion.button>
    </motion.div>
  </div>;
}
