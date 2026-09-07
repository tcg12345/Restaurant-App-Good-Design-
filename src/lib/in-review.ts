import type { RestaurantRating, HomeMeal, WishlistItem, LocalVisitRecord } from '../contexts/ListsContext';
import type { Recipe } from './supabase-recipes';
import type { TasteProfile } from './recommendations';
import type { TasteBenchmarks } from './taste-insights';
import { cuisineTokens, cityToken } from './taste-tier';

export type ReviewKind = 'week' | 'month' | 'year';
export interface ReviewPeriod { id: string; kind: ReviewKind; start: string; end: string; label: string }
export interface ReviewInput {
  ratings: RestaurantRating[]; meals: HomeMeal[]; recipes: Recipe[]; wishlist: WishlistItem[];
  history: Record<string, LocalVisitRecord[]>; scoresUnlocked: boolean;
}
export interface ReviewSnapshot {
  version: 1; period: ReviewPeriod; generatedAt: string;
  visits: number; places: number; meals: number; recipes: number; saved: number; companions: number;
  cuisines: { name: string; count: number }[]; newCuisines: string[]; cities: string[];
  favorite: { name: string; cuisine: string; score: number | null } | null;
  cookingFavorite: string | null; returnCount: number; avgScore: number | null;
  timeline: { label: string; count: number }[]; previous: { visits: number; meals: number };
  taste: { anchor: number | null; priceShare: number[]; priceConcentration: number | null; distinctive: number | null; michelin: { recognized: number; loved: number } | null };
  community: { users: number; average: number | null; grading: number | null; breadth: number | null; distinctive: number | null; capturedAt: string } | null;
}
export interface ReviewArchive { version: 1; ownerId: string; reviews: ReviewSnapshot[]; seen: string[]; autoReveal: boolean; preferenceUpdatedAt?: number }
export const REVIEW_META_KEY = '__goodeats_in_review_v1__';
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function dateOf(key: string): Date { return new Date(`${key}T12:00:00`); }
export function validDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateOf(value).getTime()) && dayKey(dateOf(value)) === value;
}
/** Visit dates win over edit/import timestamps. Invalid and future dates never become activity. */
export function activityDay(value: string | undefined, created: number | string | undefined): string | null {
  if (value) return validDay(value) ? value : null;
  const d = new Date(created ?? NaN);
  return Number.isFinite(d.getTime()) ? dayKey(d) : null;
}
export function periodContaining(kind: ReviewKind, date: Date): ReviewPeriod {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  if (kind === 'year') start.setMonth(0, 1);
  if (kind === 'month') start.setDate(1);
  if (kind === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const end = new Date(start);
  if (kind === 'year') end.setFullYear(end.getFullYear() + 1);
  if (kind === 'month') end.setMonth(end.getMonth() + 1);
  if (kind === 'week') end.setDate(end.getDate() + 7);
  const last = new Date(end); last.setDate(last.getDate() - 1);
  const format = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const label = kind === 'year' ? String(start.getFullYear()) : kind === 'month' ? start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : `${format(start)} – ${format(last)}, ${last.getFullYear()}`;
  return { id: `${kind}:${dayKey(start)}`, kind, start: dayKey(start), end: dayKey(end), label };
}
export function previousPeriod(kind: ReviewKind, now = new Date()): ReviewPeriod {
  const d = dateOf(periodContaining(kind, now).start); d.setDate(d.getDate() - 1);
  return periodContaining(kind, d);
}
export function reviewEvents(input: ReviewInput) {
  const map = new Map<string, { rating: RestaurantRating; day: string }>();
  for (const current of input.ratings) {
    for (const old of input.history[current.restaurantId] ?? []) {
      const day = activityDay(old.visit_date, old.created_at);
      if (day) map.set(`${current.restaurantId}:${day}`, { day, rating: { ...current, score: old.score, wouldReturn: old.would_return, friendIds: old.friend_ids ?? [], createdAt: Date.parse(old.created_at), visitDate: day } });
    }
    const day = activityDay(current.visitDate, current.createdAt);
    if (day) map.set(`${current.restaurantId}:${day}`, { day, rating: current });
  }
  return [...map.values()];
}
export function availableReviewPeriods(input: ReviewInput, now = new Date()): ReviewPeriod[] {
  const today = dayKey(now);
  const days = [ ...reviewEvents(input).map(e => e.day), ...input.meals.map(m => activityDay(m.date, m.createdAt)), ...input.recipes.map(r => activityDay(undefined, r.createdAt)), ...input.wishlist.map(w => activityDay(undefined, w.addedAt)) ];
  const periods = new Map<string, ReviewPeriod>();
  for (const day of days) {
    if (!day || day > today || day < '1970-01-01') continue;
    for (const kind of ['week', 'month', 'year'] as const) {
      const period = periodContaining(kind, dateOf(day));
      if (period.end <= today) periods.set(period.id, period);
    }
  }
  return [...periods.values()].sort((a,b) => b.end.localeCompare(a.end) || ({ year: 0, month: 1, week: 2 }[a.kind] - { year: 0, month: 1, week: 2 }[b.kind]));
}
export function eligibleAutoReview(reviews: ReviewSnapshot[], seen: string[], now = new Date()): ReviewSnapshot | undefined {
  for (const kind of ['year', 'month', 'week'] as const) {
    const id = previousPeriod(kind, now).id;
    const review = reviews.find(r => r.period.id === id && !seen.includes(id));
    if (review) return review;
  }
}
const human = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());
export function buildReview(period: ReviewPeriod, input: ReviewInput, taste?: TasteProfile, benchmark?: TasteBenchmarks | null, now = new Date()): ReviewSnapshot {
  const inside = (day: string | null) => !!day && day >= period.start && day < period.end && day <= dayKey(now);
  const all = reviewEvents(input);
  const events = all.filter(e => inside(e.day));
  const unique = [...new Map(events.sort((a,b) => a.day.localeCompare(b.day)).map(e => [e.rating.restaurantId, e.rating])).values()];
  const scored = unique.filter(r => r.ratingMethod !== 'slider' && Number.isFinite(r.score) && r.score > 0 && r.score <= 10);
  const meals = input.meals.filter(m => inside(activityDay(m.date, m.createdAt)));
  const recipes = input.recipes.filter(r => !r.linkedMealId && inside(activityDay(undefined, r.createdAt)));
  const cuisines = new Map<string, number>();
  for (const r of unique) for (const c of new Set(cuisineTokens(r.cuisine))) cuisines.set(c, (cuisines.get(c) ?? 0) + 1);
  const previousCuisines = new Set(all.filter(e => e.day < period.start).flatMap(e => cuisineTokens(e.rating.cuisine)));
  const top = [...scored].sort((a,b) => b.score - a.score || a.name.localeCompare(b.name))[0];
  const prev = previousPeriod(period.kind, dateOf(period.start));
  const prior = (day: string | null) => !!day && day >= prev.start && day < prev.end;
  const eventDays = [...events.map(e => e.day), ...meals.map(m => activityDay(m.date, m.createdAt)!), ...recipes.map(r => activityDay(undefined, r.createdAt)!)];
  const timeline = period.kind === 'year' ? Array.from({ length: 12 }, (_, i) => ({ label: new Date(2000,i,1).toLocaleDateString('en-US',{month:'short'}), count: eventDays.filter(d => Number(d.slice(5,7)) === i + 1).length }))
    : Array.from({ length: period.kind === 'week' ? 7 : 4 }, (_, i) => ({ label: period.kind === 'week' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i] : `${i*8+1}–${i===3 ? new Date(dateOf(period.end).getTime()-86400000).getDate() : (i+1)*8}`, count: eventDays.filter(d => period.kind === 'week' ? (dateOf(d).getDay()+6)%7 === i : Math.min(3, Math.floor((Number(d.slice(8))-1)/8)) === i).length }));
  // Existing benchmark RPC describes ALL-TIME published history, not this period.
  // Small cohorts do not support meaningful percentiles. Never invent rankings.
  const b = benchmark && benchmark.rankedUsers >= 20 ? benchmark : null;
  const pct = (n: number | null) => n != null && Number.isFinite(n) ? Math.round(Math.max(0,Math.min(1,n))*100) : null;
  const mt = taste?.michelinTaste;
  const loved = scored.filter(r => r.score >= (taste?.anchor ?? 7)).length;
  return {
    version: 1, period, generatedAt: now.toISOString(), visits: events.length, places: unique.length, meals: meals.length, recipes: recipes.length,
    saved: input.wishlist.filter(w => inside(activityDay(undefined,w.addedAt))).length,
    companions: new Set(events.flatMap(e => e.rating.friendIds ?? [])).size,
    cuisines: [...cuisines].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([name,count]) => ({name:human(name),count})),
    newCuisines: [...cuisines.keys()].filter(c => !previousCuisines.has(c)).map(human),
    cities: [...new Set(unique.map(r => cityToken(r.address)).filter((s): s is string => !!s))].map(human),
    favorite: top ? { name: top.name, cuisine: top.cuisine, score: input.scoresUnlocked ? top.score : null } : null,
    cookingFavorite: [...meals].sort((a,b) => b.score-a.score)[0]?.name ?? recipes[0]?.title ?? null,
    returnCount: unique.filter(r => r.wouldReturn).length,
    avgScore: input.scoresUnlocked && scored.length >= 3 ? scored.reduce((s,r) => s+r.score,0)/scored.length : null,
    timeline, previous: { visits: all.filter(e => prior(e.day)).length, meals: input.meals.filter(m => prior(activityDay(m.date,m.createdAt))).length },
    taste: { anchor: input.scoresUnlocked && scored.length >= 3 ? taste?.anchor ?? null : null, priceShare: taste?.priceDist?.share ?? [], priceConcentration: taste?.priceDist?.concentration ?? null, distinctive: taste?.distinctiveTaste ?? null,
      michelin: mt && loved > 0 ? { recognized: Math.min(loved,Math.round((mt.starShare+mt.bibShare+mt.selectedShare)*loved)), loved } : null },
    community: b ? { users:b.rankedUsers, average:b.platformAvgScore, grading:pct(b.gradingPercentile), breadth:pct(b.breadthPercentile), distinctive:pct(b.distinctivePercentile), capturedAt:now.toISOString() } : null,
  };
}
function isSnapshot(r: ReviewSnapshot): boolean {
  const count=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const optional=(n:unknown)=>n===null||count(n);
  const strings=(a:unknown)=>Array.isArray(a)&&a.every(s=>typeof s==='string');
  return !!r && r.version===1 && !!r.period && ['week','month','year'].includes(r.period.kind)
    && validDay(r.period.start)&&validDay(r.period.end)&&r.period.start<r.period.end
    && r.period.id===`${r.period.kind}:${r.period.start}`&&typeof r.period.label==='string'
    && Number.isFinite(Date.parse(r.generatedAt))
    && [r.visits,r.places,r.meals,r.recipes,r.saved,r.companions,r.returnCount].every(count)
    && Array.isArray(r.cuisines)&&r.cuisines.every(c=>c&&typeof c.name==='string'&&count(c.count))
    && strings(r.newCuisines)&&strings(r.cities)
    && Array.isArray(r.timeline)&&r.timeline.every(t=>t&&typeof t.label==='string'&&count(t.count))
    && !!r.taste&&Array.isArray(r.taste.priceShare)&&r.taste.priceShare.every(count)
    && optional(r.avgScore)&&optional(r.taste.anchor)&&optional(r.taste.priceConcentration)&&optional(r.taste.distinctive)
    && (r.taste.michelin===null||!!r.taste.michelin&&count(r.taste.michelin.recognized)&&count(r.taste.michelin.loved))
    && (r.community===null||!!r.community&&count(r.community.users)&&optional(r.community.average)&&optional(r.community.grading)&&optional(r.community.breadth)&&optional(r.community.distinctive)&&Number.isFinite(Date.parse(r.community.capturedAt)))
    && !!r.previous&&count(r.previous.visits)&&count(r.previous.meals)
    && (r.favorite===null||!!r.favorite&&typeof r.favorite.name==='string'&&typeof r.favorite.cuisine==='string'&&(r.favorite.score===null||count(r.favorite.score)))
    && (r.cookingFavorite===null||typeof r.cookingFavorite==='string');
}
export function readReviewArchive(raw: unknown, ownerId: string): ReviewArchive {
  const empty: ReviewArchive = { version:1, ownerId, reviews:[], seen:[], autoReveal:true };
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as ReviewArchive;
  if (o.version !== 1 || o.ownerId !== ownerId) return empty;
  return { ...empty, preferenceUpdatedAt:Number.isFinite(o.preferenceUpdatedAt) ? o.preferenceUpdatedAt : 0, autoReveal:o.autoReveal !== false, seen:Array.isArray(o.seen) ? o.seen.filter(s => typeof s === 'string') : [],
    reviews:Array.isArray(o.reviews) ? o.reviews.filter(isSnapshot) : [] };
}

/** Union independent device archives without rewriting the first saved story. */
export function mergeReviewArchives(local: unknown, remote: unknown, ownerId: string): ReviewArchive {
  const a=readReviewArchive(local,ownerId), b=readReviewArchive(remote,ownerId);
  const byId=new Map<string,ReviewSnapshot>();
  for(const review of [...a.reviews,...b.reviews]) {
    const old=byId.get(review.period.id);
    if(!old || review.generatedAt < old.generatedAt) byId.set(review.period.id,review);
  }
  const preference=(a.preferenceUpdatedAt??0)>(b.preferenceUpdatedAt??0)?a:b;
  return {...preference,reviews:[...byId.values()].sort((x,y)=>y.period.end.localeCompare(x.period.end)),seen:[...new Set([...a.seen,...b.seen])]};
}
