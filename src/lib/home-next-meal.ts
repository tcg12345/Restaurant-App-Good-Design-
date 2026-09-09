import type { CalendarPlan } from './calendar';
import type { WishlistItem, RestaurantRating } from '../contexts/ListsContext';

export interface NextMeal {
  kind: 'plan' | 'saved' | 'empty' | 'starter' | 'favorite' | 'recipe' | 'discover';
  title: string;
  detail: string;
  action: string;
  href: string;
  image?: string;
  date?: string;
  restaurant?: { id: string; name: string; address: string };
}
/** Stable, useful context: a meal this week, otherwise a saved place the
 * person hasn't rated. Never invent recommendations or rotate while reading. */
export function selectNextMeal(plans: CalendarPlan[], wishlist: WishlistItem[], ratedIds: string[], city: string, now = new Date(), showGettingStarted = false): NextMeal {
  if (showGettingStarted && !plans.length && !wishlist.length && !ratedIds.length) {
    return { kind: 'starter', title: 'Rate your first place', detail: '', action: 'Get started', href: '/create' };
  }
  const next = plans.filter((plan) => plan.status === 'planned' &&
    Date.parse(plan.ends_at) > now.getTime() && Date.parse(plan.starts_at) <= now.getTime() + 7 * 86400000)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id))[0];
  if (next) {
    const start = new Date(next.starts_at);
    const day = start.toDateString() === now.toDateString() ? 'Today' : start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return { kind: 'plan', title: next.title, detail: `${day} · ${time}${next.details.people > 1 ? ` · ${next.details.people} people` : ''}`,
      action: 'View your plan', href: `/calendar?plan=${encodeURIComponent(next.id)}`, date: next.starts_at,
      restaurant: next.kind === 'restaurant' && next.details.restaurant ? { id: next.details.restaurant.id, name: next.title, address: next.details.location } : undefined };
  }
  const rated = new Set(ratedIds);
  const local = (place: WishlistItem) => city && city !== 'Choose your location' && place.address?.toLowerCase().includes(city.toLowerCase()) ? 1 : 0;
  const saved = wishlist.filter((place) => place.restaurantId && place.name?.trim() && !rated.has(place.restaurantId))
    .sort((a, b) => local(b) - local(a) || (b.addedAt || 0) - (a.addedAt || 0) || a.restaurantId.localeCompare(b.restaurantId))[0];
  if (saved) return { kind: 'saved', title: saved.name, detail: ['Saved for later', saved.cuisine, saved.price].filter(Boolean).join(' · '),
    action: 'Take a look', href: `/restaurant/${encodeURIComponent(saved.restaurantId)}`, image: saved.image,
    restaurant: { id: saved.restaurantId, name: saved.name, address: saved.address } };
  return { kind: 'empty', title: 'Start your little shortlist', detail: 'Save the places you want to try next.', action: 'Find a place', href: '/search' };
}

export interface HomeRecipeChoice { title: string; href: string; image?: string; detail: string }
export function homeCardChoices(plans: CalendarPlan[], wishlist: WishlistItem[], ratings: RestaurantRating[], recipes: HomeRecipeChoice[], city: string, now: Date, starter: boolean): NextMeal[] {
  const primary = selectNextMeal(plans, wishlist, ratings.map(r => r.restaurantId), city, now, starter);
  if (primary.kind === 'starter') return [primary];
  const choices: NextMeal[] = primary.kind === 'plan' ? [primary] : [];
  // A topic gets one vote regardless of how many restaurants it contains.
  for (const saved of wishlist.filter(p => !ratings.some(r => r.restaurantId === p.restaurantId))) {
    const card = selectNextMeal([], [saved], [], city, now);
    if (card.kind === 'saved') choices.push(card);
  }
  for (const rating of ratings.filter(r => r.wouldReturn || r.score >= 8.5)) {
    choices.push({ kind: 'favorite', title: rating.name, detail: ['Worth another visit', rating.cuisine].filter(Boolean).join(' · '), action: 'Visit again',
      href: `/restaurant/${encodeURIComponent(rating.restaurantId)}`, image: rating.image || rating.photos?.[0]?.url,
      restaurant: { id: rating.restaurantId, name: rating.name, address: rating.address } });
  }
  for (const recipe of recipes) choices.push({ kind: 'recipe', ...recipe, action: 'Start cooking' });
  // Keep a cooking option available even before someone saves a recipe.
  if (!recipes.length) choices.push({ kind: 'discover', title: 'Something new for dinner', detail: 'Find a recipe for tonight.', action: 'Explore recipes', href: '/recipes-for-you' });
  if (!choices.some(c => c.kind === 'saved' || c.kind === 'favorite' || c.kind === 'plan')) choices.push(primary);
  return [...new Map(choices.map(c => [`${c.kind}:${c.href}`, c])).values()];
}

export interface HomeCardHistory { kind: NextMeal['kind']; href: string }
export function chooseHomeCard(choices: NextMeal[], previous?: HomeCardHistory | null, random = Math.random): NextMeal {
  const topics = [...new Set(choices.map(c => c.kind))];
  const freshTopics = topics.filter(kind => kind !== previous?.kind);
  const pool = freshTopics.length ? freshTopics : topics;
  const kind = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  const candidates = choices.filter(c => c.kind === kind);
  const fresh = candidates.filter(c => c.href !== previous?.href);
  const items = fresh.length ? fresh : candidates;
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// In-memory selections survive route remounts and brief backgrounding. Only
// the previous topic/route goes to disk; Google photo data never does.
export function createHomeCardSession() {
  const selections = new Map<string, NextMeal>();
  return (userId: string, choices: NextMeal[]): NextMeal => {
    const existing = selections.get(userId);
    if (existing) return existing;
    const key = `goodeats:home-card-history:${userId}`;
    let previous: HomeCardHistory | null = null;
    try { previous = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* Storage may be unavailable. */ }
    const selected = chooseHomeCard(choices, previous);
    selections.set(userId, selected);
    try { localStorage.setItem(key, JSON.stringify({ kind: selected.kind, href: selected.href })); } catch { /* In-memory stability still works. */ }
    return selected;
  };
}
export const homeCardForSession = createHomeCardSession();
