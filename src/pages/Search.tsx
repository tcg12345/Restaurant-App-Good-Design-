import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map as MapIcon, ChevronRight, ChevronLeft, X, Search as SearchIcon } from 'lucide-react';
import { FollowingFeed } from '../components/FollowingFeed';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useGlassSegments, useGlassButtonsActive, GlassButton } from '../lib/glass-buttons';
import { SearchMain } from './SearchMain';
import { Discover } from './Discover';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';
import { SearchField } from '../components/SearchField';
import { setSearchTakeoverOpen } from '../lib/search-takeover';

type SearchTab = 'discover' | 'following';

const TABS: ReadonlyArray<readonly [SearchTab, string]> = [
  ['discover', 'Discover'],
  ['following', 'Following'],
];

/* ── The map is the search page ──────────────────────────────────────────
   Search used to be an empty screen: a field, and one row that navigated to
   the map as if it were a side feature. Now the Discover tab IS the map —
   the same engine the /map page runs (pins, the tri-snap results sheet, the
   filter sheet), worn as a tab root. The chrome floats on the map in glass:
   the Discover/Following pill up top, the native-glass search field under
   it, the filter chips under that. Tapping the field lifts a full-screen
   search takeover over the map — recents, live results — and submitting
   hands the query BACK to the map, which is the part that makes search and
   map one page rather than two.

   Following stays exactly what it was: the feed, now simply layered over
   the (hidden) map with the same pill switching between them. */

const PhoneSearch: React.FC = () => {
  const [tab, setTab] = useState<SearchTab>('discover');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const mapSearchRef = useRef<((q: string) => void) | null>(null);
  const glassActive = useGlassButtonsActive();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reduceMotion = useReducedMotion();

  // Full screen while searching: the tab bar hides (BottomNav reads this
  // signal directly — a reason ORed at the read site, so other writers of
  // the shared hide flag can't stomp it) and the assistant FAB, hidden on
  // the map, steps in — the one part of this page with room for it.
  useEffect(() => {
    setSearchTakeoverOpen(searching);
    return () => setSearchTakeoverOpen(false);
  }, [searching]);

  const openSearch = () => {
    setSearching(true);
    // The native glass field raises its own keyboard (autoFocus through the
    // registry); the web fallback needs the nudge.
    if (!glassActive) requestAnimationFrame(() => inputRef.current?.focus());
  };
  // Closing with an empty draft is the clear: the map drops its query and
  // restores the pre-search places.
  const closeSearch = () => {
    if (!query.trim()) mapSearchRef.current?.('');
    setSearching(false);
  };
  const submitToMap = () => {
    if (!query.trim()) return;
    mapSearchRef.current?.(query);
    setSearching(false);
  };

  const seg = useGlassSegments({
    id: 'search-tabs',
    items: TABS.map(([key, label]) => ({
      id: key,
      symbol: '',
      title: label,
      label,
      tint: 'label' as const,
      active: tab === key,
      onClick: () => setTab(key),
    })),
  });

  // The pill rides above the sheet now — at full it sits on the risen page
  // the way the reference's chrome does — so only the takeover hides it.
  const pillHidden = searching;

  return (
    <div className="relative bg-surface overflow-hidden" style={{ height: '100dvh' }}>
      {/* The map experience. Stays mounted behind Following — a Mapbox
          instance is too expensive to rebuild per pill flick — and hides
          with visibility, which also stands its native glass down. */}
      <div className={cn('absolute inset-0', tab !== 'discover' && 'invisible')} aria-hidden={tab !== 'discover' || undefined}>
        <Discover
          mode="map"
          variant="searchTab"
          onOpenSearch={openSearch}
          searchHandlerRef={mapSearchRef}
          dimChrome={searching}
        />
      </div>

      {/* Following — the same feed it always was, layered over the map. */}
      {tab === 'following' && (
        <div
          className="absolute inset-0 z-20 bg-surface overflow-y-auto no-scrollbar"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 66px)' }}
        >
          <div className="px-4 pb-32">
            <FollowingFeed />
          </div>
        </div>
      )}

      {/* Discover | Following — the one piece of chrome both tabs share.
          Above the sheet like the rest of the chrome, so the risen page
          carries it; only the takeover hides it. */}
      <div
        className="absolute inset-x-0 z-50 flex justify-center transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{
          top: 'calc(env(safe-area-inset-top) + 10px)',
          opacity: pillHidden ? 0 : 1,
          transform: pillHidden ? 'translateY(-14px)' : 'none',
          pointerEvents: pillHidden ? 'none' : 'auto',
        }}
        aria-hidden={pillHidden || undefined}
      >
        <div
          ref={seg.ref}
          className={cn(
            'relative inline-flex items-center gap-0.5 rounded-full p-[3px]',
            !seg.active && 'glass-control',
          )}
        >
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              aria-hidden={seg.active || undefined}
              tabIndex={seg.active ? -1 : undefined}
              className={cn(
                'inline-flex items-center justify-center h-[44px] px-4 rounded-full text-[13.5px] font-bold transition-colors',
                seg.active ? 'opacity-0'
                  : tab === key
                    ? 'bg-primary text-white shadow-[0_2px_8px_-2px_rgba(159,48,18,0.55)]'
                    : 'text-on-surface/50 active:text-on-surface/80',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── The search takeover ─────────────────────────────────────────
          Everything rises together off the map — a glass wash, the close
          circle and Search pill, the editable native-glass field with the
          keyboard already coming up — rather than the page being torn down
          and rebuilt. Submitting hands the query to the map underneath. */}
      <AnimatePresence>
        {searching && (
          <motion.div
            key="takeover"
            className="fixed inset-0 z-[70] flex flex-col"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 22 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="absolute inset-0 bg-surface/[0.93] backdrop-blur-2xl" aria-hidden />
            <div
              className="relative flex-none flex items-center justify-between gap-3 px-4"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
            >
              <GlassButton
                id="search-close"
                symbol="xmark"
                label="Close search"
                onClick={closeSearch}
                className="hit-44 w-10 h-10 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
              >
                <X size={18} />
              </GlassButton>
              <GlassButton
                id="search-go"
                symbol="magnifyingglass"
                title="Search"
                titleStyle="chip"
                label="Search the map"
                disabled={!query.trim()}
                onClick={submitToMap}
                className="h-10 px-4 rounded-full flex items-center gap-1.5 text-[13px] font-bold text-on-surface disabled:opacity-40"
              >
                <SearchIcon size={14} strokeWidth={2.4} />
                Search
              </GlassButton>
            </div>
            <div className="relative flex-none px-4 pt-3">
              <SearchField
                glassId="takeover-search"
                value={query}
                onChange={setQuery}
                onSubmit={submitToMap}
                autoFocus
                inputRef={inputRef}
                placeholder="Restaurants, cuisines, lists"
                aria-label="Search"
              />
            </div>
            <div className="relative flex-1 overflow-y-auto no-scrollbar px-4 pt-2 pb-10">
              <SearchMain embedded query={query} onQueryChange={setQuery} inputRef={glassActive ? undefined : inputRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ── Desktop keeps the panel layout ──────────────────────────────────────
   The map-first experience is a phone posture; on a wide viewport the old
   page — field, map entry, embedded results — still fits the shape of the
   screen better than a full-bleed map behind floating chips would. */
const ClassicSearch: React.FC = () => {
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const { setHideBottomNav } = useSettings();
  useEffect(() => {
    setHideBottomNav(searching);
    return () => setHideBottomNav(false);
  }, [searching, setHideBottomNav]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const glassActive = useGlassButtonsActive();
  const openSearch = () => {
    setSearching(true);
    if (!glassActive) requestAnimationFrame(() => inputRef.current?.focus());
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    if (!glassActive) inputRef.current?.blur();
  };
  const [tab, setTab] = useState<SearchTab>('discover');
  const reduceMotion = useReducedMotion();
  const direction = tab === 'discover' ? -1 : 1;

  const seg = useGlassSegments({
    id: 'search-tabs',
    items: TABS.map(([key, label]) => ({
      id: key,
      symbol: '',
      title: label,
      label,
      tint: 'label' as const,
      active: tab === key,
      onClick: () => setTab(key),
    })),
  });

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <div className="pt-safe-3" />
      <div
        className="px-4 flex justify-center overflow-hidden transition-[max-height,opacity,margin] duration-[400ms] ease-[var(--ease-drawer)]"
        style={{ maxHeight: searching ? 0 : 60, opacity: searching ? 0 : 1, marginBottom: searching ? 0 : 0 }}
        aria-hidden={searching}
      >
        <div
          ref={seg.ref}
          className={cn(
            'relative inline-flex items-center gap-0.5 rounded-full p-[3px]',
            !seg.active && 'glass-control',
          )}
        >
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              aria-hidden={seg.active || undefined}
              tabIndex={seg.active ? -1 : undefined}
              className={cn(
                'inline-flex items-center justify-center h-[44px] px-4 rounded-full text-[13.5px] font-bold transition-colors',
                seg.active ? 'opacity-0'
                  : tab === key
                    ? 'bg-primary text-white shadow-[0_2px_8px_-2px_rgba(159,48,18,0.55)]'
                    : 'text-on-surface/50 active:text-on-surface/80',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <main className={cn('px-4', searching ? 'pt-1' : 'pt-4')}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: reduceMotion ? 0 : direction * 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
        {tab === 'discover' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="overflow-hidden transition-[width,opacity] duration-300 ease-[var(--ease-drawer)]"
                style={{ width: searching ? 40 : 0, opacity: searching ? 1 : 0 }}
                aria-hidden={!searching}
              >
                <GlassButton
                  id="search-back"
                  symbol="chevron.left"
                  label="Back"
                  onClick={closeSearch}
                  className="hit-44 w-10 h-10 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
                >
                  <ChevronLeft size={20} />
                </GlassButton>
              </div>
              <SearchField
                className="flex-1 min-w-0"
                glassId="search-field"
                readOnly={!searching}
                onPress={searching ? undefined : openSearch}
                value={query}
                onChange={setQuery}
                inputRef={inputRef}
                placeholder="Restaurants, cuisines, lists"
                aria-label="Search"
              />
            </div>

            <motion.div
              key={searching ? 'results' : 'browse'}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            >
            {searching ? (
              <SearchMain embedded query={query} onQueryChange={setQuery} inputRef={glassActive ? undefined : inputRef} />
            ) : (
            <>
            <button
              type="button"
              onClick={() => navigate('/map')}
              className="group w-full flex items-center gap-3 rounded-2xl border border-on-surface/[0.08] bg-white px-4 py-3.5 text-left transition-all hover:border-on-surface/15 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.16)] active:scale-[0.99]"
            >
              <span className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <MapIcon size={22} strokeWidth={2.2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold text-on-surface leading-tight">Explore on map</span>
                <span className="block text-[12px] text-on-surface/55 mt-0.5">Discover restaurants near you</span>
              </span>
              <ChevronRight size={18} className="flex-shrink-0 text-on-surface/30 group-hover:text-on-surface/55 transition-colors" />
            </button>
            </>
            )}
            </motion.div>
          </div>
        ) : (
          <FollowingFeed />
        )}
        </motion.div>
      </main>
    </div>
  );
};

export const Search: React.FC = () => {
  const { phoneMode } = useSettings();
  return phoneMode ? <PhoneSearch /> : <ClassicSearch />;
};
