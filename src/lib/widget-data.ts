import type { CalendarPlan } from './calendar';
import type { RestaurantRating, WishlistItem } from '../contexts/ListsContext';
import type { TasteProfileState } from './useTasteProfile';

export interface WidgetPlace { id: string; title: string; subtitle: string; path: string }
export interface WidgetSnapshot {
  version: 1; owner: string; updatedAt: number;
  meals: { id: string; title: string; kind: string; start: number; end: number; confirmed: boolean; path: string }[];
  taste: { tier: string; points: number; progress: number; next: string; toNext: number; places: number; cuisines: number; cities: number; rank: number | null; identity: string };
  social: { messages: number; requests: number };
  saved: WidgetPlace[]; favorites: WidgetPlace[];
}
const clean = (s: string) => s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
const count = (n: number) => Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
export function buildWidgetSnapshot(input: {
  owner: string; plans: CalendarPlan[]; ratings: RestaurantRating[]; wishlist: WishlistItem[];
  taste: TasteProfileState; messages: number; requests: number; now?: number;
}): WidgetSnapshot {
  const now = input.now ?? Date.now();
  const { standing, points, stats, insights, benchmarks } = input.taste;
  const place = (r: RestaurantRating | WishlistItem): WidgetPlace => ({ id: r.restaurantId, title: clean(r.name), subtitle: clean(r.cuisine || 'Restaurant'), path: `/restaurant/${encodeURIComponent(r.restaurantId)}` });
  return {
    version: 1, owner: input.owner, updatedAt: now / 1000,
    // No addresses, notes, confirmation codes, contact names, or message contents leave the app.
    meals: input.plans.filter(p => p.status === 'planned' && (!p.user_id || p.user_id === input.owner) &&
      Number.isFinite(Date.parse(p.starts_at)) && Date.parse(p.ends_at) > now && Date.parse(p.ends_at) > Date.parse(p.starts_at))
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).slice(0, 24)
      .map(p => ({ id: p.id, title: clean(p.title), kind: p.kind, start: Date.parse(p.starts_at) / 1000, end: Date.parse(p.ends_at) / 1000, confirmed: p.details.reservation === 'confirmed', path: `/calendar?plan=${encodeURIComponent(p.id)}` })),
    taste: { tier: standing.tier.name, points: count(points.total), progress: Math.min(1, Math.max(0, standing.progress)), next: standing.next?.name ?? '', toNext: count(standing.toNext), places: count(stats.ratingCount), cuisines: count(stats.cuisineCount), cities: count(stats.cityCount), rank: benchmarks?.benchmarks.myRank ?? null, identity: clean(insights.palate.archetype ?? 'Your taste, taking shape') },
    social: { messages: count(input.messages), requests: count(input.requests) },
    saved: [...input.wishlist].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12).map(place),
    favorites: [...input.ratings].filter(r => Number.isFinite(r.score)).sort((a, b) => b.score - a.score || a.restaurantId.localeCompare(b.restaurantId)).slice(0, 3).map(place),
  };
}

/** Only widget-owned URLs may route; OAuth callbacks and arbitrary paths are ignored. */
export function widgetDestination(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'com.tylergorin.restaurantapp:' || url.host !== 'widget' || url.username || url.password) return null;
    const path = url.searchParams.get('path') ?? '';
    if (['/calendar', '/profile/taste', '/messages', '/pantry', '/create'].includes(path)) return path;
    if (/^\/calendar\?plan=[a-zA-Z0-9%_-]{1,200}$/.test(path)) return path;
    if (/^\/restaurant\/[a-zA-Z0-9%_.~-]{1,400}$/.test(path) && !/%2f|%5c|%2e/i.test(path)) return path;
    return null;
  } catch { return null; }
}
