import { isRankingEvidenceEvent, makeRankingEvent, mergeRankingEvents, type OrderedRating, type RankingEvidenceEvent } from './ranking-evidence';

export interface EvidenceJournal {
  version: 1;
  ownerId: string;
  events: RankingEvidenceEvent[];
  pendingIds: string[];
  /** Persisted atomically with received events; absent on old journals. */
  remoteCursor?: number;
}
export interface EvidenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const evidenceStorageKey = (ownerId: string) => `goodeats-ranking-evidence:${ownerId}`;

export function readEvidence(storage: EvidenceStorage, ownerId: string): EvidenceJournal {
  const empty: EvidenceJournal = { version: 1, ownerId, events: [], pendingIds: [] };
  const value = storage.getItem(evidenceStorageKey(ownerId));
  if (!value) return empty;
  const raw = JSON.parse(value);
  // Never replace unreadable/foreign history with an empty journal.
  if (raw.version !== 1 || raw.ownerId !== ownerId || !Array.isArray(raw.events) || !raw.events.every(isRankingEvidenceEvent) || !Array.isArray(raw.pendingIds) || !raw.pendingIds.every((id: unknown) => typeof id === 'string') || (raw.remoteCursor !== undefined && (!Number.isSafeInteger(raw.remoteCursor) || raw.remoteCursor < 0))) throw new Error('Invalid ranking evidence journal');
  return raw;
}

export function appendEvidence(storage: EvidenceStorage, ownerId: string, event: RankingEvidenceEvent): void {
  if (!isRankingEvidenceEvent(event)) throw new Error('Invalid ranking event');
  const journal = readEvidence(storage, ownerId);
  const next = { ...journal, events: mergeRankingEvents(journal.events, [event]), pendingIds: [...new Set([...journal.pendingIds, event.id])] };
  storage.setItem(evidenceStorageKey(ownerId), JSON.stringify(next));
}

export interface EvidencePage {
  events: RankingEvidenceEvent[];
  cursor: number;
  hasMore: boolean;
}
export interface EvidenceRemote {
  load(ownerId: string, after: number): Promise<EvidencePage>;
  insert(ownerId: string, events: RankingEvidenceEvent[]): Promise<void>;
}

/** Checkpoint each received page with its cursor in one local write. An empty
 * incremental check does not rewrite the growing journal. Reread after every
 * await so concurrent local saves cannot disappear. Immutable inserts can be
 * retried if the network or local acknowledgement fails.
 */
export async function syncEvidence(storage: EvidenceStorage, remote: EvidenceRemote, ownerId: string, isActive = () => true): Promise<void> {
  while (isActive()) {
    const before = readEvidence(storage, ownerId).remoteCursor ?? 0;
    const page = await remote.load(ownerId, before);
    if (!isActive()) return;
    if (!Number.isSafeInteger(page.cursor) || page.cursor < before
      || ((page.events.length > 0 || page.hasMore) && page.cursor <= before)
      || !page.events.every(isRankingEvidenceEvent)) throw new Error('Invalid ranking evidence page');
    if (page.events.length || page.cursor !== before) {
      const local = readEvidence(storage, ownerId);
      storage.setItem(evidenceStorageKey(ownerId), JSON.stringify({
        ...local, events: mergeRankingEvents(local.events, page.events), remoteCursor: page.cursor,
      }));
    }
    if (!page.hasMore) break;
  }
  while (isActive()) {
    let local = readEvidence(storage, ownerId);
    if (!local.pendingIds.length) return;
    const pendingIds = new Set(local.pendingIds);
    const pending = local.events.filter(e => pendingIds.has(e.id)).slice(0, 50);
    if (!pending.length) return;
    await remote.insert(ownerId, pending);
    if (!isActive()) return;
    const acknowledged = new Set(pending.map(e => e.id));
    local = readEvidence(storage, ownerId);
    storage.setItem(evidenceStorageKey(ownerId), JSON.stringify({ ...local, pendingIds: local.pendingIds.filter(id => !acknowledged.has(id)) }));
  }
}

export function recordEvidence(
  storage: EvidenceStorage, ownerId: string, ratings: OrderedRating[],
  input: Parameters<typeof makeRankingEvent>[2], now?: number, id?: string,
): RankingEvidenceEvent {
  const event = makeRankingEvent(readEvidence(storage, ownerId).events, ratings, input, now, id);
  appendEvidence(storage, ownerId, event);
  return event;
}
