import { supabase, supabaseConfigured } from './supabase';
import { isRankingEvidenceEvent, type OrderedRating, type RankingEvidenceEvent } from './ranking-evidence';
import { readEvidence, recordEvidence, syncEvidence, type EvidenceRemote } from './ranking-evidence-store';

const remote: EvidenceRemote = {
  async load(ownerId) {
    const events: RankingEvidenceEvent[] = [];
    let cursor: string | undefined;
    while (true) {
      let query = supabase.from('ranking_preference_events').select('id,event').eq('user_id', ownerId).order('id').limit(500);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];
      for (const row of rows) {
        if (!isRankingEvidenceEvent(row.event) || row.event.id !== row.id) throw new Error('Invalid stored preference event');
        events.push(row.event);
      }
      if (rows.length < 500) return events;
      cursor = rows[rows.length - 1].id;
    }
  },
  async insert(ownerId, events) {
    const { error } = await supabase.from('ranking_preference_events').upsert(
      events.map(event => ({ user_id: ownerId, id: event.id, event })),
      { onConflict: 'user_id,id', ignoreDuplicates: true },
    );
    if (error) throw error;
  },
};

const inFlight = new Map<string, { epoch: number; promise: Promise<void> }>();
const activeOwners = new Map<string, number>();
let generation = 0;
/** Uses a captured owner throughout; RLS also rejects a changed auth session. */
export function flushRankingEvidence(ownerId: string): Promise<void> {
  if (!supabaseConfigured || ownerId === 'guest' || !activeOwners.has(ownerId)) return Promise.resolve();
  const epoch = activeOwners.get(ownerId)!;
  const running = inFlight.get(ownerId);
  if (running) return running.epoch === epoch ? running.promise : running.promise.then(() => flushRankingEvidence(ownerId));
  const operation = syncEvidence(localStorage, remote, ownerId, () => activeOwners.get(ownerId) === epoch)
    .catch(error => { console.warn('[Ranking evidence] Sync deferred; local records retained.', error); })
    .finally(() => { inFlight.delete(ownerId); });
  inFlight.set(ownerId, { epoch, promise: operation });
  return operation;
}

/** Recording failure must never change or prevent a user's rating save. */
export function recordRankingEvidence(ownerId: string | null, ratings: OrderedRating[], input: Parameters<typeof recordEvidence>[3]): void {
  const owner = ownerId ?? 'guest';
  try {
    recordEvidence(localStorage, owner, ratings, input);
    void flushRankingEvidence(owner);
  } catch (error) { console.warn('[Ranking evidence] Could not record preference.', error); }
}

/** Retry on reconnect/foreground plus a modest interval for offline recovery.
 * Guest history remains device-local and is never silently assigned to a login.
 */
export function watchRankingEvidence(ownerId: string | null, getRatings: () => OrderedRating[]): () => void {
  let active = true;
  const owner = ownerId ?? 'guest';
  const epoch = ++generation;
  activeOwners.set(owner, epoch);
  const sync = async () => {
    await flushRankingEvidence(owner);
    if (!active) return;
    try {
      const ratings = getRatings();
      if (ratings.length && readEvidence(localStorage, owner).events.length === 0) {
        recordRankingEvidence(ownerId, ratings, { kind: 'snapshot', source: 'legacy', subjectIds: [] });
      }
    } catch (error) { console.warn('[Ranking evidence] Could not read preference journal.', error); }
  };
  const visible = () => { if (document.visibilityState === 'visible') void sync(); };
  void sync();
  window.addEventListener('online', sync); document.addEventListener('visibilitychange', visible);
  const timer = window.setInterval(visible, 60_000);
  return () => {
    active = false;
    if (activeOwners.get(owner) === epoch) activeOwners.delete(owner);
    window.clearInterval(timer); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', visible);
  };
}
