import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import restaurants, { type ImportRestaurant } from '../data/supabase-restaurants';
import { useLists, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';

interface ImportResult {
  restaurant: ImportRestaurant;
  status: 'pending' | 'searching' | 'found' | 'not_found' | 'skipped' | 'error';
  placeResult?: PlaceResult;
  error?: string;
}

async function findGooglePlace(restaurant: ImportRestaurant): Promise<PlaceResult | null> {
  // Try searching by name + city for best results
  const query = `${restaurant.name} ${restaurant.city}`;
  try {
    // Use 0,0 coords with no location bias — we rely on the text query for location
    const results = await searchPlacesByText(query, 0, 0);
    if (results.length > 0) {
      // Pick the best match — first result is usually most relevant
      return results[0];
    }
    return null;
  } catch {
    // If text search with city fails, try with address
    try {
      const results = await searchPlacesByText(`${restaurant.name} ${restaurant.address}`, 0, 0);
      return results.length > 0 ? results[0] : null;
    } catch {
      return null;
    }
  }
}

export const ImportRestaurants: React.FC = () => {
  const navigate = useNavigate();
  const { ratings, rateRestaurant, cacheRestaurantMeta } = useLists();
  const [importResults, setImportResults] = useState<ImportResult[]>(() =>
    restaurants.map((r) => ({ restaurant: r, status: 'pending' as const }))
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const abortRef = useRef(false);

  const existingIds = new Set(ratings.map((r) => r.restaurantId));

  const stats = {
    total: importResults.length,
    found: importResults.filter((r) => r.status === 'found').length,
    notFound: importResults.filter((r) => r.status === 'not_found').length,
    skipped: importResults.filter((r) => r.status === 'skipped').length,
    errors: importResults.filter((r) => r.status === 'error').length,
    pending: importResults.filter((r) => r.status === 'pending' || r.status === 'searching').length,
  };

  const runImport = async () => {
    setIsRunning(true);
    abortRef.current = false;

    for (let i = 0; i < importResults.length; i++) {
      if (abortRef.current) break;

      const item = importResults[i];
      const restaurant = item.restaurant;

      // Mark as searching
      setImportResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'searching' };
        return next;
      });

      // Add a small delay between requests to avoid rate limiting
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      try {
        const place = await findGooglePlace(restaurant);

        if (!place) {
          setImportResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: 'not_found' };
            return next;
          });
          continue;
        }

        // Check if already imported (by Google Place ID)
        if (existingIds.has(place.id)) {
          setImportResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: 'skipped', placeResult: place };
            return next;
          });
          continue;
        }

        // Build the price string
        const price = priceLevelToString(restaurant.priceRange);

        // Cache the restaurant metadata
        const meta: RestaurantMeta = {
          id: place.id,
          name: place.name,
          image: place.photoUrl || '',
          cuisine: restaurant.cuisine,
          price,
          address: place.address || restaurant.address,
        };
        cacheRestaurantMeta(meta);

        // Create and save the rating if there's a score
        if (restaurant.rating !== null) {
          const rating: RestaurantRating = {
            restaurantId: place.id,
            name: place.name,
            image: place.photoUrl || '',
            cuisine: restaurant.cuisine,
            price,
            address: place.address || restaurant.address,
            score: restaurant.rating,
            notes: restaurant.notes,
            visitDate: restaurant.dateVisited || '',
            wouldReturn: true,
            tags: [],
            createdAt: Date.now() - (importResults.length - i), // Slight offset for ordering
          };
          rateRestaurant(rating);
          existingIds.add(place.id);
        } else {
          // No rating — still cache the metadata and create a rating entry with notes if available
          if (restaurant.notes) {
            const rating: RestaurantRating = {
              restaurantId: place.id,
              name: place.name,
              image: place.photoUrl || '',
              cuisine: restaurant.cuisine,
              price,
              address: place.address || restaurant.address,
              score: 0,
              notes: restaurant.notes,
              visitDate: restaurant.dateVisited || '',
              wouldReturn: true,
              tags: [],
              createdAt: Date.now() - (importResults.length - i),
            };
            rateRestaurant(rating);
            existingIds.add(place.id);
          }
        }

        setImportResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'found', placeResult: place };
          return next;
        });
      } catch (err) {
        setImportResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'error', error: String(err) };
          return next;
        });
      }
    }

    setIsRunning(false);
    setIsDone(true);
  };

  const stopImport = () => {
    abortRef.current = true;
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-primary/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-primary/5 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-primary" />
          </button>
          <div>
            <h1 className="text-lg font-serif font-semibold text-primary">Import Restaurants</h1>
            <p className="text-xs text-muted">From your Supabase collection — {restaurants.length} restaurants</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Stats bar */}
        {(isRunning || isDone) && (
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div className="bg-emerald-50 rounded-lg p-2">
              <div className="text-emerald-600 font-bold text-lg">{stats.found}</div>
              <div className="text-emerald-600">Found</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-2">
              <div className="text-amber-600 font-bold text-lg">{stats.skipped}</div>
              <div className="text-amber-600">Skipped</div>
            </div>
            <div className="bg-red-50 rounded-lg p-2">
              <div className="text-red-600 font-bold text-lg">{stats.notFound}</div>
              <div className="text-red-600">Not Found</div>
            </div>
            <div className="bg-red-50 rounded-lg p-2">
              <div className="text-red-600 font-bold text-lg">{stats.errors}</div>
              <div className="text-red-600">Errors</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-gray-600 font-bold text-lg">{stats.pending}</div>
              <div className="text-gray-600">Pending</div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {!isRunning && !isDone && (
            <button
              onClick={runImport}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary/90 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Start Import
            </button>
          )}
          {isRunning && (
            <button
              onClick={stopImport}
              className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white py-3 rounded-xl font-medium hover:bg-red-600 transition-colors"
            >
              Stop Import
            </button>
          )}
          {isDone && (
            <button
              onClick={() => navigate('/pantry')}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary/90 transition-colors"
            >
              View My Ratings
            </button>
          )}
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${((stats.found + stats.notFound + stats.skipped + stats.errors) / stats.total) * 100}%` }}
            />
          </div>
        )}

        {/* Restaurant list */}
        <div className="space-y-2">
          {importResults.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                item.status === 'found' ? 'bg-emerald-50 border-emerald-200' :
                item.status === 'skipped' ? 'bg-amber-50 border-amber-200' :
                item.status === 'not_found' ? 'bg-red-50 border-red-200' :
                item.status === 'error' ? 'bg-red-50 border-red-200' :
                item.status === 'searching' ? 'bg-blue-50 border-blue-200' :
                'bg-white border-gray-200'
              }`}
            >
              {/* Status icon */}
              <div className="flex-shrink-0">
                {item.status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-gray-300" />}
                {item.status === 'searching' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
                {item.status === 'found' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                {item.status === 'skipped' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                {item.status === 'not_found' && <XCircle className="w-5 h-5 text-red-400" />}
                {item.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
              </div>

              {/* Photo thumbnail */}
              {item.placeResult?.photoUrl && (
                <img
                  src={item.placeResult.photoUrl}
                  alt={item.restaurant.name}
                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                />
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{item.restaurant.name}</div>
                <div className="text-xs text-muted truncate">
                  {item.restaurant.city} · {item.restaurant.cuisine}
                  {item.restaurant.rating !== null && ` · ${item.restaurant.rating}/10`}
                  {item.restaurant.priceRange > 0 && ` · ${'$'.repeat(item.restaurant.priceRange)}`}
                </div>
                {item.status === 'skipped' && (
                  <div className="text-xs text-amber-600">Already imported</div>
                )}
                {item.status === 'not_found' && (
                  <div className="text-xs text-red-500">Could not find on Google Places</div>
                )}
                {item.status === 'error' && (
                  <div className="text-xs text-red-500 truncate">{item.error}</div>
                )}
                {item.status === 'found' && item.placeResult && (
                  <div className="text-xs text-emerald-600 truncate">
                    Matched: {item.placeResult.name} — {item.placeResult.address}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
