import { expect, it, vi } from 'vitest';
import { appendEvidence, evidenceStorageKey, readEvidence, recordEvidence, syncEvidence, type EvidenceStorage } from './ranking-evidence-store';
import { makeRankingEvent, type RankingEvidenceEvent } from './ranking-evidence';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ratings = [{ restaurantId: 'A', score: 8 }, { restaurantId: 'B', score: 7 }];
const event = (n: number) => makeRankingEvent([], ratings, { kind: 'rating', source: 'import', subjectIds: ['A'] }, n, id(n));
function storage(): EvidenceStorage {
  const values = new Map<string, string>();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } };
}
it('persists across reads, isolates accounts/guests, and serializes same-tick saves', () => {
  const db = storage();
  recordEvidence(db, 'alice', ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'] }, 1, id(1));
  recordEvidence(db, 'alice', ratings, { kind: 'rating', source: 'import', subjectIds: ['B'] }, 2, id(2));
  expect(readEvidence(db, 'alice').events[1].parentIds).toEqual([id(1)]);
  expect(readEvidence(db, 'bob').events).toEqual([]); expect(readEvidence(db, 'guest').events).toEqual([]);
});
it('merges cloud events and preserves saves arriving during upload', async () => {
  const db = storage(); appendEvidence(db, 'alice', event(1));
  const remote = { load: vi.fn(async () => [event(3)]), insert: vi.fn(async (_owner: string, _events: RankingEvidenceEvent[]) => { if (remote.insert.mock.calls.length === 1) appendEvidence(db, 'alice', event(2)); }) };
  await syncEvidence(db, remote, 'alice');
  expect(readEvidence(db, 'alice').events).toHaveLength(3); expect(readEvidence(db, 'alice').pendingIds).toEqual([]);
  expect(remote.insert).toHaveBeenCalledTimes(2); expect(remote.insert.mock.calls[0][0]).toBe('alice');
});
it('retains pending records on failure and safely retries acknowledgements', async () => {
  const db = storage(); appendEvidence(db, 'alice', event(1));
  const insert = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const remote = { load: async () => [], insert };
  await expect(syncEvidence(db, remote, 'alice')).rejects.toThrow('offline');
  expect(readEvidence(db, 'alice').pendingIds).toEqual([id(1)]);
  await syncEvidence(db, remote, 'alice');
  expect(readEvidence(db, 'alice').events).toHaveLength(1); expect(readEvidence(db, 'alice').pendingIds).toEqual([]);
});
it('never erases an unreadable or foreign journal', () => {
  const db = storage(); db.setItem(evidenceStorageKey('alice'), '{bad');
  expect(() => appendEvidence(db, 'alice', event(1))).toThrow(); expect(db.getItem(evidenceStorageKey('alice'))).toBe('{bad');
  db.setItem(evidenceStorageKey('alice'), JSON.stringify({ version: 1, ownerId: 'bob', events: [], pendingIds: [] }));
  expect(() => appendEvidence(db, 'alice', event(1))).toThrow('Invalid ranking');
});

it('does not restore cleared local history after an account switch during a network request', async () => {
  const db = storage(); let active = true;
  await syncEvidence(db, { load: async () => { active = false; return [event(1)]; }, insert: async () => { throw new Error('Must not upload'); } }, 'alice', () => active);
  expect(db.getItem(evidenceStorageKey('alice'))).toBeNull();
});
