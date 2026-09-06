import type { FeedEntry } from './feedEntry';

export type FeedLens = 'latest' | 'highlights' | 'saved';

/** Narrow only the viewer's loaded, authorized feed; never invent popularity. */
export function selectFeedEntries(entries: FeedEntry[], lens: FeedLens, isSaved: (entry: FeedEntry) => boolean): FeedEntry[] {
  if (lens === 'saved') return entries.filter(isSaved);
  if (lens === 'highlights') return entries
    .filter(e => !e.selfScored && typeof e.score === 'number' && e.score >= 8)
    .sort((a, b) => (b.score! - a.score!) || b.sortTime - a.sortTime || a.key.localeCompare(b.key));
  return entries;
}

/** One dish per post, capped per author so a prolific friend cannot fill the rail. */
export function feedDishPreview(entries: FeedEntry[]) {
  const authors = new Map<string, number>();
  return entries.flatMap(entry => {
    const shot = entry.media.find(m => m.kind === 'photo' && m.url && m.caption?.trim());
    if (!shot || (authors.get(entry.authorId) ?? 0) >= 2) return [];
    authors.set(entry.authorId, (authors.get(entry.authorId) ?? 0) + 1);
    return [{ key: entry.key, authorId: entry.authorId, url: shot.url, dish: shot.caption!.trim(), place: entry.restaurant?.name }];
  }).slice(0, 8);
}
