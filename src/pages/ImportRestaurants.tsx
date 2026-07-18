import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, CheckCircle, XCircle, Loader2, FileUp, X, AlertTriangle } from 'lucide-react';
import { useLists, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import { loadLastSelectedLocation } from '../components/HomeLocationBar';

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
  status: 'pending' | 'searching' | 'found' | 'not_found' | 'skipped' | 'no_data' | 'error';
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

export const ImportRestaurants: React.FC = () => {
  const navigate = useNavigate();
  const { ratings, rateRestaurant, cacheRestaurantMeta, addToWishlist, wishlist } = useLists();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsedRestaurants, setParsedRestaurants] = useState<ParsedRestaurant[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  // Shown when every parsed rating is ≤ 5 — almost certainly a 5-point
  // scale that would import as terrible /10 scores.
  const [scalePrompt, setScalePrompt] = useState(false);
  const abortRef = useRef(false);

  const existingIds = new Set(ratings.map((r) => r.restaurantId));

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

      setParsedRestaurants(parsed);
      setImportResults(parsed.map((r) => ({ restaurant: r, status: 'pending' as const })));
      // Every rating ≤ 5 → probably a 5-point export; offer to double.
      const parsedRatings = parsed.map((r) => r.rating).filter((n): n is number => n !== null);
      setScalePrompt(parsedRatings.length > 0 && Math.max(...parsedRatings) <= 5);
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
    found: importResults.filter((r) => r.status === 'found').length,
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
        if (existingIds.has(place.id)) { setImportResults((prev) => { const next = [...prev]; next[i] = { ...next[i], status: 'skipped', placeResult: place }; return next; }); continue; }

        const price = priceLevelToString(restaurant.priceRange || place.priceLevel);
        const meta: RestaurantMeta = { id: place.id, name: place.name, image: place.photoUrl || '', cuisine: restaurant.cuisine, price, address: place.address || restaurant.address };
        cacheRestaurantMeta(meta);

        if (restaurant.isWishlist) {
          addToWishlist({
            restaurantId: place.id, name: place.name, image: place.photoUrl || '',
            cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
            notes: restaurant.notes, listIds: [], addedAt: Date.now() - (importResults.length - i),
          });
        } else if (restaurant.rating !== null) {
          rateRestaurant({
            restaurantId: place.id, name: place.name, image: place.photoUrl || '',
            cuisine: restaurant.cuisine, price, address: place.address || restaurant.address,
            score: clampScore(restaurant.rating), notes: restaurant.notes, visitDate: restaurant.dateVisited || '',
            wouldReturn: true, tags: [], photos: [], listIds: [],
            createdAt: Date.now() - (importResults.length - i),
          });
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
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-primary/10 px-4 pt-safe-3 pb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-primary/5 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-primary" />
          </button>
          <div>
            <h1 className="text-lg font-serif font-semibold text-primary">Import Restaurants</h1>
            <p className="text-xs text-muted">Upload a CSV or JSON file</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* File upload area */}
        {parsedRestaurants.length === 0 && (
          <div className="space-y-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-on-surface/15 rounded-2xl p-8 text-center cursor-pointer hover:border-primary/30 hover:bg-primary/3 transition-all"
            >
              <FileUp size={32} className="mx-auto text-on-surface/25 mb-3" />
              <p className="text-sm font-semibold text-on-surface/60">Click to upload a file</p>
              <p className="text-xs text-on-surface/35 mt-1">Supports CSV and JSON files</p>
            </div>

            <input ref={fileInputRef} type="file" accept=".csv,.json,.txt" onChange={handleFileUpload} className="hidden" />

            {parseError && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{parseError}</p>
              </div>
            )}

            {/* Format guide */}
            <div className="bg-on-surface/3 rounded-2xl p-4 space-y-3">
              <p className="text-xs font-bold text-on-surface/50 uppercase tracking-wider">Supported Formats</p>
              <div>
                <p className="text-xs font-semibold text-on-surface/70 mb-1">CSV (comma-separated)</p>
                <code className="block text-[10px] bg-white p-2 rounded-lg text-on-surface/50 overflow-x-auto whitespace-pre-wrap">
                  name,address,city,cuisine,rating,notes,date_visited,is_wishlist,price_range{'\n'}
                  Nobu Downtown,"195 Broadway, New York",New York,Japanese,8.8,Amazing,2025-01-15,false,4
                </code>
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface/70 mb-1">JSON</p>
                <code className="block text-[10px] bg-white p-2 rounded-lg text-on-surface/50 overflow-x-auto">
                  {'[{"name":"Nobu","city":"New York","cuisine":"Japanese","rating":8.8,"price_range":4}]'}
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Parsed results */}
        {parsedRestaurants.length > 0 && (
          <>
            {/* File info */}
            <div className="flex items-center justify-between bg-white rounded-xl border border-on-surface/8 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileUp size={14} className="text-primary flex-shrink-0" />
                <span className="text-xs font-medium truncate">{fileName}</span>
                <span className="text-[10px] text-on-surface/40">{parsedRestaurants.length} restaurants</span>
              </div>
              <button onClick={() => { setParsedRestaurants([]); setImportResults([]); setFileName(''); setIsDone(false); }}
                className="p-1 text-on-surface/30 hover:text-on-surface/60"><X size={14} /></button>
            </div>

            {/* 5-point-scale prompt */}
            {scalePrompt && !isRunning && !isDone && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-800">
                    Every rating in this file is 5 or below — looks like a 5-point scale.
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">This app rates out of 10. Double the scores so a 4/5 imports as 8/10?</p>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => applyScale(true)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold">Double to /10</button>
                    <button type="button" onClick={() => applyScale(false)}
                      className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs font-semibold">Keep as-is</button>
                  </div>
                </div>
              </div>
            )}

            {/* Stats */}
            {(isRunning || isDone) && (
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <div className="bg-emerald-50 rounded-lg p-2"><div className="text-emerald-600 font-bold text-lg">{stats.found}</div><div className="text-emerald-600">Found</div></div>
                <div className="bg-amber-50 rounded-lg p-2"><div className="text-amber-600 font-bold text-lg">{stats.skipped}</div><div className="text-amber-600">Skipped</div></div>
                <div className="bg-red-50 rounded-lg p-2"><div className="text-red-600 font-bold text-lg">{stats.notFound}</div><div className="text-red-600">Not Found</div></div>
                <div className="bg-slate-100 rounded-lg p-2"><div className="text-slate-500 font-bold text-lg">{stats.noData}</div><div className="text-slate-500">No Data</div></div>
                <div className="bg-on-surface/[0.05] rounded-lg p-2"><div className="text-on-surface/60 font-bold text-lg">{stats.pending}</div><div className="text-on-surface/60">Pending</div></div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              {!isRunning && !isDone && (
                <button onClick={runImport}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary/90 transition-colors">
                  <Upload className="w-4 h-4" /> Start Import
                </button>
              )}
              {isRunning && (
                <button onClick={() => { abortRef.current = true; }}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white py-3 rounded-xl font-medium">Stop</button>
              )}
              {isDone && (
                <button onClick={() => navigate('/pantry')}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-xl font-medium">View My Ratings</button>
              )}
            </div>

            {/* Progress */}
            {isRunning && (
              <div className="w-full bg-on-surface/15 rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((stats.found + stats.notFound + stats.skipped + stats.noData + stats.errors) / stats.total) * 100}%` }} />
              </div>
            )}

            {/* Restaurant list */}
            <div className="space-y-2">
              {importResults.map((item, idx) => (
                <div key={idx}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    item.status === 'found' ? 'bg-emerald-50 border-emerald-200' :
                    item.status === 'skipped' ? 'bg-amber-50 border-amber-200' :
                    item.status === 'no_data' ? 'bg-slate-50 border-slate-200' :
                    item.status === 'not_found' || item.status === 'error' ? 'bg-red-50 border-red-200' :
                    item.status === 'searching' ? 'bg-blue-50 border-blue-200' : 'bg-white border-on-surface/10'
                  }`}>
                  <div className="flex-shrink-0">
                    {item.status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-on-surface/25" />}
                    {item.status === 'searching' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
                    {item.status === 'found' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                    {item.status === 'skipped' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                    {item.status === 'no_data' && <AlertTriangle className="w-5 h-5 text-slate-400" />}
                    {(item.status === 'not_found' || item.status === 'error') && <XCircle className="w-5 h-5 text-red-400" />}
                  </div>
                  {item.placeResult?.photoUrl && (
                    <img src={item.placeResult.photoUrl} alt={item.restaurant.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.restaurant.name}</div>
                    <div className="text-xs text-muted truncate">
                      {item.restaurant.city}{item.restaurant.city && item.restaurant.cuisine ? ' · ' : ''}{item.restaurant.cuisine}
                      {item.restaurant.rating !== null && ` · ${item.restaurant.rating}/10`}
                      {item.restaurant.isWishlist && ' · Wishlist'}
                    </div>
                    {item.status === 'skipped' && <div className="text-xs text-amber-600">Already imported</div>}
                    {item.status === 'no_data' && <div className="text-xs text-slate-500">No rating or wishlist flag — nothing to import</div>}
                    {item.status === 'not_found' && <div className="text-xs text-red-500">Not found on Google Places</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
