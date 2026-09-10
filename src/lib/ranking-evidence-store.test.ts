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
  const remote = { load: vi.fn(async () => ({ events: [event(3)], cursor: 1, hasMore: false })), insert: vi.fn(async (_owner: string, _events: RankingEvidenceEvent[]) => { if (remote.insert.mock.calls.length === 1) appendEvidence(db, 'alice', event(2)); }) };
  await syncEvidence(db, remote, 'alice');
  expect(readEvidence(db, 'alice').events).toHaveLength(3); expect(readEvidence(db, 'alice').pendingIds).toEqual([]);
  expect(remote.insert).toHaveBeenCalledTimes(2); expect(remote.insert.mock.calls[0][0]).toBe('alice');
});
it('retains pending records on failure and safely retries acknowledgements', async () => {
  const db = storage(); appendEvidence(db, 'alice', event(1));
  const insert = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const remote = { load: async (_owner: string, after: number) => ({ events: [], cursor: after, hasMore: false }), insert };
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
  await syncEvidence(db, { load: async () => { active = false; return { events: [event(1)], cursor: 1, hasMore: false }; }, insert: async () => { throw new Error('Must not upload'); } }, 'alice', () => active);
  expect(db.getItem(evidenceStorageKey('alice'))).toBeNull();
});

it('checkpoints every page and resumes after a later page fails without redownloading earlier history', async () => {
  const db = storage();
  const load = vi.fn().mockResolvedValueOnce({ events: [event(1)], cursor: 7, hasMore: true }).mockRejectedValueOnce(new Error('offline'));
  const remote = { load, insert: vi.fn() };
  await expect(syncEvidence(db, remote, 'alice')).rejects.toThrow('offline');
  expect(readEvidence(db, 'alice')).toMatchObject({ remoteCursor: 7, events: [event(1)] });
  load.mockResolvedValueOnce({ events: [event(2)], cursor: 9, hasMore: false });
  await syncEvidence(db, remote, 'alice');
  expect(load.mock.calls.map(([, cursor]) => cursor)).toEqual([0, 7, 7]);
  expect(readEvidence(db, 'alice').events).toHaveLength(2);
});
it('does not advance the cursor if the received page cannot be written locally', async () => {
  const db = storage(); const write = vi.spyOn(db, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
  const load = vi.fn(async () => ({ events: [event(1)], cursor: 8, hasMore: false }));
  await expect(syncEvidence(db, { load, insert: vi.fn() }, 'alice')).rejects.toThrow('quota');
  expect(readEvidence(db, 'alice').remoteCursor).toBeUndefined();
  write.mockRestore(); await syncEvidence(db, { load, insert: vi.fn() }, 'alice');
  expect(load.mock.calls).toEqual([['alice', 0], ['alice', 0]]);
});
it('does not serialize unchanged history on an empty incremental poll', async () => {
  const db = storage(); appendEvidence(db, 'alice', event(1));
  const remote = { load: vi.fn(async (_owner: string, after: number) => ({ events: [], cursor: after, hasMore: false })), insert: vi.fn() };
  await syncEvidence(db, remote, 'alice');
  const write = vi.spyOn(db, 'setItem'); await syncEvidence(db, remote, 'alice');
  expect(write).not.toHaveBeenCalled();
});
it('retains a save arriving during download and gives the next event all causal heads', async () => {
  const db = storage();
  await syncEvidence(db, { load: async () => { appendEvidence(db, 'alice', event(2)); return { events: [event(1)], cursor: 1, hasMore: false }; }, insert: vi.fn() }, 'alice');
  const next = recordEvidence(db, 'alice', ratings, { kind: 'reorder', source: 'manual-reorder', subjectIds: ['A'] }, 3, id(3));
  expect(next.parentIds).toEqual([id(1), id(2)]);
  expect(readEvidence(db, 'alice').pendingIds).toEqual([id(3)]);
});
it('keeps duplicate-safe uploads pending if local acknowledgement fails', async () => {
  const db = storage(); appendEvidence(db, 'alice', event(1));
  const write = vi.spyOn(db, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
  const remote = { load: async () => ({ events: [], cursor: 0, hasMore: false }), insert: vi.fn() };
  await expect(syncEvidence(db, remote, 'alice')).rejects.toThrow('quota');
  expect(readEvidence(db, 'alice').pendingIds).toEqual([id(1)]);
  write.mockRestore(); await syncEvidence(db, remote, 'alice');
  expect(remote.insert).toHaveBeenCalledTimes(2); expect(readEvidence(db, 'alice').pendingIds).toEqual([]);
});
it('rejects unsafe, backwards, and non-advancing cursors without changing the journal', async () => {
  const db = storage();
  for (const page of [{ events: [], cursor: -1, hasMore: false }, { events: [event(1)], cursor: 0, hasMore: true }, { events: [event(1)], cursor: Number.MAX_SAFE_INTEGER + 1, hasMore: false }]) {
    await expect(syncEvidence(db, { load: async () => page, insert: vi.fn() }, 'alice')).rejects.toThrow('Invalid ranking evidence page');
    expect(db.getItem(evidenceStorageKey('alice'))).toBeNull();
  }
});
