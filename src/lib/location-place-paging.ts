import type { QueryCursor } from './location-place-cache';
import type { SearchPageResult } from './places';

/** Checkpoint only successful pages, together with their results. Failed
 * cursors remain retryable; input cursors never change behind the caller. */
export async function fetchPlaceCursorBatch(
  cursors: QueryCursor[],
  batchSize: number,
  load: (cursor: QueryCursor) => Promise<SearchPageResult>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const next = cursors.map(cursor => ({ ...cursor }));
  const indices = next.flatMap((cursor, index) => cursor.drained ? [] : [index]).slice(0, batchSize);
  const outcomes = await Promise.allSettled(indices.map(index => load({ ...next[index] })));
  signal.throwIfAborted();
  const pages: SearchPageResult['places'][] = [];
  let failed = false;
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') { failed = true; return; }
    const page = outcome.value;
    next[indices[i]] = { ...next[indices[i]], pageToken: page.nextPageToken || undefined, drained: !page.nextPageToken };
    pages.push(page.places);
  });
  return { cursors: next, pages, failed, exhausted: next.every(cursor => cursor.drained) };
}
