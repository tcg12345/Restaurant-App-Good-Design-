/**
 * Data export (entitlements 'export') — the person's own record as a
 * file. Two shapes: everything as JSON (the app's own types, verbatim,
 * so it round-trips), and the ratings alone as CSV for a spreadsheet.
 *
 * Pure builders plus one browser delivery. The native shell has no file
 * writer wired up, so Settings sends people to the web app for this.
 */
import type { CustomList, HomeMeal, RestaurantRating, Trip, WishlistItem } from '../contexts/ListsContext';

export interface ExportSources {
  ratings: RestaurantRating[];
  wishlist: WishlistItem[];
  lists: CustomList[];
  trips: Trip[];
  homeMeals: HomeMeal[];
}

export function buildExportJson(src: ExportSources, exportedAt = new Date()): string {
  const bundle = {
    app: 'GoodEats',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    counts: { ratings: src.ratings.length, wishlist: src.wishlist.length, lists: src.lists.length, trips: src.trips.length, recipes: src.homeMeals.length },
    ratings: src.ratings,
    wishlist: src.wishlist,
    lists: src.lists,
    trips: src.trips,
    recipes: src.homeMeals,
  };
  return JSON.stringify(bundle, null, 2);
}

const CSV_COLUMNS = ['name', 'score', 'cuisine', 'price', 'address', 'visitDate', 'wouldReturn', 'tags', 'favoriteDishes', 'notes', 'ratedAt'] as const;

function csvCell(v: unknown): string {
  const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Ratings as CSV, best first; a header row, one line per restaurant. */
export function buildRatingsCsv(ratings: RestaurantRating[]): string {
  const rows = [...ratings].sort((a, b) => b.score - a.score).map((r) => [
    r.name, r.score.toFixed(2), r.cuisine, r.price, r.address, r.visitDate, r.wouldReturn ? 'yes' : 'no',
    r.tags, r.favoriteDishes ?? [], r.notes, new Date(r.createdAt).toISOString(),
  ].map(csvCell).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Hand the browser a file. Returns false where downloads can't start. */
export function downloadTextFile(filename: string, text: string, mime: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

export const exportStamp = (d = new Date()): string => d.toISOString().slice(0, 10);
