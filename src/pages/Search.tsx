import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map as MapIcon, ChevronRight, ChevronLeft, X, MapPin, Navigation, Loader2 } from 'lucide-react';
import { MAPBOX_TOKEN } from '../lib/keys';
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
  /* ── Where the search is anchored ─────────────────────────────────────
     The takeover's top-right chip names the place being searched and
     changes it. The map owns the truth (its reference location); this
     page reads a label through the bridge when the takeover opens, and
     pushes a chosen place — or the device's location — back through it. */
  const locationBridgeRef = useRef<{
    label: string;
    select: (name: string, lat: number, lng: number) => void;
    useCurrent: () => void;
  } | null>(null);
  const [cityLabel, setCityLabel] = useState('Current location');
  const [locOpen, setLocOpen] = useState(false);
  const [locQuery, setLocQuery] = useState('');
  const [locLoading, setLocLoading] = useState(false);
  const [locResults, setLocResults] = useState<Array<{ id: string; name: string; lat: number; lng: number }>>([]);

  // Debounced Mapbox geocode for the chip's panel — the same request the
  // map page's own location search makes.
  useEffect(() => {
    if (!locOpen || !locQuery.trim()) { setLocResults([]); setLocLoading(false); return; }
    setLocLoading(true);
    const abort = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locQuery)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,neighborhood,address,poi&limit=5`,
          { signal: abort.signal },
        );
        const data = await res.json();
        if (abort.signal.aborted) return;
        setLocResults((data.features || []).map((f: { id: string; place_name: string; center: [number, number] }) => ({
          id: f.id, name: f.place_name, lat: f.center[1], lng: f.center[0],
        })));
        setLocLoading(false);
      } catch {
        if (!abort.signal.aborted) { setLocResults([]); setLocLoading(false); }
      }
    }, 300);
    return () => { clearTimeout(t); abort.abort(); };
  }, [locOpen, locQuery]);
  const glassActive = useGlassButtonsActive();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const locInputRef = useRef<HTMLInputElement | null>(null);
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
    setCityLabel(locationBridgeRef.current?.label || 'Current location');
    // The native glass field raises its own keyboard (autoFocus through the
    // registry); the web fallback needs the nudge.
    if (!glassActive) requestAnimationFrame(() => inputRef.current?.focus());
  };
  // Closing with an empty draft is the clear: the map drops its query and
  // restores the pre-search places.
  const closeSearch = () => {
    if (!query.trim()) mapSearchRef.current?.('');
    setLocOpen(false);
    setSearching(false);
  };
  const submitToMap = () => {
    if (!query.trim()) return;
    mapSearchRef.current?.(query);
    setLocOpen(false);
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


  return (
    <div className="relative bg-surface overflow-hidden" style={{ height: '100dvh' }}>
      {/* The map experience. Stays mounted behind Following — a Mapbox
          instance is too expensive to rebuild per pill flick — and hides
          with visibility, which also stands its native glass down. */}
      <div className={cn('absolute inset-0', tab !== 'discover' && 'invisible')} aria-hidden={tab !== 'discover' || undefined}>
        <Discover
          mode="map"
          variant="searchTab"
          searchHandlerRef={mapSearchRef}
          dimChrome={searching}
          locationBridgeRef={locationBridgeRef}
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

      {/* ── The chrome the page itself owns ──────────────────────────────
          One search field, mounted once, never moved: the open transition
          used to swap the map's field for a takeover's field and the cut
          between two pieces of native glass read as a glitch. Now the
          field is the constant. Opening search crossfades the strip above
          it — the tab pill gives way to the close button and the location
          chip IN PLACE — the chips fade below it, a wash rises over the
          map, and the field just stops being read-only and takes the
          keyboard. Closing plays it all backwards. Nothing jumps, because
          nothing is torn down. */}
      {/* pointer-events-none on the strip itself: a hit-testable full-width
          strip both ate taps aimed at the Search-this-area chip in its empty
          left half AND made the native occlusion check (elementFromPoint at
          the chip's centre) believe the chip was covered — hiding its glass
          entirely. Children opt back in for themselves. */}
      <div className="absolute inset-x-0 z-50 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }}>
        {/* Discover | Following — fades out as search opens. */}
        {/* pointer-events: none on the strip, auto on the pill itself —
            the full-width wrapper otherwise eats taps aimed at the
            Search-this-area chip floating in its empty left half. */}
        <div
          className="flex justify-center pointer-events-none transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            opacity: searching ? 0 : 1,
            transform: searching ? 'translateY(-10px)' : 'none',
          }}
          aria-hidden={searching || undefined}
        >
          <div
            style={{ pointerEvents: searching ? 'none' : 'auto' }}
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

        {/* Close + the location the search is anchored to — the same strip,
            fading in as the pill fades out. */}
        <div
          className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{
            opacity: searching ? 1 : 0,
            transform: searching ? 'none' : 'translateY(10px)',
            pointerEvents: searching ? 'auto' : 'none',
          }}
          aria-hidden={!searching || undefined}
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
          {/* Where the search is anchored. The same construction as the
              main field: ONE glass field that is a chip while read-only —
              compass glyph, city name, hugging the right edge — and
              expands in place into an editable field when tapped, results
              card underneath. No dropdown-on-a-button, no second element;
              the capsule you tapped is the field you type in. */}
          <div
            className={cn(
              'relative min-w-0 flex-1 ml-auto transition-[max-width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
              locOpen ? 'max-w-full' : 'max-w-[200px]',
            )}
          >
            <SearchField
              glassId="location-field"
              glassSymbol="location"
              leadingIcon={<Navigation size={14} strokeWidth={2.2} />}
              readOnly={!locOpen}
              onPress={() => {
                setLocQuery('');
                setLocOpen(true);
                if (!glassActive) requestAnimationFrame(() => locInputRef.current?.focus());
              }}
              value={locOpen ? locQuery : cityLabel}
              onChange={setLocQuery}
              inputRef={locInputRef}
              placeholder="City or neighborhood"
              aria-label={locOpen ? 'Search for a location' : `Searching near ${cityLabel} — change location`}
            />
            {locOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLocOpen(false)} aria-hidden />
                <div className="absolute inset-x-0 top-full mt-2.5 z-20 rounded-2xl bg-paper border border-on-surface/[0.08] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.45)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      locationBridgeRef.current?.useCurrent();
                      setCityLabel('Current location');
                      setLocOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-on-surface/[0.05] transition-colors"
                  >
                    <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                      <Navigation size={14} strokeWidth={2.2} />
                    </span>
                    <span className="text-[14px] font-semibold text-on-surface">Current location</span>
                  </button>
                  {(locLoading || locResults.length > 0) && (
                    <div className="border-t border-on-surface/[0.06] max-h-[290px] overflow-y-auto no-scrollbar">
                      {locLoading && locResults.length === 0 ? (
                        <div className="flex items-center justify-center py-5">
                          <Loader2 size={15} className="text-primary animate-spin" />
                        </div>
                      ) : (
                        locResults.map((r, i) => {
                          const comma = r.name.indexOf(',');
                          const primary = comma > 0 ? r.name.slice(0, comma) : r.name;
                          const secondary = comma > 0 ? r.name.slice(comma + 1).trim() : '';
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                locationBridgeRef.current?.select(r.name, r.lat, r.lng);
                                setCityLabel(primary.trim());
                                setLocOpen(false);
                              }}
                              className={cn(
                                'w-full flex items-center gap-3 px-4 py-3 text-left active:bg-on-surface/[0.05] transition-colors',
                                i > 0 && 'border-t border-on-surface/[0.05]',
                              )}
                            >
                              <span className="w-8 h-8 rounded-full bg-on-surface/[0.05] text-on-surface/45 flex items-center justify-center flex-shrink-0">
                                <MapPin size={14} strokeWidth={2} />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[14px] font-semibold text-on-surface truncate">{primary}</span>
                                {secondary && <span className="block mt-0.5 text-[11.5px] text-on-surface/45 truncate">{secondary}</span>}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* THE field — the one element both states share. */}
      <div
        className={cn(
          'absolute inset-x-0 z-50 px-3.5 transition-opacity duration-200',
          tab !== 'discover' && 'invisible',
          locOpen && 'opacity-0 pointer-events-none',
        )}
        style={{ top: 'calc(env(safe-area-inset-top) + 76px)' }}
        aria-hidden={tab !== 'discover' || locOpen || undefined}
      >
        <SearchField
          glassId="search-field"
          variant="floating"
          tall
          readOnly={!searching}
          onPress={openSearch}
          value={query}
          onChange={setQuery}
          onSubmit={submitToMap}
          inputRef={inputRef}
          placeholder="Restaurants, cuisines, lists"
          aria-label="Search"
        />
      </div>

      {/* The wash — everything the open state needs BELOW the field. */}
      <AnimatePresence>
        {searching && (
          <motion.div
            key="search-wash"
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* Blurred, not painted over. Clear glass draws its definition
                from what is behind it, so a near-opaque wash left every
                capsule on this screen invisible — the field, the close
                button, the location chip all vanished. A heavy blur with
                the ground only partly closed keeps the map present as an
                abstract wash: enough for the glass to refract, still calm
                enough to read results against. */}
            <div className="absolute inset-0 bg-surface/[0.78] backdrop-blur-[40px] backdrop-saturate-150" aria-hidden />
            <motion.div
              className="absolute inset-0 overflow-y-auto no-scrollbar px-4 pb-10"
              style={{ paddingTop: 'calc(env(safe-area-inset-top) + 140px)' }}
              initial={{ y: reduceMotion ? 0 : 16 }}
              animate={{ y: 0 }}
              exit={{ y: reduceMotion ? 0 : 16 }}
              transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
            >
              <SearchMain embedded query={query} onQueryChange={setQuery} inputRef={glassActive ? undefined : inputRef} />
            </motion.div>
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
