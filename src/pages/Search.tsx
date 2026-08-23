import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map as MapIcon, ChevronRight, ChevronLeft } from 'lucide-react';
import { FollowingFeed } from '../components/FollowingFeed';
import { motion, useReducedMotion } from 'motion/react';
import { useGlassSegments, GlassButton } from '../lib/glass-buttons';
import { SearchMain } from './SearchMain';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';
import { SearchField } from '../components/SearchField';

type SearchTab = 'discover' | 'following';

const TABS: ReadonlyArray<readonly [SearchTab, string]> = [
  ['discover', 'Discover'],
  ['following', 'Following'],
];

export const Search: React.FC = () => {
  const navigate = useNavigate();

  /* ── Searching happens HERE ────────────────────────────────────────
     It used to be a route: tapping the field pushed /search/main, which
     tore this page down and built another one whose field happened to
     look similar. Every trick for smoothing that over — a shared-element
     morph, a FLIP from the old rect — is an attempt to disguise a
     teardown, and it reads as one however well it is tuned.

     So nothing is torn down. The field below is a single element that is
     read-only until you tap it and editable afterwards; it never
     unmounts, never moves, and never animates, because it never has
     anywhere to go. What changes is what sits under it. */
  const [searching, setSearching] = useState(false);
  // Full screen while searching: the tab bar underneath is a way OUT of
  // the thing you just opened, and OpenTable's — the reference here —
  // hides it for exactly that reason.
  const { setHideBottomNav } = useSettings();
  useEffect(() => {
    setHideBottomNav(searching);
    return () => setHideBottomNav(false);
  }, [searching, setHideBottomNav]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openSearch = () => {
    setSearching(true);
    // After the field stops being read-only, so the caret lands in a field
    // that will accept it.
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    inputRef.current?.blur();
  };
  const [tab, setTab] = useState<SearchTab>('discover');
  const reduceMotion = useReducedMotion();
  // Which way the lens just travelled, so the incoming panel enters from the
  // side it came from. The selector's lens slides; the content under it used
  // to hard-cut, which read as two unrelated things happening at once.
  const direction = tab === 'discover' ? -1 : 1;

  // The same segmented glass the Lists page wears: on iOS 26 the native side
  // draws a real tab bar over this box, lens and all, and this markup becomes
  // the layout it is measured from plus the fallback everywhere else.
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

      {/* Tab switcher — centred, because the control is a capsule now rather
          than a pair of underlined words hugging the left margin. */}
      {/* The safe-area inset lives on the page, not on the pill — collapsing
          the pill used to take the top padding with it and jam the field
          under the status bar. */}
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
                // The box is the room the page reserves for the native
                // control, so its height is the control's, not the text's.
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
        {/* Keyed on the tab, so switching mounts a fresh panel that fades in
            over the outgoing one's place. No exit animation on purpose: a tab
            is a high-frequency control, and waiting for an exit before the
            entrance doubles the time you feel before the new content is
            there. */}
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: reduceMotion ? 0 : direction * 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
        {tab === 'discover' ? (
          <div className="space-y-3">
            {/* One field, two states. Back slides in beside it when search
                opens; the field itself does not move, because a control
                that stays put cannot glitch on the way anywhere. */}
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
                readOnly={!searching}
                onPress={searching ? undefined : openSearch}
                value={query}
                onChange={setQuery}
                inputRef={inputRef}
                placeholder="Restaurants, cuisines, lists"
                aria-label="Search"
              />
            </div>

            {searching ? (
              <SearchMain embedded query={query} onQueryChange={setQuery} inputRef={inputRef} />
            ) : (
            <>
            {/* Prominent map entry — replaces the old navbar split. */}
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
          </div>
        ) : (
          <FollowingFeed />
        )}
        </motion.div>
      </main>
    </div>
  );
};
