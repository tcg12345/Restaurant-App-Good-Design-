import { useDevicePreference } from '../lib/device-preferences';
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, ChefHat, Compass, BadgeCheck, Sparkles, Pause, Play, Users } from 'lucide-react';
import { homeHaptic } from '../lib/haptics';
import { isOverlayOpen } from '../lib/overlay-registry';
import type { HomeHighlight } from '../lib/home-highlights';

export function HomeHighlights({ items, active, onOpen, onSeen }: { onSeen?: (item: HomeHighlight) => void; items: HomeHighlight[]; active: boolean; onOpen: (item: HomeHighlight) => void }) {
  const [autoplay] = useDevicePreference('homeAutoplay');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const key = items.map(i => i.id).join('|');
  useEffect(() => { setIndex(0); }, [key]);
  const selected = index % items.length;
  useEffect(() => {
    if (!active || !autoplay || paused || engaged || reduced || items.length < 2) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !isOverlayOpen()) setIndex(i => (i + 1) % items.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [active, autoplay, paused, engaged, reduced, items.length, selected]);
  const item = items[selected];
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  useEffect(() => {
    if (!active || !item) return;
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible' && !isOverlayOpen()) onSeenRef.current?.(item);
    }, 2500);
    return () => clearTimeout(timer);
  }, [active, item]);
  if (!item) return null;
  const select = (next: number) => { homeHaptic(); setPaused(true); setIndex((next + items.length) % items.length); };
  const Icon = item.family === 'recipes' ? ChefHat : item.family === 'friends' ? Users : item.family === 'experts' ? BadgeCheck : item.family === 'taste' ? Sparkles : Compass;
  return <section className={`home-highlights tone-${item.tone}`} aria-roledescription="carousel" aria-label="Ideas for you"
    onMouseEnter={() => setEngaged(true)} onMouseLeave={() => setEngaged(false)}
    onFocusCapture={() => setEngaged(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setEngaged(false); }}
    onTouchStart={e => { suppressClickUntil.current = 0; touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
    onTouchCancel={() => { touch.current = null; }}
    onTouchEnd={e => {
      if (!touch.current) return;
      const dx = e.changedTouches[0].clientX - touch.current.x, dy = e.changedTouches[0].clientY - touch.current.y;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { suppressClickUntil.current = performance.now() + 500; select(selected + (dx < 0 ? 1 : -1)); }
      touch.current = null;
    }}>
    <AnimatePresence initial={false} mode="popLayout">
      <motion.button key={item.id} className="home-highlight" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .45 }}
        onClick={() => { if (performance.now() < suppressClickUntil.current) return; homeHaptic(); onOpen(item); }} aria-label={`${item.eyebrow}: ${item.title}. ${item.cta}`}>
        <div className="home-highlight-art" aria-hidden="true"><Icon strokeWidth={1} />{item.image && <img src={item.image} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />}</div>
        <div className="home-highlight-shade" />
        <div className="home-highlight-copy"><span>{item.eyebrow}</span><h2>{item.title}</h2><p>{item.detail}</p><strong>{item.cta}<ArrowUpRight size={18} /></strong></div>
      </motion.button>
    </AnimatePresence>
    <div className="home-highlight-controls">
      <div role="group" aria-label="Choose an idea">{items.map((idea, i) => <button key={idea.id} aria-label={`Show idea ${i + 1}: ${idea.title}`} aria-pressed={i === selected} onClick={() => select(i)}><span /></button>)}</div>
      {!reduced && autoplay && <button className="home-highlight-pause" aria-label={paused ? 'Play ideas' : 'Pause ideas'} onClick={() => setPaused(p => !p)}>{paused ? <Play size={13} /> : <Pause size={13} />}</button>}
    </div>
  </section>;
}
