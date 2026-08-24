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
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import { loadLastSelectedLocation } from '../components/HomeLocationBar';
import { extractRestaurantsFromCaptures, prepareScreenshotTiles } from '../lib/import-restaurants-client';
import { extractFramesFromRecording } from '../lib/video-frames';

interface ParsedRestaurant {
  name: string;
  address: string;
  city: string;
  cuisine: string;
  rating: number | null;
  notes: string;
  dateVisited: string;
  priceRange: number;
  isWishlist: boolean;
}

interface ImportResult {
  restaurant: ParsedRestaurant;
  /** 'updated' — the place was already rated with a DIFFERENT score, so the
   *  import corrected the score in place (a re-run heals earlier drift). */
  status: 'pending' | 'searching' | 'found' | 'updated' | 'not_found' | 'skipped' | 'no_data' | 'error';
  placeResult?: PlaceResult;
  error?: string;
}

/**
 * Tokenize a whole CSV document into rows of fields. A real state machine
 * over the raw text — quoted fields may contain commas, "" escaped quotes,
 * and embedded newlines (the old line-splitting parser corrupted every row
 * after a multiline note). Handles CRLF and a missing trailing newline.
 * Blank lines are dropped.
 */
export function tokenizeCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" = escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function parseCSV(text: string): ParsedRestaurant[] {
  const rows = tokenizeCSV(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());

  const nameIdx = headers.findIndex((h) => h.includes('name'));
  const addressIdx = headers.findIndex((h) => h.includes('address'));
  const cityIdx = headers.findIndex((h) => h.includes('city'));
  const cuisineIdx = headers.findIndex((h) => h.includes('cuisine'));
  const ratingIdx = headers.findIndex((h) => h.includes('rating') || h.includes('score'));
  const notesIdx = headers.findIndex((h) => h.includes('note'));
  const dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('visited'));
  const priceIdx = headers.findIndex((h) => h.includes('price'));
  const wishlistIdx = headers.findIndex((h) => h.includes('wishlist'));

  if (nameIdx === -1) return [];

  return rows.slice(1).map((fields) => {
    const at = (idx: number) => (idx >= 0 ? (fields[idx] || '').trim() : '');

    const priceRaw = at(priceIdx);
    const priceRange = priceRaw.includes('$') ? priceRaw.replace(/[^$]/g, '').length : (parseInt(priceRaw) || 0);

    const ratingRaw = at(ratingIdx);
    const rating = ratingRaw ? parseFloat(ratingRaw) : null;

    return {
      name: at(nameIdx),
      address: at(addressIdx),
      city: at(cityIdx),
      cuisine: at(cuisineIdx),
      rating: rating !== null && !isNaN(rating) ? rating : null,
      notes: at(notesIdx),
      dateVisited: at(dateIdx),
      priceRange: Math.min(priceRange, 4),
      isWishlist: ['true', '1', 'yes'].includes(at(wishlistIdx).toLowerCase()),
    };
  }).filter((r) => r.name);
}

function parseJSON(text: string): ParsedRestaurant[] {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.restaurants || data.data || [];
    return arr.filter((r: any) => r.name).map((r: any) => ({
      name: r.name || '',
      address: r.address || '',
      city: r.city || r.location || '',
      cuisine: r.cuisine || r.type || '',
      rating: r.rating != null ? parseFloat(r.rating) : (r.score != null ? parseFloat(r.score) : null),
      notes: r.notes || r.review || '',
      dateVisited: r.dateVisited || r.date_visited || r.date || '',
      priceRange: typeof r.priceRange === 'number' ? r.priceRange : (typeof r.price_range === 'number' ? r.price_range : (r.price ? String(r.price).replace(/[^$]/g, '').length : 0)),
      isWishlist: !!(r.is_wishlist || r.isWishlist || r.wishlist),
    }));
  } catch { return []; }
}

/** Clamp an imported score onto the app's 0–10 scale — community_ratings
 *  has a CHECK (score <= 10), so an out-of-range value silently failed to
 *  publish while still saving a broken local rating. */
const clampScore = (n: number): number => Math.min(10, Math.max(0, n));

async function findGooglePlace(
  restaurant: ParsedRestaurant,
  homeBias: { lat: number; lng: number } | null,
): Promise<PlaceResult | null> {
  const query = `${restaurant.name} ${restaurant.city || restaurant.address}`.trim();
  // Rows carrying a city/address are located by the QUERY TEXT — no
  // coordinate bias, so a home bias can't drag a "Rome trip" CSV toward a
  // same-named place near home. Name-only rows get the home-location bias.
  // Never (0,0): that anchored every match to Null Island, letting a
  // same-named restaurant in the wrong city win.
  const bias = restaurant.city || restaurant.address ? null : homeBias;
  try {
    const results = await searchPlacesByText(query, bias?.lat ?? null, bias?.lng ?? null);
    return results.length > 0 ? results[0] : null;
  } catch {
    try {
      const results = await searchPlacesByText(`${restaurant.name} restaurant`, homeBias?.lat ?? null, homeBias?.lng ?? null);
      return results.length > 0 ? results[0] : null;
    } catch { return null; }
  }
}

/** Max screenshots per AI read — 6 shots × up to 4 tiles fills one call. */
const MAX_SCREENSHOTS = 6;
/** Max screen recordings per read — each extracts to many frames. */
const MAX_RECORDINGS = 2;

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
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
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
    const parsedRatings = parsed.map((r) => r.rating).filter((n): n is number => n !== null);
    setScalePrompt(parsedRatings.length > 0 && Math.max(...parsedRatings) <= 5);
  };

  // ── Capture path: pick or drop screenshots and/or a screen recording →
  //    Claude vision reads the list. A recording is first distilled into
  //    still frames covering the scroll (video-frames.ts); from there both
  //    kinds flow through the same tiling + extraction pipeline.
  const readCaptures = async (picked: File[]) => {
    const images = picked.filter((f) => f.type.startsWith('image/')).slice(0, MAX_SCREENSHOTS);
    const videos = picked.filter((f) => f.type.startsWith('video/')).slice(0, MAX_RECORDINGS);
    if (images.length === 0 && videos.length === 0) return;
    if (!isSignedIn) { requireSignIn('Sign in to import from screenshots'); return; }

    setParseError('');
    setParsedRestaurants([]);
    setImportResults([]);
    setIsDone(false);
    setAiReading(true);
    setReadingStage('');
    try {
      // Each capture becomes 1–4 overlapping high-resolution tiles so
      // small row text (Beli's decimal score circles especially) stays
      // legible to the vision model; the extractor dedupes the overlap.
      const tileGroups: string[][] = [];
      for (const f of images) tileGroups.push(await prepareScreenshotTiles(f));
      for (const v of videos) {
        setReadingStage('Scanning your recording…');
        const frames = await extractFramesFromRecording(v, (p) => {
          setReadingStage(`Scanning your recording… ${Math.round(p * 100)}%`);
        });
        for (const frame of frames) tileGroups.push(await prepareScreenshotTiles(frame));
      }
      setShotPreviews(tileGroups.map((t) => t[0]));
      const result = await extractRestaurantsFromCaptures(tileGroups, {
        onBatchProgress: (i, total) => {
          setReadingStage(total > 1 ? `Reading part ${i + 1} of ${total}…` : '');
        },
      });
      if (!result.ok || !result.restaurants) {
        setParseError(result.error || "Couldn't read those captures. Try again with clearer ones.");
        return;
      }
      const labelParts = [
        images.length > 0 ? `${images.length} screenshot${images.length === 1 ? '' : 's'}` : '',
        videos.length > 0 ? `${videos.length === 1 ? 'a screen recording' : `${videos.length} screen recordings`}` : '',
      ].filter(Boolean);
      acceptParsed(
        result.restaurants.map((r) => ({
          name: r.name,
          address: '',
          city: r.city || '',
          cuisine: r.cuisine || '',
          rating: r.score ?? null,
          notes: r.notes || '',
          dateVisited: '',
          priceRange: 0,
          isWishlist: !!r.wishlist,
        })),
        labelParts.join(' + '),
      );
    } catch (err) {
      setParseError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't read one of those files. Use JPG/PNG screenshots or an MP4/MOV recording and try again.",
      );
    } finally {
      setAiReading(false);
      setReadingStage('');
      setShotPreviews([]);
    }
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
      const text = ev.target?.result as string;
      let parsed: ParsedRestaurant[] = [];

      if (file.name.endsWith('.json')) {
        parsed = parseJSON(text);
      } else {
        parsed = parseCSV(text);
      }

      if (parsed.length === 0) {
        setParseError('Could not parse any restaurants. Make sure your file has a "name" column (CSV) or "name" field (JSON).');
        return;
      }

      acceptParsed(parsed, file.name);
    };
    reader.readAsText(file);
  };

  const applyScale = (double: boolean) => {
    setScalePrompt(false);
    if (!double) return;
    const scale = (r: ParsedRestaurant): ParsedRestaurant =>
      r.rating !== null ? { ...r, rating: clampScore(r.rating * 2) } : r;
    setParsedRestaurants((prev) => prev.map(scale));
    setImportResults((prev) => prev.map((item) => ({ ...item, restaurant: scale(item.restaurant) })));
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
    // Current rating per place id — lets a re-run CORRECT a score that
    // drifted (or was mistyped) instead of skipping it, while preserving
    // the rating's notes, photos, lists and visit history.
    const ratingByPlaceId = new Map<string, RestaurantRating>(ratings.map((r) => [r.restaurantId, r]));
    const home = loadLastSelectedLocation();
    const homeBias = home && Number.isFinite(home.lat) && Number.isFinite(home.lng)
      ? { lat: home.lat, lng: home.lng }
      : null;

    for (let i = 0; i < importResults.length; i++) {
      if (abortRef.current) break;
      const restaurant = importResults[i].restaurant;

      // Nothing to import for this row (no rating, no wishlist flag) —
      // say so honestly instead of burning a search and marking it green.
      if (!restaurant.isWishlist && restaurant.rating === null) {
        setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'no_data' }; return next; });
        continue;
      }

      setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'searching' }; return next; });
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 300));

      try {
        const place = await findGooglePlace(restaurant, homeBias);
        if (!place) { setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'not_found' }; return next; }); continue; }
        // Already rated (or imported earlier in this run) — never duplicate.
        // A wishlist row is also skipped when the place is already on the
        // wishlist; a RATING for a place that's only wishlisted still
        // imports (that's an upgrade, not a duplicate).
        const isDuplicate = existingIds.has(place.id)
          || (restaurant.isWishlist && existingWishlistIds.has(place.id));
        if (isDuplicate) {
          // Same place, different score → correct the score in place (keep
          // the rating's notes / photos / lists / history). This is what
          // lets re-running an import fix earlier drift or misreads.
          const existing = ratingByPlaceId.get(place.id);
          const importedScore = restaurant.rating !== null ? clampScore(restaurant.rating) : null;
          if (!restaurant.isWishlist && importedScore !== null && existing && existing.score !== importedScore) {
            rateRestaurant({ ...existing, score: importedScore, ratingMethod: 'import' }, { skipSettle: true });
            ratingByPlaceId.set(place.id, { ...existing, score: importedScore });
            setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'updated', placeResult: place }; return next; });
          } else {
            setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'skipped', placeResult: place }; return next; });
          }
          continue;
        }

        const price = priceLevelToString(restaurant.priceRange || place.priceLevel);
        const meta: RestaurantMeta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine: restaurant.cuisine, price, address: place.address || restaurant.address };
        cacheRestaurantMeta(meta);

        if (restaurant.isWishlist) {
          addToWishlist({
            restaurantId: place.id, name: place.name, image: place.photoUrl || '',
            cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
            notes: restaurant.notes, listIds: [], addedAt: Date.now() - (importResults.length - i),
          });
          existingWishlistIds.add(place.id);
        } else if (restaurant.rating !== null) {
          rateRestaurant({
            restaurantId: place.id, name: place.name, image: place.photoUrl || '',
            cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
            score: clampScore(restaurant.rating), notes: restaurant.notes, visitDate: restaurant.dateVisited || '',
            wouldReturn: true, tags: [], photos: [], listIds: [], friendIds: [],
            ratingMethod: 'import',
            createdAt: Date.now() - (importResults.length - i),
            // Imported scores are transcriptions of ratings the user already
            // made elsewhere — they must land EXACTLY as shown. The settle
            // engine (which nudges tier-mates on every save) reshuffled the
            // whole batch during bulk imports.
          }, { skipSettle: true });
        }
        existingIds.add(place.id);

        setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'found', placeResult: place }; return next; });
      } catch (err) {
        setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'error', error: String(err) }; return next; });
      }
    }

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
              className={`w-full text-left rounded-[22px] bg-primary text-white px-[17px] py-[18px] active:opacity-90 transition-all ${
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
                className="w-full h-12 rounded-2xl bg-primary text-white text-[15px] font-bold shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-[0.99] transition-all">
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
                className="w-full h-12 rounded-2xl bg-primary text-white text-[15px] font-bold shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-[0.99] transition-all">
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
