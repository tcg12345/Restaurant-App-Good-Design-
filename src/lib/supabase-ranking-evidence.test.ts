// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({ read: vi.fn(), insert: vi.fn(), owners: [] as string[] }));
vi.mock('./supabase', () => ({ supabaseConfigured: true, supabase: { from: () => {
  const query = {
    select: () => query, order: () => query, limit: () => query, gt: () => query,
    eq: (_column: string, owner: string) => { network.owners.push(owner); return query; },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => network.read().then(resolve, reject),
    upsert: network.insert,
  };
  return query;
} } }));
import { flushRankingEvidence, recordRankingEvidence, watchRankingEvidence } from './supabase-ranking-evidence';
import { readEvidence } from './ranking-evidence-store';
const ratings = [{ restaurantId: 'A', score: 8 }, { restaurantId: 'B', score: 7 }];
const stops: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); network.owners.length = 0;
  network.read.mockReset().mockResolvedValue({ data: [], error: null });
  network.insert.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers(); });

it('uploads immutable private records with duplicate-ignore semantics and the captured owner', async () => {
  recordRankingEvidence('alice', ratings, { kind: 'rating', source: 'import', subjectIds: ['A'] });
  expect(network.insert).not.toHaveBeenCalled();
  stops.push(watchRankingEvidence('alice', () => []));
  await flushRankingEvidence('alice');
  expect(network.owners).toEqual(['alice']);
  expect(network.insert).toHaveBeenCalledWith([expect.objectContaining({ user_id: 'alice', event: expect.objectContaining({ source: 'import', order: ['A', 'B'] }) })], { onConflict: 'user_id,id', ignoreDuplicates: true });
  expect(readEvidence(localStorage, 'alice').pendingIds).toEqual([]);
});
it('keeps guest evidence local and does not attach it to a signed-in account', async () => {
  recordRankingEvidence(null, ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'] });
  stops.push(watchRankingEvidence('bob', () => [])); await flushRankingEvidence('bob');
  expect(readEvidence(localStorage, 'guest').events).toHaveLength(1);
  expect(readEvidence(localStorage, 'bob').events).toHaveLength(0); expect(network.insert).not.toHaveBeenCalled();
});
it('an immediate watcher remount retries work cancelled by the prior lifetime', async () => {
  let resolve: (value: unknown) => void = () => {};
  const blockedRead = new Promise(r => { resolve = r; });
  network.read.mockImplementationOnce(() => blockedRead);
  recordRankingEvidence('alice', ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'] });
  const stop = watchRankingEvidence('alice', () => []); stop();
  stops.push(watchRankingEvidence('alice', () => []));
  resolve({ data: [], error: null }); await flushRankingEvidence('alice');
  expect(readEvidence(localStorage, 'alice').pendingIds).toEqual([]);
  expect(network.insert).toHaveBeenCalledTimes(1);
});
