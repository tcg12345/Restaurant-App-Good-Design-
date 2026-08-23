import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Map as MapIcon, ChevronRight } from 'lucide-react';
import { FollowingFeed } from '../components/FollowingFeed';
import { motion, useReducedMotion } from 'motion/react';
import { useGlassSegments, GlassButton } from '../lib/glass-buttons';
import { cn } from '../lib/utils';
import { SearchField } from '../components/SearchField';

type SearchTab = 'discover' | 'following';

const TABS: ReadonlyArray<readonly [SearchTab, string]> = [
  ['discover', 'Discover'],
  ['following', 'Following'],
];

export const Search: React.FC = () => {
  const navigate = useNavigate();
  // Where the field is on THIS page, handed to the search page so it can
  // start from exactly here. Without it the search page's own field snaps
  // into place and the move reads as a page swap; with it the same object
  // slides from one position to the other and the rest resolves around it.
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const openSearch = () => {
    const r = fieldRef.current?.getBoundingClientRect();
    navigate('/search/main', {
      state: r ? { from: { x: r.left, y: r.top, w: r.width, h: r.height } } : undefined,
    });
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
      <div className="px-4 pt-safe-3 flex justify-center">
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

      <main className="px-4 pt-4">
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
            {/* Real input that transitions into the full search page on focus.
                readOnly keeps the mobile keyboard from flashing before the
                route change; the auto-focus on SearchMain brings it up there. */}
            {/* Real glass, not a CSS approximation of it: the native side
                already knows how to draw a capsule with a glyph and a word
                (the recipe flow's back chip), it only needed to be told
                that this one is a field rather than a chip. The children
                are what a browser — or an iOS older than 26 — falls back
                to, and they are the same material and metrics, so the two
                paths agree.

                Tapping it hands the field's own rect to the search page,
                which starts from exactly there. */}
            <div ref={fieldRef}>
            <GlassButton
              id="search-open"
              symbol="magnifyingglass"
              title="Restaurants, cuisines, lists"
              titleStyle="field"
              label="Search"
              onClick={openSearch}
              className="block w-full"
            >
              <SearchField
                readOnly
                value=""
                onChange={() => {}}
                placeholder="Restaurants, cuisines, lists"
                aria-label="Search"
              />
            </GlassButton>
            </div>

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

          </div>
        ) : (
          <FollowingFeed />
        )}
        </motion.div>
      </main>
    </div>
  );
};
