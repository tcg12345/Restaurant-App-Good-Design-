/** Fetch a bounded set of extra searches/pages only when filtering left a short deck. */
export async function fillShortlist<T>(options: {
  count: number;
  candidates: () => T[];
  next: () => (() => Promise<void>) | undefined;
  maxRequests?: number;
  deadline: number;
}): Promise<T[]> {
  let attempts = 0;
  while (options.candidates().length < options.count && attempts < (options.maxRequests ?? 8) && Date.now() < options.deadline) {
    const jobs: (() => Promise<void>)[] = [];
    while (jobs.length < 4 && attempts < (options.maxRequests ?? 8)) {
      const job = options.next();
      if (!job) break;
      jobs.push(job); attempts++;
    }
    if (!jobs.length) break;
    // One unavailable page must not discard successful results from other searches.
    await Promise.allSettled(jobs.map(job => job()));
  }
  const candidates = options.candidates();
  if (candidates.length < options.count) {
    throw Error(`Found ${candidates.length} of ${options.count} matching places. Widen the search area, adjust your budget, or choose fewer places.`);
  }
  return candidates;
}
