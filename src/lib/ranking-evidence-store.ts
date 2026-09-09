import { isRankingEvidenceEvent, makeRankingEvent, mergeRankingEvents, type OrderedRating, type RankingEvidenceEvent } from './ranking-evidence';

export interface EvidenceJournal {
  version: 1;
  ownerId: string;
  events: RankingEvidenceEvent[];
  pendingIds: string[];
}
export interface EvidenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const evidenceStorageKey = (ownerId: string) => `goodeats-ranking-evidence:${ownerId}`;

export function readEvidence(storage: EvidenceStorage, ownerId: string): EvidenceJournal {
  const empty: EvidenceJournal = { version: 1, ownerId, events: [], pendingIds: [] };
  const value = storage.getItem(evidenceStorageKey(ownerId));
  if (!value) return empty;
  const raw = JSON.parse(value);
  // Never replace unreadable/foreign history with an empty journal.
  if (raw.version !== 1 || raw.ownerId !== ownerId || !Array.isArray(raw.events) || !raw.events.every(isRankingEvidenceEvent) || !Array.isArray(raw.pendingIds) || !raw.pendingIds.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid ranking evidence journal');
  return raw;
}

export function appendEvidence(storage: EvidenceStorage, ownerId: string, event: RankingEvidenceEvent): void {
  if (!isRankingEvidenceEvent(event)) throw new Error('Invalid ranking event');
  const journal = readEvidence(storage, ownerId);
  const next = { ...journal, events: mergeRankingEvents(journal.events, [event]), pendingIds: [...new Set([...journal.pendingIds, event.id])] };
  storage.setItem(evidenceStorageKey(ownerId), JSON.stringify(next));
}

export interface EvidenceRemote {
  load(ownerId: string): Promise<RankingEvidenceEvent[]>;
  insert(ownerId: string, events: RankingEvidenceEvent[]): Promise<void>;
}

/** Load/merge first, then upload immutable records. Reread around every await so
 * same-device saves while the network is in flight cannot disappear. Failed
 * uploads remain pending; duplicate insert retries are safe at the database.
 */
export async function syncEvidence(storage: EvidenceStorage, remote: EvidenceRemote, ownerId: string, isActive = () => true): Promise<void> {
  if (!isActive()) return;
  const cloud = await remote.load(ownerId);
  if (!isActive()) return;
  let local = readEvidence(storage, ownerId);
  storage.setItem(evidenceStorageKey(ownerId), JSON.stringify({ ...local, events: mergeRankingEvents(local.events, cloud) }));
  while (true) {
    if (!isActive()) return;
    local = readEvidence(storage, ownerId);
    const pending = local.events.filter(e => local.pendingIds.includes(e.id)).slice(0, 50);
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
