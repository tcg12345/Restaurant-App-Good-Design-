import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, MapPin, Search, Star, Sparkles, ChefHat, Users } from 'lucide-react';
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
  nextMeal?: React.ReactNode;
  onHighlightLink: (href: string) => void;
  onHighlightSeen?: (item: HomeHighlight) => void;
  onHighlightOpen?: (item: HomeHighlight) => void;
  onLocation: () => void;
  onSearch: () => void;
  onAction: (action: Action) => void;
  header: React.ReactNode;
  feed: React.ReactNode;
  guides?: React.ReactNode;
  reels?: React.ReactNode;
  feedFilters?: React.ReactNode;
  onPageChange?: (page: 'home' | 'feed') => void;
}
const actions = [
  { id: 'chat', title: 'Ask AI', icon: Sparkles },
  { id: 'recs', title: 'For you', icon: null },
  { id: 'rate', title: 'Rate a place', icon: Star },
  { id: 'group', title: 'Decide together', icon: Users },
  { id: 'recipes', title: 'Cook at home', icon: ChefHat },
] as const;

export const HomeExperience: React.FC<Props> = ({ active, name, city, highlights, nextMeal, onHighlightLink, onHighlightSeen, onHighlightOpen, onLocation, onSearch, onAction, header, feed, guides, reels, feedFilters, onPageChange }) => {
  const [page, setPage] = useState<'home' | 'feed'>('home');
  const [feedCollapsed, setFeedCollapsed] = useState(false);
  const pageChangeRef = useRef(onPageChange);
  pageChangeRef.current = onPageChange;
  useLayoutEffect(() => { pageChangeRef.current?.(page); }, [page]);
  const [feedVisited, setFeedVisited] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const feedScroll = useRef<HTMLDivElement>(null);
  const homeScroll = useRef<HTMLDivElement>(null);
  const exploreButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLDivElement>(null);
  const lockedUntil = useRef(0);
  const wheelGesture = useRef({ lastAt: 0, consumed: false });
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
    let start: { x: number; y: number; scroll: number; max: number } | null = null;
    let dx = 0, dy = 0, wheel = 0, wheelTime = 0;
    const scroller = () => page === 'feed' ? feedScroll.current : homeScroll.current;
    const scrollTop = () => Math.max(0, scroller()?.scrollTop ?? 0);
    const maxScroll = () => page === 'home' && reels ? Math.max(0, (homeScroll.current?.scrollHeight ?? 0) - (homeScroll.current?.clientHeight ?? 0)) : 0;
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
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY, scroll: scrollTop(), max: maxScroll() };
      dx = dy = 0;
      node.addEventListener('touchmove', move, { passive: false });
    };
    function move(event: TouchEvent) {
      if (!start || event.touches.length !== 1 || isOverlayOpen()) { cancel(); return; }
      dx = event.touches[0].clientX - start.x;
      dy = event.touches[0].clientY - start.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { cancel(); return; }
      if (page === 'feed' && dy < -6) { cancel(); return; }
      // Let Home content scroll normally. Once a finger reaches an edge,
      // count only the additional pull toward Search or the feed.
      const atStartEdge = dy > 0 ? start.scroll <= 2 : start.scroll >= start.max - 2;
      if (!atStartEdge) {
        const atEdge = dy > 0 ? scrollTop() <= 2 : scrollTop() >= maxScroll() - 2;
        if (atEdge) {
          start = { x: event.touches[0].clientX, y: event.touches[0].clientY, scroll: scrollTop(), max: maxScroll() };
          dx = dy = 0;
        }
        return;
      }
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) && event.cancelable) event.preventDefault();
    }
    const end = () => {
      if (start) {
        const destination = homeSwipeDestination(page, dx, dy, start.scroll, start.max);
        if (destination) go(destination);
      }
      cancel();
    };
    const onWheel = (event: WheelEvent) => {
      const now = performance.now();
      const gesture = wheelGesture.current;
      if (now - gesture.lastAt > 180) gesture.consumed = false;
      gesture.lastAt = now;
      if (gesture.consumed || event.ctrlKey || isOverlayOpen() || nestedScroller(event.target) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (page === 'feed' && (scrollTop() > 2 || event.deltaY >= 0)) return;
      if (page === 'home' && (event.deltaY < 0 ? scrollTop() > 2 : scrollTop() < maxScroll() - 2)) { wheel = 0; return; }
      if (event.cancelable) event.preventDefault();
      if (performance.now() < lockedUntil.current) { wheel = 0; return; }
      if (now - wheelTime > 180 || Math.sign(wheel) !== Math.sign(event.deltaY)) wheel = 0;
      wheelTime = now;
      wheel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      if (Math.abs(wheel) > 75) { gesture.consumed = true; go(page === 'feed' ? 'home' : wheel > 0 ? 'feed' : 'search'); wheel = 0; }
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
  }, [active, page, go, !!reels]);

  const act = (id: Action) => { homeHaptic(); onAction(id); };
  const explore = <button ref={exploreButton} className="home-explore" onClick={() => go('feed', true)}><strong>Explore feed</strong><span className="home-explore-arrow" aria-hidden="true"><ArrowDown size={16} /></span></button>;
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
      <section className={`home-launch${reels ? " has-reels" : ""}`} aria-label="Home" aria-hidden={page !== 'home' || !active} inert={page !== 'home' || !active}>
        <header className="home-chrome home-topbar">
          {!reels && <button className="home-location" onClick={onLocation} aria-label={`Change dining location: ${city}`}><MapPin size={16} /><span>{city}</span><ChevronDown size={13} /></button>}
          {header}
        </header>
        <div ref={homeScroll} className="home-scroll-viewport" tabIndex={reels ? 0 : undefined} aria-label={reels ? "Home content" : undefined}>
        <div className="home-launch-content">
          <div className="home-welcome">
            {reels ? <div className="home-location-row">
              <button className="home-search-entry" type="button" onClick={() => { homeHaptic(); onSearch(); }} aria-label="Search restaurants, recipes, and people" aria-haspopup="dialog">
                <Search size={18} strokeWidth={1.8} aria-hidden="true" /><span>Search</span>
              </button>
              <button className="home-location" onClick={onLocation} aria-label={`Change dining location: ${city}`}><span className="home-location-pin"><MapPin size={17} /></span><span>{city}</span><ChevronDown size={14} /></button>
            </div> : <p>GoodEats · A little inspiration, every day</p>}
            {!reels && <h1>{name?.trim() ? `What sounds good, ${name.trim()}?` : 'What sounds good?'}</h1>}
          </div>
          <nav className="home-actions" aria-label="Food shortcuts">
            {actions.map(({ id, title, icon: Icon }) => <motion.button key={id} whileTap={reduced ? undefined : { scale: .97 }} className={`home-action${id === 'chat' ? ' is-primary' : ''}`} onClick={() => act(id)}>
              {Icon && <Icon size={16} strokeWidth={1.8} />}<span>{title}</span>
            </motion.button>)}
          </nav>
          {nextMeal ?? <HomeHighlights compact={!!reels} onSeen={onHighlightSeen} items={highlights} active={active && page === 'home'} onOpen={item => { onHighlightOpen?.(item); if (item.href) onHighlightLink(item.href); else if (item.action) onAction(item.action); }} />}
          {reels}
          <div className="home-discovery-row">
            {guides}
          </div>
          {!reels && explore}
          {reels && <div className="home-scroll-end-spacer" aria-hidden="true" />}
        </div>
        </div>
        {reels && <div className="home-explore-dock">{explore}</div>}
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
