export type HomeAction = 'find' | 'rate' | 'recs' | 'chat' | 'recipes' | 'group';
export type HighlightFamily = 'restaurants' | 'recipes' | 'friends' | 'experts' | 'taste' | 'discover';
export interface HomeHighlight {
  id: string; category: string; family: HighlightFamily;
  eyebrow: string; title: string; detail: string; cta: string; image?: string;
  tone: 'sage' | 'amber' | 'plum'; action?: HomeAction; href?: string;
}
export interface HighlightPlace {
  restaurantId: string; name: string; image?: string; cuisine?: string; address?: string;
  score?: number; wouldReturn?: boolean; createdAt?: number; addedAt?: number; visitDate?: string;
}
export interface HighlightRecipe {
  id: string; title: string; image?: string; href: string; cuisine?: string; minutes?: number; createdAt?: number; visitDate?: string;
}
export interface HighlightPerson { id: string; name: string; username: string; city?: string; followed?: boolean; reason?: string; relevance?: number; expert?: boolean }
export interface HighlightSocial {
  people: HighlightPerson[]; experts: HighlightPerson[]; suggestions?: HighlightPerson[];
  places: (HighlightPlace & { authorId: string; authorName: string; expert: boolean })[];
  recipes: (HighlightRecipe & { authorId?: string; authorName: string; expert: boolean })[];
}
export interface HighlightHistory {
  seen: Record<string, number>;
  clicked: Record<string, number>;
  interests: Record<string, number>;
}
export const emptyHighlightHistory = (): HighlightHistory => ({ seen: {}, clicked: {}, interests: {} });
interface Input {
  userId?: string; city: string; ratings: HighlightPlace[]; wishlist: HighlightPlace[]; recipes: HighlightRecipe[];
  pendingRequestCount?: number; unreadCount?: number;
  social?: HighlightSocial; history?: HighlightHistory; session?: number; now?: Date;
}
function hash(value: string): number {
  return Array.from(value).reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 2166136261);
}
const cuisines = (value = '') => value.split(/[,·/]/).map(s => s.trim().toLowerCase()).filter(Boolean);
const placeHref = (id: string) => `/restaurant/${encodeURIComponent(id)}`;

const DAY = 86400000;
/** An edit/import cannot make an old visit new. Unknown and future dates are
 * ineligible for activity cards; they are never silently treated as today. */
export function highlightActivityAge(createdAt: number | undefined, visitDate: string | undefined, now: Date): number {
  if (!Number.isFinite(createdAt) || createdAt! > now.getTime()) return Infinity;
  let time = createdAt!;
  if (visitDate) {
    const visit = Date.parse(visitDate);
    if (!Number.isFinite(visit) || visit > now.getTime()) return Infinity;
    time = Math.min(time, visit);
  }
  return (now.getTime() - time) / DAY;
}

/** Fresh social evidence comes first. Personal history informs taste, but is
 * never recycled as a news item. With no fresh evidence, offer honest actions. */
export function buildHomeHighlights({ userId, city, ratings: rawRatings, recipes: rawRecipes, social: rawSocial, pendingRequestCount = 0, unreadCount = 0, history = emptyHighlightHistory(), session = 0, now = new Date() }: Input): HomeHighlight[] {
  const ratings = userId ? rawRatings : [], recipes = userId ? rawRecipes : [];
  const social = userId ? rawSocial : undefined;
  const seed = `${userId || 'guest'}:${now.toDateString()}:${Math.floor(now.getHours() / 4)}:${session}`;
  const pool: (HomeHighlight & { weight: number; entity?: string })[] = [];
  const add = (card: HomeHighlight, weight: number, entity?: string) => pool.push({ ...card, weight, entity });
  const rated = new Set(ratings.map(r => r.restaurantId));
  const affinity = new Map<string, number>();
  for (const r of ratings) if (r.wouldReturn !== false && (r.score ?? 0) >= 7.5) {
    for (const c of cuisines(r.cuisine)) affinity.set(c, (affinity.get(c) || 0) + (r.score! - 6));
  }
  const fit = (c?: string) => Math.min(12, cuisines(c).reduce((sum, key) => sum + (affinity.get(key) || 0), 0));
  const local = (address?: string) => city !== 'Choose your location' && !!address?.toLowerCase().includes(city.toLowerCase());
  const age = (p: { createdAt?: number; visitDate?: string }) => highlightActivityAge(p.createdAt, p.visitDate, now);
  const when = (days: number) => days < 1 ? 'today' : days < 2 ? 'yesterday' : `${Math.floor(days)} days ago`;
  const recentPlaces = (social?.places || []).filter(p => p.authorId !== userId && p.name?.trim() && !rated.has(p.restaurantId) && p.wouldReturn !== false && Number.isFinite(p.score) && p.score! >= 8 && p.score! <= 10 && age(p) <= 14);
  for (const p of recentPlaces) {
    add({ id: `social-${p.authorId}-${p.restaurantId}`, category: p.expert ? 'expert-pick' : 'friend-pick', family: p.expert ? 'experts' : 'friends', eyebrow: p.expert ? 'FRESH FROM AN EXPERT' : 'JUST LOVED BY YOUR CIRCLE', title: p.name, detail: `${p.authorName} rated it ${p.score!.toFixed(1)} · ${when(age(p))}`, cta: 'See the place', image: p.image, tone: p.expert ? 'amber' : 'sage', href: placeHref(p.restaurantId) }, (p.expert ? 77 : 88) + fit(p.cuisine) + (14 - age(p)) + (local(p.address) ? 8 : 0), `place:${p.restaurantId}`);
  }
  const together = new Map<string, Map<string, typeof recentPlaces[number]>>();
  for (const p of recentPlaces.filter(p => !p.expert || social?.people.some(person => person.id === p.authorId))) {
    const people = together.get(p.restaurantId) || new Map();
    const previous = people.get(p.authorId);
    if (!previous || age(p) < age(previous)) people.set(p.authorId, p);
    together.set(p.restaurantId, people);
  }
  for (const [id, people] of together) {
    if (people.size < 2) continue;
    const picks = [...people.values()].sort((a,b) => age(a) - age(b) || a.authorId.localeCompare(b.authorId));
    const p = picks[0];
    add({ id: `circle-favorite-${id}`, category: 'circle-favorite', family: 'friends', eyebrow: 'YOUR CIRCLE AGREES', title: p.name, detail: `${people.size} friends rated it 8+ in the last two weeks.`, cta: 'See what they loved', image: p.image, tone: 'sage', href: placeHref(id) }, 114 + fit(p.cuisine) + Math.min(8, people.size), `place:${id}`);
  }
  for (const r of social?.recipes || []) {
    if (!r.authorId || r.authorId === userId || !r.title?.trim() || age(r) > 7) continue;
    add({ id: `social-recipe-${r.id}`, category: 'friend-recipe', family: 'recipes', eyebrow: 'JUST SHARED WITH YOUR CIRCLE', title: r.title, detail: `${r.authorName} shared a recipe · ${when(age(r))}`, cta: 'Try their recipe', image: r.image, tone: 'plum', href: r.href }, 79 + fit(r.cuisine) + (7 - age(r)), `recipe:${r.href}`);
  }
  for (const p of social?.suggestions || []) {
    if (p.id === userId || p.followed || social?.people.some(person => person.id === p.id) || !p.username || !p.name) continue;
    add({ id: `person-${p.id}`, category: 'suggested-person', family: p.expert ? 'experts' : 'friends', eyebrow: p.expert ? 'AN EXPERT TO KNOW' : 'PEOPLE YOU MAY LIKE', title: p.name, detail: p.reason || (local(p.city) ? `Another food lover in ${p.city}.` : 'Get to know their taste. Follow if it feels like a match.'), cta: 'Meet them', tone: 'amber', href: `/user/${encodeURIComponent(p.username)}` }, 90 + Math.min(12, Math.max(0, p.relevance || 0)), `person:${p.id}`);
  }
  const hour = now.getHours(), day = now.getDay(), weekend = day === 0 || day === 6;
  const meal = weekend && hour >= 8 && hour < 14 ? 'brunch' : hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 22 ? 'dinner' : 'a late bite';
  const action = (id: string, family: HighlightFamily, eyebrow: string, title: string, detail: string, cta: string, target: HomeAction | `/${string}`, weight: number) => add({ id, category: id, family, eyebrow, title, detail, cta, tone: family === 'recipes' ? 'plum' : family === 'friends' || family === 'experts' ? 'amber' : 'sage', ...(target.startsWith('/') ? { href: target } : { action: target as HomeAction }) }, weight);
  action('discover', 'discover', city === 'Choose your location' ? 'MAKE A PLAN FOR TODAY' : `EXPLORE ${city.toUpperCase()}`, `A new spot for ${meal}.`, weekend ? 'Make a little room for somewhere new this weekend.' : 'Find a place for your next meal.', 'Find a place', 'find', 46);
  action('recipe-ideas', 'recipes', day === 0 ? 'SET UP YOUR WEEK' : hour >= 16 ? 'STAYING IN TONIGHT?' : 'MAKE SOMETHING GOOD', day === 0 ? 'A little meal inspiration.' : hour >= 16 ? 'Dinner, made by you.' : 'What sounds good to cook?', day === 0 ? 'Find a few recipes for the week ahead.' : 'Explore recipe ideas for your next meal.', 'Find recipe ideas', '/recipes-for-you', 42 + (recipes.length ? 4 : 0));
  if (userId) {
    if (pendingRequestCount > 0) action('requests', 'friends', 'YOUR CIRCLE IS GROWING', pendingRequestCount === 1 ? 'Someone wants to follow you.' : `${pendingRequestCount} people want to follow you.`, 'Review your follow requests and get to know them.', 'Review requests', '/circle', 116);
    if (unreadCount > 0) action('messages', 'friends', 'A CONVERSATION TO CATCH UP ON', 'Your people have something to say.', 'Open your unread messages and pick up where you left off.', 'Open messages', '/messages', 86);
    if (social?.people.length) action('together', 'friends', weekend ? 'MAKE A WEEKEND PLAN' : 'DINNER WITH YOUR PEOPLE', 'Where should we all eat?', 'Start a room, invite your people, and find a place together.', 'Decide together', 'group', hour >= 15 && hour < 21 ? 54 : 36);
    else action('find-friends', 'friends', 'BUILD YOUR CIRCLE', 'Good meals start with good people.', 'Find friends and follow the tastes you trust.', 'Find your people', '/circle', 45);
    if (ratings.length >= 3) {
      action('personal-picks', 'restaurants', 'FIND YOUR NEXT FAVORITE', 'Something a little more you.', 'Explore restaurant recommendations shaped by your ratings.', 'Find my next place', 'recs', 49);
      const recentRatings = new Set(ratings.filter(r => age(r) <= 7).map(r => r.restaurantId));
      if (recentRatings.size >= 3) action('make-guide', 'taste', 'A WEEK WORTH SHARING', 'Turn your finds into a guide.', `You rated ${recentRatings.size} places this week. Bring your favorites together.`, 'Create a guide', '/create', 56);
    } else action('first-ratings', 'taste', 'MAKE GOODEATS YOURS', 'Start with a place you love.', 'Your ratings help shape your recommendations.', 'Rate a place', 'rate', 52);
    action('ask-ai', 'discover', hour >= 22 ? 'A LATE-NIGHT CRAVING?' : 'LET’S NARROW IT DOWN', hour >= 22 ? 'Find your next bite.' : 'In the mood for something specific?', 'Tell AI your craving, budget, and who’s coming.', 'Ask AI', 'chat', 40);
    action('cook', 'recipes', 'USE WHAT YOU HAVE', 'What’s in your kitchen?', 'Start with your ingredients and build a recipe around them.', 'Make something', 'recipes', 35);
  }
  const scored = pool.map(card => {
    const seenAge = (now.getTime() - (history.seen[card.id] || 0)) / 3600000;
    const clickAge = (now.getTime() - (history.clicked[card.id] || 0)) / 3600000;
    const repeatPenalty = seenAge < 4 ? 34 : seenAge < 24 ? 20 : seenAge < 72 ? 8 : 0;
    const interest = Math.min(10, history.interests[card.family] || 0);
    return { ...card, rank: card.weight + (hash(`${seed}:${card.id}`) % 600) / 100 + interest - repeatPenalty - (clickAge < 24 ? 30 : 0) };
  }).sort((a,b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const selected: HomeHighlight[] = [], categories = new Set<string>(), entities = new Set<string>(), families = new Map<string, number>();
  for (const card of scored) {
    if (selected.length === 6) break;
    if (categories.has(card.category) || (families.get(card.family) || 0) >= 2 || (card.entity && entities.has(card.entity))) continue;
    const { weight: _weight, rank: _rank, entity, ...item } = card;
    selected.push(item); categories.add(card.category); if (entity) entities.add(entity);
    families.set(card.family, (families.get(card.family) || 0) + 1);
  }
  return selected;
}

const historyKey = (userId: string) => `goodeats:home-highlights:v2:${userId}`;
export function readHighlightHistory(userId?: string): HighlightHistory {
  if (!userId) return emptyHighlightHistory();
  try {
    const raw = JSON.parse(localStorage.getItem(historyKey(userId)) || 'null');
    if (!raw || typeof raw !== 'object') return emptyHighlightHistory();
    const valid = (value: unknown): Record<string, number> => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n >= 0));
    return { seen: valid(raw.seen), clicked: valid(raw.clicked), interests: valid(raw.interests) };
  } catch { return emptyHighlightHistory(); }
}
export function recordHighlight(userId: string | undefined, item: HomeHighlight, event: 'seen' | 'clicked', now = Date.now()): void {
  if (!userId) return;
  const history = readHighlightHistory(userId);
  history[event][item.id] = now;
  if (event === 'clicked') history.interests[item.family] = Math.min(10, (history.interests[item.family] || 0) + 2);
  // Bounded, device-local exposure memory. Never store names, photos or notes.
  for (const kind of ['seen', 'clicked'] as const) history[kind] = Object.fromEntries(Object.entries(history[kind]).filter(([, t]) => now - t < 14 * 86400000).sort((a,b) => b[1] - a[1]).slice(0, 150));
  try { localStorage.setItem(historyKey(userId), JSON.stringify(history)); } catch { /* Storage is optional. */ }
}

export function resetHighlightHistory(userId: string): void {
  try { localStorage.removeItem(historyKey(userId)); } catch { return; }
  window.dispatchEvent(new Event('goodeats:reset-home-personalization'));
}
