import React from 'react';
import { motion } from 'motion/react';
import { ChevronDown, Menu, Plus, Search, Sparkles, Users, ArrowUpRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { GlassButton, useGlassSegments } from '../lib/glass-buttons';
import { homeHaptic } from '../lib/haptics';
import './LibraryDesign.css';
import { useSettings } from '../contexts/SettingsContext';

/**
 * The Lists page's phone chrome — one header for every list on the page.
 *
 * The page used to open on a grid of cards you tapped through to reach a
 * list. Now it opens on the list itself, which means the navigation has to
 * live somewhere permanent: this is it. Two rows — which kind of list (the
 * segment), and which list (the title, which opens the drawer, with For
 * you and the drawer chevron alongside it). Everything below this is the
 * list's own filter bar, unchanged from before this component existed.
 *
 * Presentational only. Every destination is a callback so Pantry keeps
 * owning the state machine that decides what renders below.
 */

export type PantrySection = 'restaurants' | 'recipes';

interface Props {
  activeSection: PantrySection;
  onSelectRestaurants: () => void;
  onSelectRecipes: () => void;

  viewLabel: { name: string; count: number };
  drawerOpen: boolean;
  onOpenDrawer: () => void;

  /** Restaurants tab only — "For you", the ranked recommendations page. */
  onOpenRecommendations?: () => void;
  onDecideTogether?: () => void;
  /** Recipes tab only — "Ideas", the AI brainstorm ("what should I cook
   *  tonight?"). The two props are the same pill in the same slot, one
   *  per section; passing both would render both, so hosts pass exactly
   *  one. */
  onOpenIdeas?: () => void;

  searchOpen: boolean;
  onToggleSearch: () => void;

  addAction: { label: string; onClick: () => void } | null;
  /** Rendered to the right of Add — the page's ⋯ menu, already built by the host. */
  moreMenu?: React.ReactNode;

  /** Scroll-fade wiring from the host's useHeaderFade instance. */
  headerRef: React.Ref<HTMLDivElement>;
  headerStyle: React.CSSProperties;
  condensedStyle: React.CSSProperties;
}

export const PantryPhoneHeader: React.FC<Props> = ({
  activeSection,
  onSelectRestaurants,
  onSelectRecipes,
  viewLabel,
  drawerOpen,
  onOpenDrawer,
  onOpenRecommendations,
  onDecideTogether,
  onOpenIdeas,
  searchOpen,
  onToggleSearch,
  addAction,
  moreMenu,
  headerRef,
  headerStyle,
  condensedStyle,
}) => {
  const { darkMode } = useSettings();

  // Native Liquid Glass over the segment when the material exists; this
  // markup becomes the invisible layout plus the fallback everywhere else.
  // Same contract PhonePantryHome used before this replaced it.
  const segItems = (['restaurants', 'recipes'] as PantrySection[]).map((t) => ({
    id: t,
    symbol: '',
    title: t === 'restaurants' ? 'Restaurants' : 'Recipes',
    label: t === 'restaurants' ? 'Restaurants' : 'Recipes',
    tint: 'label' as const,
    active: activeSection === t,
    onClick: t === 'restaurants' ? onSelectRestaurants : onSelectRecipes,
  }));
  const seg = useGlassSegments({ id: 'pantry-tabs', items: segItems });

  return (
    <>
      {/* Condensed cluster — takes over once the full header scrolls away.
          Zero-height sticky rail so it floats over the list rather than
          reserving a row, the same hand-off Discover and Profile use. */}
      <div className="sticky top-0 z-30 h-0 -mx-3">
        <motion.div
          style={condensedStyle}
          className="absolute inset-x-0 top-0 flex items-center gap-2.5 px-5 pt-safe-2 pb-2"
        >
          <GlassButton
            id="pantry-mini-lists"
            symbol="line.3.horizontal"
            label="Your lists"
            onClick={onOpenDrawer}
            className="hit-44 flex-none w-11 h-11 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
          >
            <Menu size={17} strokeWidth={2.1} />
          </GlassButton>
          <div className="flex-1" />
          <GlassButton
            id="pantry-mini-search"
            symbol="magnifyingglass"
            label="Search this list"
            onClick={onToggleSearch}
            className="hit-44 flex-none w-11 h-11 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
          >
            <Search size={17} />
          </GlassButton>
          {addAction && (
            // A plain button, not GlassButton: `.glass-control`'s fallback
            // background wins over `bg-primary`, which would leave a white
            // plus on white glass everywhere the native material is absent.
            <button
              type="button"
              onClick={addAction.onClick}
              aria-label={addAction.label}
              className="hit-44 flex-none w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-[0_2px_10px_-2px_rgba(159,48,18,0.5)] active:scale-95 transition-transform"
            >
              <Plus size={17} strokeWidth={2.4} />
            </button>
          )}
        </motion.div>
      </div>

      <motion.div ref={headerRef} style={headerStyle} className="library-header">
        {/* Row 1 — which kind of list, and the actions that apply to it. */}
        <div className="library-topbar pt-safe-3 flex items-center gap-2">
          <div
            ref={seg.ref}
            data-tour="pantry-tabs"
            className={cn(
              'library-tabs relative inline-flex items-center gap-0.5 rounded-full p-[3px]',
              !seg.active && 'glass-control',
            )}
          >
            {(['restaurants', 'recipes'] as PantrySection[]).map((t) => {
              const active = activeSection === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={t === 'restaurants' ? onSelectRestaurants : onSelectRecipes}
                  aria-pressed={active}
                  aria-hidden={seg.active || undefined}
                  tabIndex={seg.active ? -1 : undefined}
                  className={cn(
                    // The box is the room reserved for the native control,
                    // so its height is the control's, not the text's.
                    'inline-flex items-center gap-1.5 h-[38px] pl-2.5 pr-3 rounded-full text-[13px] font-bold transition-colors',
                    seg.active ? 'opacity-0'
                      : active
                        ? 'bg-primary text-on-primary shadow-[0_2px_8px_-2px_rgba(159,48,18,0.55)]'
                        : darkMode
                          ? 'text-white/55 active:text-white/80'
                          : 'text-on-surface/50 active:text-on-surface/80',
                  )}
                >
                  {t === 'restaurants' ? 'Restaurants' : 'Recipes'}
                </button>
              );
            })}
          </div>

          <GlassButton
            id="pantry-search-toggle"
            symbol="magnifyingglass"
            label="Search this list"
            onClick={onToggleSearch}
            className={cn(
              'hit-44 flex-none w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform',
              searchOpen ? 'text-primary bg-primary/10' : 'text-on-surface',
            )}
          >
            <Search size={17} />
          </GlassButton>
          {addAction && (
            <button
              type="button"
              onClick={addAction.onClick}
              aria-label={addAction.label}
              className="hit-44 flex-none w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-[0_2px_10px_-2px_rgba(159,48,18,0.5)] active:scale-95 transition-transform"
            >
              <Plus size={17} strokeWidth={2.4} />
            </button>
          )}
          {moreMenu}
        </div>

        <div className="library-title-row">
          <button type="button" className="library-title" onClick={() => { homeHaptic(); onOpenDrawer(); }} aria-label={`Choose a list. Current: ${viewLabel.name}`} aria-expanded={drawerOpen}>
            <h1>{viewLabel.name === 'All Recipes' ? 'Your cookbook' : viewLabel.name}</h1>
            <ChevronDown size={18} className={drawerOpen ? 'rotate-180' : ''} />
          </button>
          <span className="library-count">{viewLabel.count} {activeSection === 'recipes' ? (viewLabel.count === 1 ? 'recipe' : 'recipes') : (viewLabel.count === 1 ? 'place' : 'places')}</span>
        </div>
        <div className="library-discovery" aria-label="Discover">
          {onOpenRecommendations && <button onClick={() => { homeHaptic(); onOpenRecommendations(); }}><Sparkles size={16} /><span>For you</span><ArrowUpRight size={14} /></button>}
          {onOpenIdeas && <button onClick={() => { homeHaptic(); onOpenIdeas(); }}><Sparkles size={16} /><span>Recipe ideas</span><ArrowUpRight size={14} /></button>}
          {onDecideTogether && <button onClick={() => { homeHaptic(); onDecideTogether(); }}><Users size={16} /><span>Decide together</span><ArrowUpRight size={14} /></button>}
        </div>
      </motion.div>
    </>
  );
};
