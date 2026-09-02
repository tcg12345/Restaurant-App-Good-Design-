import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { GlassButton } from '../lib/glass-buttons';
import { ArrowLeft, Bookmark, CheckCircle, XCircle, Loader2, FileUp, Images, X, AlertTriangle } from 'lucide-react';
import { ScoreBadge } from '../components/ScoreBadge';
import { useLists, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { priceLevelToString } from '../lib/places';
import { loadLastSelectedLocation } from '../components/HomeLocationBar';
import {
  parseImportFile, readCapturesToRows, runRestaurantImport,
  looksLikeFivePointScale, scaleToTen, clampScore,
  MAX_SCREENSHOTS,
  type ParsedRestaurant, type ImportRow,
} from '../lib/restaurant-import';

export const ImportRestaurants: React.FC = () => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  // Mobile top bar dissolves with scroll, Discover-style.
  const headerFade = useHeaderFade({ enabled: phoneMode, windowScroll: true });
  const { ratings, rateRestaurant, cacheRestaurantMeta, addToWishlist, wishlist } = useLists();
  const { isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  const [parsedRestaurants, setParsedRestaurants] = useState<ParsedRestaurant[]>([]);
  const [importResults, setImportResults] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  // Screenshot path: previews of the picked images while Claude reads them.
  const [shotPreviews, setShotPreviews] = useState<string[]>([]);
  const [aiReading, setAiReading] = useState(false);
  // Substatus while reading — recording scan %, then "part x of y".
  const [readingStage, setReadingStage] = useState('');
  // Shown when every parsed rating is ≤ 5 — almost certainly a 5-point
  // scale that would import as terrible /10 scores.
  const [scalePrompt, setScalePrompt] = useState(false);
  const abortRef = useRef(false);

  // Place-level duplicate guards for the resolve loop. Both sets also grow
  // as rows import, so two rows that RESOLVE to the same Google place
  // (e.g. the same restaurant read from two overlapping screenshots under
  // slightly different names) can only ever create one entry — the second
  // reports "skipped".
  const existingIds = new Set(ratings.map((r) => r.restaurantId));
  const existingWishlistIds = new Set(wishlist.map((w) => w.restaurantId));

  /** Feed a parsed batch (from either path) into the shared review flow. */
  const acceptParsed = (parsed: ParsedRestaurant[], label: string) => {
    setFileName(label);
    setParsedRestaurants(parsed);
    setImportResults(parsed.map((r) => ({ restaurant: r, status: 'pending' as const })));
    setScalePrompt(looksLikeFivePointScale(parsed));
  };

  // ── Capture path: pick or drop screenshots and/or a screen recording →
  //    Claude vision reads the list. A recording is first distilled into
  //    still frames covering the scroll (video-frames.ts); from there both
  //    kinds flow through the same tiling + extraction pipeline.
  const readCaptures = async (picked: File[]) => {
    if (picked.length === 0) return;
    // The Settings page can be reached signed-out; the vision read needs a
    // user (the edge function enforces it too). The wizard's caller is
    // provably signed in and states no gate — which is why the gate lives
    // at the call site rather than inside readCapturesToRows.
    if (!isSignedIn) { requireSignIn('Sign in to import from screenshots'); return; }
    setParseError('');
    setParsedRestaurants([]);
    setImportResults([]);
    setIsDone(false);
    setAiReading(true);
    setReadingStage('');
    const result = await readCapturesToRows(picked, {
      onStage: setReadingStage,
      onPreviews: setShotPreviews,
    });
    setAiReading(false);
    setReadingStage('');
    setShotPreviews([]);
    if (result.ok === false) { if (result.error) setParseError(result.error); return; }
    acceptParsed(result.rows, result.label);
  };

  const handleScreenshots = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files as ArrayLike<File>) : [];
    e.target.value = ''; // allow re-picking the same files
    void readCaptures(files);
  };

  // Desktop: drag screenshots anywhere onto the acquisition step.
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    // Ignore moves between children of the drop zone.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer) void readCaptures(Array.from(e.dataTransfer.files));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError('');
    setParsedRestaurants([]);
    setImportResults([]);
    setIsDone(false);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const { rows, error } = parseImportFile(file.name, ev.target?.result as string);
      if (error) { setParseError(error); return; }
      acceptParsed(rows, file.name);
    };
    reader.readAsText(file);
  };

  const applyScale = (double: boolean) => {
    setScalePrompt(false);
    if (!double) return;
    setParsedRestaurants((prev) => scaleToTen(prev));
    setImportResults((prev) => {
      const scaled = scaleToTen(prev.map((r) => r.restaurant));
      return prev.map((item, i) => ({ ...item, restaurant: scaled[i] }));
    });
  };

  const stats = {
    total: importResults.length,
    found: importResults.filter((r) => r.status === 'found' || r.status === 'updated').length,
    notFound: importResults.filter((r) => r.status === 'not_found').length,
    skipped: importResults.filter((r) => r.status === 'skipped').length,
    noData: importResults.filter((r) => r.status === 'no_data').length,
    errors: importResults.filter((r) => r.status === 'error').length,
    pending: importResults.filter((r) => r.status === 'pending' || r.status === 'searching').length,
  };

  const runImport = async () => {
    setIsRunning(true);
    abortRef.current = false;
    const home = loadLastSelectedLocation();
    await runRestaurantImport(importResults.map((r) => r.restaurant), {
      rateRestaurant, addToWishlist, cacheRestaurantMeta,
      existingRatings: ratings,
      existingWishlistIds: wishlist.map((w) => w.restaurantId),
      homeBias: home && Number.isFinite(home.lat) && Number.isFinite(home.lng)
        ? { lat: home.lat, lng: home.lng }
        : null,
      // One toast per imported row said nothing the summary below doesn't.
      silent: true,
      isAborted: () => abortRef.current,
      onRow: (i, patch) => setImportResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], ...patch };
        return next;
      }),
    });
    setIsRunning(false);
    setIsDone(true);
  };

  return (
    <div className="min-h-screen bg-surface">
      <motion.div
        ref={headerFade.headerRef}
        style={headerFade.headerStyle}
        className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-on-surface/[0.08] px-4 pt-safe-3 pb-3"
      >
        <div className="flex items-center gap-3">
          <GlassButton
            id="import-back"
            symbol="chevron.left"
            label="Back"
            onClick={() => navigate(-1)}
            className="hit-44 flex-none w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
          <div className="min-w-0">
            <h1 className="font-serif font-bold text-[19px] leading-tight tracking-[-0.025em] text-on-surface truncate">Import restaurants</h1>
            <p className="text-[11.5px] text-on-surface/50 mt-0.5 truncate">Beli screenshots, a screen recording, or a file</p>
          </div>
        </div>
      </motion.div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Acquisition step — screenshots (primary) or a file (secondary).
            The whole step doubles as a drag-and-drop target for screenshots
            on desktop. */}
        {parsedRestaurants.length === 0 && !aiReading && (
          <div
            className="space-y-4"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {/* Screenshot import — the easy path */}
            <button
              type="button"
              onClick={() => screenshotInputRef.current?.click()}
              className={`w-full text-left rounded-[22px] bg-primary text-on-primary px-[17px] py-[18px] active:opacity-90 transition-all ${
                dragOver ? 'ring-4 ring-primary/30 scale-[1.01]' : ''
              }`}
            >
              <div className="flex items-start gap-3.5">
                <span className="w-11 h-11 rounded-[15px] bg-white/[0.18] flex items-center justify-center flex-shrink-0">
                  <Images size={21} strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-serif font-bold text-[16px] leading-tight tracking-[-0.025em]">
                    {dragOver ? 'Drop your screenshots or recording' : 'Import from screenshots or a recording'}
                  </span>
                  <span className="block text-[12.5px] text-white/[0.82] mt-1.5 leading-relaxed">
                    Screenshot your Beli lists — or screen-record yourself scrolling one — and we'll read the restaurants, scores and all.
                    <span className="hidden md:inline"> You can also drag &amp; drop here.</span>
                  </span>
                </span>
              </div>
            </button>

            {/* How-to for the Beli case — three tiny steps, no jargon */}
            <div className="rounded-[20px] bg-on-surface/[0.05] px-[17px] py-[17px]">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/50">How it works</p>
              <ol className="mt-3.5 space-y-3 list-none">
                {[
                  `Open your list in Beli. Easiest: start a screen recording and scroll steadily to the bottom — or screenshot as you scroll (up to ${MAX_SCREENSHOTS} at a time).`,
                  'Tap the button above and pick the recording or the screenshots.',
                  'Review the matches and import — scores come across exactly as rated.',
                ].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-none w-5 h-5 rounded-full bg-on-surface text-surface flex items-center justify-center font-serif font-bold text-[10.5px]">{i + 1}</span>
                    <span className="flex-1 text-[13px] leading-relaxed text-on-surface/70">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* File path — secondary */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2 border-[1.5px] border-dashed border-on-surface/25 rounded-[20px] px-[18px] py-[26px] text-center cursor-pointer active:bg-on-surface/[0.04] transition-colors"
            >
              <FileUp size={22} strokeWidth={1.7} className="text-on-surface/40" />
              <p className="font-serif font-bold text-[14px] tracking-[-0.02em] text-on-surface">Or upload a file</p>
              <p className="text-[12px] leading-relaxed text-on-surface/55 max-w-[260px]">CSV or JSON with a "name" column — ratings, cities and notes come along if present</p>
            </div>

            <input ref={screenshotInputRef} type="file" accept="image/*,video/*" multiple onChange={handleScreenshots} className="hidden" />
            <input ref={fileInputRef} type="file" accept=".csv,.json,.txt" onChange={handleFileUpload} className="hidden" />

            {parseError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{parseError}</p>
              </div>
            )}
          </div>
        )}

        {/* Screenshot reading state — thumbnails + progress */}
        {aiReading && (
          <div className="rounded-2xl border border-on-surface/10 bg-paper p-6 text-center space-y-4">
            {shotPreviews.length > 0 && (
              <div className="flex justify-center gap-2">
                {shotPreviews.slice(0, 4).map((src, i) => (
                  <img key={i} src={src} alt="" className="w-14 h-24 rounded-lg object-cover object-top border border-on-surface/10" />
                ))}
                {shotPreviews.length > 4 && (
                  <div className="w-14 h-24 rounded-lg bg-on-surface/[0.05] border border-on-surface/10 flex items-center justify-center text-xs font-bold text-on-surface/50">
                    +{shotPreviews.length - 4}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-on-surface/70">
              <Loader2 size={16} className="animate-spin text-primary" />
              {readingStage || 'Reading your list…'}
            </div>
            <p className="text-xs text-on-surface/40">Pulling out every restaurant, score and city. This takes a few seconds{readingStage.startsWith('Reading part') ? ' per part' : ''}.</p>
          </div>
        )}

        {/* Parsed results */}
        {parsedRestaurants.length > 0 && (
          <>
            {/* Batch header */}
            <div className="flex items-center justify-between gap-3 pt-1 px-1">
              <div className="min-w-0">
                <p className="font-serif font-bold text-[19px] leading-tight text-on-surface">
                  {parsedRestaurants.length} restaurant{parsedRestaurants.length === 1 ? '' : 's'} found
                </p>
                <p className="text-[12.5px] font-medium text-on-surface/50 mt-0.5 truncate">
                  From {fileName} — review the list, then import
                </p>
              </div>
              <button
                onClick={() => { setParsedRestaurants([]); setImportResults([]); setFileName(''); setIsDone(false); }}
                className="w-9 h-9 flex-none rounded-full grid place-items-center text-on-surface/45 hover:bg-on-surface/[0.06] hover:text-on-surface transition-colors"
                aria-label="Start over"
              >
                <X size={16} />
              </button>
            </div>

            {/* 5-point-scale prompt */}
            {scalePrompt && !isRunning && !isDone && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200/70 rounded-2xl">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-amber-900">
                    These scores look like a 5-point scale.
                  </p>
                  <p className="text-[12px] text-amber-800/80 mt-0.5">This app rates out of 10 — double them so a 4/5 imports as 8/10?</p>
                  <div className="flex gap-2 mt-2.5">
                    <button type="button" onClick={() => applyScale(true)}
                      className="h-8 px-3.5 rounded-full bg-amber-500 text-white text-[12px] font-bold">Double to /10</button>
                    <button type="button" onClick={() => applyScale(false)}
                      className="h-8 px-3.5 rounded-full border border-amber-300 text-amber-800 text-[12px] font-semibold">Keep as-is</button>
                  </div>
                </div>
              </div>
            )}

            {/* Stats */}
            {(isRunning || isDone) && (
              <div className="grid grid-cols-5 gap-1.5 text-center">
                {([
                  [stats.found, 'Added', 'text-emerald-600'],
                  [stats.skipped, 'Skipped', 'text-amber-600'],
                  [stats.notFound, 'No match', 'text-red-500'],
                  [stats.noData, 'No data', 'text-on-surface/45'],
                  [stats.pending, 'Left', 'text-on-surface/60'],
                ] as const).map(([n, label, color]) => (
                  <div key={label} className="rounded-xl bg-paper border border-on-surface/[0.06] py-2.5">
                    <div className={`font-serif font-bold text-[19px] leading-none tabular-nums ${color}`}>{n}</div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-on-surface/40 mt-1">{label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Primary action */}
            {!isRunning && !isDone && (
              <button onClick={runImport}
                className="w-full h-12 rounded-2xl bg-primary text-on-primary text-[15px] font-bold shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-[0.99] transition-all">
                Import {parsedRestaurants.length === 1 ? 'this restaurant' : `all ${parsedRestaurants.length}`}
              </button>
            )}
            {isRunning && (
              <button onClick={() => { abortRef.current = true; }}
                className="w-full h-12 rounded-2xl bg-on-surface/[0.06] border border-on-surface/10 text-on-surface text-[15px] font-bold hover:bg-on-surface/10 transition-colors">
                Stop
              </button>
            )}
            {isDone && (
              <button onClick={() => navigate('/pantry')}
                className="w-full h-12 rounded-2xl bg-primary text-on-primary text-[15px] font-bold shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-[0.99] transition-all">
                View my ratings
              </button>
            )}

            {/* Progress */}
            {isRunning && (
              <div className="w-full bg-on-surface/[0.08] rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary h-full rounded-full transition-all duration-300"
                  style={{ width: `${((stats.found + stats.notFound + stats.skipped + stats.noData + stats.errors) / stats.total) * 100}%` }} />
              </div>
            )}

            {/* Restaurant list — neutral cards; state lives in the icon,
                the status line, and the score badge, not pastel washes. */}
            <div className="space-y-2">
              {importResults.map((item, idx) => (
                <div key={idx}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl border bg-white transition-colors ${
                    item.status === 'searching' ? 'border-primary/30' : 'border-on-surface/[0.07]'
                  } ${item.status === 'no_data' || item.status === 'not_found' || item.status === 'error' ? 'opacity-80' : ''}`}>
                  <div className="flex-shrink-0 w-6 grid place-items-center">
                    {item.status === 'pending' && <span className="w-2 h-2 rounded-full bg-on-surface/15" />}
                    {item.status === 'searching' && <Loader2 size={18} className="text-primary animate-spin" />}
                    {(item.status === 'found' || item.status === 'updated') && <CheckCircle size={19} className="text-emerald-500" />}
                    {item.status === 'skipped' && <AlertTriangle size={18} className="text-amber-500" />}
                    {item.status === 'no_data' && <AlertTriangle size={18} className="text-on-surface/25" />}
                    {(item.status === 'not_found' || item.status === 'error') && <XCircle size={19} className="text-red-400" />}
                  </div>
                  {item.placeResult?.photoUrl && (
                    <img src={item.placeResult.photoUrl} alt="" className="w-11 h-11 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-serif font-bold text-[15px] leading-tight text-on-surface truncate">{item.restaurant.name}</div>
                    {(item.restaurant.city || item.restaurant.cuisine) && (
                      <div className="text-[12px] font-medium text-on-surface/55 truncate mt-0.5">
                        {[item.restaurant.city, item.restaurant.cuisine].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {item.status === 'updated' && item.restaurant.rating !== null && (
                      <div className="text-[11.5px] font-semibold text-emerald-600 mt-0.5">Score corrected to {clampScore(item.restaurant.rating).toFixed(1)}</div>
                    )}
                    {item.status === 'skipped' && <div className="text-[11.5px] font-semibold text-amber-600 mt-0.5">Already in your ratings</div>}
                    {item.status === 'no_data' && <div className="text-[11.5px] font-medium text-on-surface/40 mt-0.5">No score or wishlist flag — nothing to import</div>}
                    {item.status === 'not_found' && <div className="text-[11.5px] font-semibold text-red-500 mt-0.5">No match found on Google</div>}
                    {item.status === 'error' && <div className="text-[11.5px] font-semibold text-red-500 mt-0.5">Something went wrong</div>}
                  </div>
                  {item.restaurant.rating !== null ? (
                    <div className="flex-none"><ScoreBadge rating={clampScore(item.restaurant.rating)} size="sm" /></div>
                  ) : item.restaurant.isWishlist ? (
                    <span className="flex-none inline-flex items-center gap-1 h-6 px-2 rounded-full bg-on-surface/[0.05] text-[10.5px] font-bold text-on-surface/55">
                      <Bookmark size={11} /> Wishlist
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
