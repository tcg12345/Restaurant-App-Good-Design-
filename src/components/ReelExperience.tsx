import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChefHat, ChevronRight, Film, ImagePlus, MapPin, X } from 'lucide-react';
import { useBottomSheet } from '../lib/useBottomSheet';
import { isOverlayOpen, subscribeOverlay } from '../lib/overlay-registry';
import type { ActiveReelMedia } from './MuxReelMedia';
import './ReelExperience.css';

export function ReelCaption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setExpanded(false);
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 2);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [text]);
  if (!text) return null;
  return <div className="reel-caption">
    <p ref={ref} className={expanded ? 'is-expanded' : ''}>{text}</p>
    {(overflows || expanded) && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Less' : 'More'}</button>}
  </div>;
}

export function ReelAttachment({ title, subtitle, image, recipe, score, onClick }: {
  title: string; subtitle: string; image?: string; recipe?: boolean; score?: number; onClick: () => void;
}) {
  return <button type="button" className="reel-attachment" onClick={onClick} aria-label={`${recipe ? 'View recipe' : 'View restaurant'}: ${title}`}>
    <span className="reel-attachment-image">
      {recipe ? <ChefHat size={20} /> : <MapPin size={20} />}
      {image && <img src={image} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} />}
    </span>
    <span className="reel-attachment-copy"><strong>{title}</strong><span>{subtitle || (recipe ? 'View recipe' : 'Explore this place')}</span></span>
    {!!score && <span className="reel-attachment-score" aria-label={`Rated ${score.toFixed(1)} out of 10`}>{score.toFixed(1)}</span>}
    <ChevronRight size={16} />
  </button>;
}

export function ReelCreateSheet({ open, onClose, onReel, onPost }: { open: boolean; onClose: () => void; onReel: () => void; onPost: () => void }) {
  const { sheetRef, dragProps, startDrag } = useBottomSheet(open, onClose);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, sheetRef]);
  return <AnimatePresence>{open && <motion.div className="reel-create-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.section ref={sheetRef as React.RefObject<HTMLElement>} {...dragProps} role="dialog" aria-modal="true" aria-labelledby="reel-create-title" className="reel-create-sheet"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
        if (event.key !== 'Tab') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll('button')) as HTMLButtonElement[];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      initial={{ y: reduced ? 0 : '100%' }} animate={{ y: 0 }} exit={{ y: reduced ? 0 : '100%' }} transition={{ duration: reduced ? 0 : .32, ease: [.22, 1, .36, 1] }} onClick={e => e.stopPropagation()}>
      <div className="reel-create-handle" onPointerDown={startDrag}><span /></div>
      <header><h2 id="reel-create-title">Share something good</h2><button type="button" onClick={onClose} aria-label="Close create menu"><X size={20} /></button></header>
      <button type="button" className="reel-create-option" onClick={onReel}><span><Film size={24} /></span><span><strong>Create a reel</strong><small>A place, a dish, a little inspiration.</small></span><ChevronRight size={18} /></button>
      <button type="button" className="reel-create-option" onClick={onPost}><span><ImagePlus size={24} /></span><span><strong>Share photos</strong><small>Bring the whole experience together.</small></span><ChevronRight size={18} /></button>
    </motion.section>
  </motion.div>}</AnimatePresence>;
}

/** Pause under overlays and in the background. Only resume media that was
 * playing before interruption; a deliberate pause remains a pause. */
export function useReelPlaybackFocus(rootRef: React.RefObject<HTMLDivElement | null>, blocked: boolean, layoutKey: boolean) {
  const blockedRef = useRef(blocked);
  const updateRef = useRef<() => void>(() => {});
  blockedRef.current = blocked;
  useEffect(() => { updateRef.current(); }, [blocked]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const resume = new Set<HTMLMediaElement>();
    let overlay = isOverlayOpen();
    let disposed = false;
    const suspended = () => blockedRef.current || overlay || document.hidden;
    const media = (): HTMLMediaElement[] => Array.from(root.querySelectorAll('video, mux-player')) as HTMLMediaElement[];
    const update = () => {
      if (suspended()) {
        for (const el of media()) if (!el.paused) { resume.add(el); el.pause(); }
      } else {
        // Let a closing chooser hand off to another overlay before resuming.
        queueMicrotask(() => {
          if (disposed || suspended()) return;
          for (const el of resume) if (el.isConnected && el.closest('[data-feed-active="true"]')) void el.play()?.catch(() => {});
          resume.clear();
        });
      }
    };
    const play = (event: Event) => {
      const el = event.target as HTMLMediaElement;
      if (suspended() && typeof el.pause === 'function') { resume.add(el); el.pause(); }
    };
    updateRef.current = update;
    root.addEventListener('play', play, true);
    document.addEventListener('visibilitychange', update);
    const unsubscribe = subscribeOverlay(open => { overlay = open; update(); });
    update();
    return () => {
      disposed = true;
      unsubscribe();
      document.removeEventListener('visibilitychange', update);
      root.removeEventListener('play', play, true);
      // Route unmounts never leave audible media behind.
      for (const el of media()) el.pause();
    };
  }, [rootRef, layoutKey]);
}

/** Slow connections remain understandable without flashing a spinner on every swipe. */
export function ReelPlaybackStatus({ media }: { media: ActiveReelMedia | null }) {
  const [status, setStatus] = useState<'ready' | 'waiting' | 'error'>('ready');
  useEffect(() => {
    const el = media?.el as HTMLMediaElement | undefined;
    setStatus('ready');
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const ready = () => { clearTimeout(timer); setStatus('ready'); };
    const waiting = () => { clearTimeout(timer); timer = setTimeout(() => setStatus('waiting'), 650); };
    const error = () => { clearTimeout(timer); setStatus('error'); };
    el.addEventListener('waiting', waiting);
    el.addEventListener('playing', ready);
    el.addEventListener('canplay', ready);
    el.addEventListener('pause', ready);
    el.addEventListener('error', error);
    if (el.error) error();
    return () => {
      clearTimeout(timer);
      el.removeEventListener('waiting', waiting);
      el.removeEventListener('playing', ready);
      el.removeEventListener('canplay', ready);
      el.removeEventListener('pause', ready);
      el.removeEventListener('error', error);
    };
  }, [media]);
  if (status === 'ready') return null;
  return <div className="reel-playback-status" role="status">
    {status === 'waiting' ? <><span className="reel-buffer-ring" />Loading video</> : <><span>This video couldn’t play.</span><button type="button" onClick={() => {
      setStatus('ready');
      const el = media?.el as HTMLMediaElement | undefined;
      el?.load();
      void el?.play()?.catch(() => setStatus('error'));
    }}>Try again</button></>}
  </div>;
}
