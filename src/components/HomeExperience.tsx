import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, MapPin, Search, Star, Sparkles, MessageCircle, ChefHat, Users } from 'lucide-react';
import { homeSwipeDestination, type HomeDestination } from '../lib/home-gesture';
import { isOverlayOpen } from '../lib/overlay-registry';
import { homeHaptic } from '../lib/haptics';
import { setGlassNavMinimized } from '../lib/native-glass';
import { GlassButton } from '../lib/glass-buttons';
import { HomeHighlights } from './HomeHighlights';
import type { HomeAction, HomeHighlight } from '../lib/home-highlights';
import './HomeExperience.css';
import './HomeFeed.css';

type Action = HomeAction;
interface Props {
  active: boolean;
  name?: string;
  city: string;
  highlights: HomeHighlight[];
  onHighlightLink: (href: string) => void;
  onHighlightSeen?: (item: HomeHighlight) => void;
  onHighlightOpen?: (item: HomeHighlight) => void;
  onLocation: () => void;
  onSearch: () => void;
  onAction: (action: Action) => void;
  header: React.ReactNode;
  feed: React.ReactNode;
  feedFilters?: React.ReactNode;
  onPageChange?: (page: 'home' | 'feed') => void;
}
const actions = [
  { id: 'rate', title: 'Rate a place', detail: 'Remember every bite', icon: Star, color: 'peach' },
  { id: 'recs', title: 'For you', detail: 'Picked for your taste', icon: Sparkles, color: 'violet' },
  { id: 'chat', title: 'Ask AI', detail: 'A little help deciding', icon: MessageCircle, color: 'blue' },
  { id: 'recipes', title: 'Make something', detail: 'Your kitchen, inspired', icon: ChefHat, color: 'green' },
] as const;

export const HomeExperience: React.FC<Props> = ({ active, name, city, highlights, onHighlightLink, onHighlightSeen, onHighlightOpen, onLocation, onSearch, onAction, header, feed, feedFilters, onPageChange }) => {
  const [page, setPage] = useState<'home' | 'feed'>('home');
  const [feedCollapsed, setFeedCollapsed] = useState(false);
  const pageChangeRef = useRef(onPageChange);
  pageChangeRef.current = onPageChange;
  useLayoutEffect(() => { pageChangeRef.current?.(page); }, [page]);
  const [feedVisited, setFeedVisited] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const feedScroll = useRef<HTMLDivElement>(null);
  const homeScroll = useRef<HTMLElement>(null);
  const exploreButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLDivElement>(null);
  const groupButton = useRef<HTMLButtonElement>(null);
  const lockedUntil = useRef(0);
  const focusAfterTransition = useRef(false);
  const reduced = useReducedMotion();

  const go = useCallback((destination: HomeDestination, focus = false) => {
    if (!active || isOverlayOpen() || performance.now() < lockedUntil.current) return;
    lockedUntil.current = performance.now() + 650;
    homeHaptic();
    if (destination === 'search') { onSearch(); return; }
    if (destination === 'feed') setFeedVisited(true);
    if (destination === 'home') setGlassNavMinimized(false);
    focusAfterTransition.current = focus;
    // Move focus outside the outgoing inert panel before hiding it.
    if (root.current?.contains(document.activeElement)) root.current.focus({ preventScroll: true });
    setPage(destination);
  }, [active, onSearch]);


  useEffect(() => {
    const node = root.current;
    if (!node || !active) return;
    let start: { x: number; y: number; scroll: number } | null = null;
    let dx = 0, dy = 0, wheel = 0, wheelTime = 0;
    const scrollTop = () => page === 'feed' ? feedScroll.current?.scrollTop ?? 0 : homeScroll.current?.scrollTop ?? 0;
    const nestedScroller = (target: EventTarget | null) => {
      let el = target instanceof Element ? target : null;
      const ceiling = page === 'feed' ? feedScroll.current : homeScroll.current;
      while (el && el !== ceiling && el !== node) {
        if (el.matches('input, textarea, select, video, [role="slider"], dialog')) return true;
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return true;
        // Horizontal photo rails still yield VERTICAL swipes to Home.
        // Direction locking in move() preserves their sideways scrolling.
        el = el.parentElement;
      }
      return false;
    };
    const cancel = () => { start = null; node.removeEventListener('touchmove', move); };
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isOverlayOpen() || nestedScroller(event.target)) return;
      if (scrollTop() > 2) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY, scroll: scrollTop() };
      dx = dy = 0;
      node.addEventListener('touchmove', move, { passive: false });
    };
    function move(event: TouchEvent) {
      if (!start || event.touches.length !== 1 || isOverlayOpen()) { cancel(); return; }
      dx = event.touches[0].clientX - start.x;
      dy = event.touches[0].clientY - start.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { cancel(); return; }
      // An overflowing Home still accepts a pull DOWN at its top. Upward
      // gestures belong to ordinary scrolling until the content fits.
      if (page === 'home' && dy < -6 && homeScroll.current && homeScroll.current.scrollHeight > homeScroll.current.clientHeight + 2) { cancel(); return; }
      if (page === 'feed' && dy < -6) { cancel(); return; }
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) && event.cancelable) event.preventDefault();
    }
    const end = () => {
      if (start) {
        const destination = homeSwipeDestination(page, dx, dy, start.scroll);
        if (destination) go(destination);
      }
      cancel();
    };
    const onWheel = (event: WheelEvent) => {
      if (isOverlayOpen() || nestedScroller(event.target) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (page === 'feed' && (scrollTop() > 2 || event.deltaY >= 0)) return;
      if (page === 'home' && (scrollTop() > 2 || (event.deltaY >= 0 && homeScroll.current && homeScroll.current.scrollHeight > homeScroll.current.clientHeight + 2))) return;
      if (event.cancelable) event.preventDefault();
      if (performance.now() < lockedUntil.current) { wheel = 0; return; }
      const now = performance.now();
      if (now - wheelTime > 180 || Math.sign(wheel) !== Math.sign(event.deltaY)) wheel = 0;
      wheelTime = now;
      wheel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      if (Math.abs(wheel) > 75) { go(page === 'feed' ? 'home' : wheel > 0 ? 'feed' : 'search'); wheel = 0; }
    };
    node.addEventListener('touchstart', begin, { passive: true });
    node.addEventListener('touchend', end, { passive: true });
    node.addEventListener('touchcancel', cancel, { passive: true });
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancel();
      node.removeEventListener('touchstart', begin);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', cancel);
      node.removeEventListener('wheel', onWheel);
    };
  }, [active, page, go]);

  const act = (id: Action) => { homeHaptic(); onAction(id); };
  return <div ref={root} tabIndex={-1} className="home-experience" data-page={page}>
    <motion.div className="home-track" initial={false} animate={{ y: page === 'feed' ? '-100%' : '0%' }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 185, damping: 29, mass: 1 }}
      onAnimationComplete={() => {
        if (focusAfterTransition.current) {
          const target = page === 'feed' ? backButton.current?.querySelector('button') : exploreButton.current;
          target?.focus({ preventScroll: true });
          focusAfterTransition.current = false;
        }
      }}>
      <section ref={homeScroll} className="home-launch" aria-label="Home" aria-hidden={page !== 'home' || !active} inert={page !== 'home' || !active}>
        <div className="home-chrome">{header}</div>
        <div className="home-launch-content">
          <div className="home-welcome">
            <div className="home-eyebrow">{name ? `GOOD TO SEE YOU, ${name}` : 'A LITTLE GOOD TASTE'} </div>
            <h1>What sounds good?</h1>
            <button className="home-location" onClick={onLocation} aria-label={`Change dining location: ${city}`}><span className="home-location-pin"><MapPin size={15} /></span><span>{city}</span><ChevronDown size={14} /></button>
          </div>
          <button className="home-search" onClick={() => go('search', true)}><Search size={18} /><span>A place, a craving, a little inspiration</span><span className="home-search-hint">Pull down</span></button>
          <HomeHighlights onSeen={onHighlightSeen} items={highlights} active={active && page === 'home'} onOpen={item => { onHighlightOpen?.(item); if (item.href) onHighlightLink(item.href); else if (item.action) onAction(item.action); }} />
          <div className="home-actions">
            {actions.map(({ id, title, detail, icon: Icon, color }) => <motion.button key={id} whileTap={reduced ? undefined : { scale: .96 }} className={`home-action home-action-${color}`} onClick={() => act(id)}>
              <div className="home-action-top"><span className="home-action-icon"><Icon size={21} strokeWidth={1.7} /></span><ArrowUpRight size={15} /></div>
              <div className="home-action-copy"><h2>{title}</h2><p>{detail}</p></div>
            </motion.button>)}
            <motion.button ref={groupButton} whileTap={reduced ? undefined : { scale: .98 }} className="home-group" onClick={() => act('group')}>
              <div className="home-group-icon"><Users size={24} strokeWidth={1.6} /><span /></div>
              <div><div className="home-group-title"><h2>Decide together</h2><span>LIVE</span></div><p>Find a place everyone’s into.</p></div>
              <ArrowUpRight size={17} />
            </motion.button>
          </div>
          <button ref={exploreButton} className="home-explore" onClick={() => go('feed', true)}><span><strong>Explore the feed</strong><small>Fresh finds from your circle</small></span><span className="home-explore-arrow"><ArrowDown size={21} /></span></button>

        </div>
      </section>
      <section className="home-feed-page" aria-label="Explore feed" aria-hidden={page !== 'feed' || !active} inert={page !== 'feed' || !active}>
        <header className={`home-feed-header ${feedCollapsed ? 'is-collapsed' : ''}`}>
          <div ref={backButton}><GlassButton id="feed-home" symbol="arrow.up" title="Home" label="Back to Home" className="home-feed-back" onClick={() => go('home', true)}><ArrowUp size={18} /><span>Home</span></GlassButton></div>
          <GlassButton id="feed-search" symbol="magnifyingglass" label="Search" className="home-glass-button" onClick={() => go('search', true)}><Search size={20} /></GlassButton>
        </header>
        <div ref={feedScroll} className="home-feed-scroll" onScroll={e => setFeedCollapsed(e.currentTarget.scrollTop > 72)}>
          <div className="home-feed-content">
            {feedFilters}
            {feedVisited && feed}
          </div>
        </div>
      </section>
    </motion.div>

  </div>;
}
