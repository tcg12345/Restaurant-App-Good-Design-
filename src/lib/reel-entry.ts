/** Resolve the entry before mounting any media; a focused link must never
 * briefly activate the first (unrelated) video in the feed. */
export function reelEntryKey(items: readonly { key: string }[], focus?: string, lastPost?: string | null): string | null {
  if (focus && items.some(item => item.key === focus)) return focus;
  const saved = lastPost ? `post-${lastPost}` : null;
  if (saved && items.some(item => item.key === saved)) return saved;
  return items[0]?.key ?? null;
}
