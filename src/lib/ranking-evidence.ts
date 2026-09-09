/** Private observations for future ranking research. Never used to calculate a score. */
export type PreferenceSource = 'h2h' | 'slider' | 'import' | 'manual-reorder' | 'score-edit' | 'system' | 'legacy';
export interface PreferenceComparison {
  restaurantId: string;
  comparisonId: string;
  outcome: 'preferred' | 'not-preferred' | 'tie' | 'skip';
  answeredAt: number;
}
export interface PreferenceDraft {
  source: 'h2h' | 'slider';
  comparisons: PreferenceComparison[];
}
export interface RankingEvidenceEvent {
  version: 1;
  id: string;
  capturedAt: number;
  kind: 'rating' | 'reorder' | 'delete' | 'snapshot';
  source: PreferenceSource;
  /** Causal snapshot versions replaced by this observation, not extra votes. */
  parentIds: string[];
  /** A fresh judgment invalidates older comparisons involving these restaurants. */
  subjectIds: string[];
  comparisons: PreferenceComparison[];
  /** Exact saved display order, independent of score magnitude. Not pairwise evidence. */
  order: string[];
  orderBasis: 'persisted-score-order';
  /** The actual placement/reorder instruction, when one was supplied. */
  explicitOrder?: string[];
}

export interface OrderedRating { restaurantId: string; score: number }
const sources: PreferenceSource[] = ['h2h', 'slider', 'import', 'manual-reorder', 'score-edit', 'system', 'legacy'];
const ids = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0) && new Set(x).size === x.length;
const time = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

export function isRankingEvidenceEvent(raw: unknown): raw is RankingEvidenceEvent {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as RankingEvidenceEvent;
  return e.version === 1 && uuid(e.id) && time(e.capturedAt)
    && ['rating', 'reorder', 'delete', 'snapshot'].includes(e.kind) && sources.includes(e.source)
    && ids(e.parentIds) && e.parentIds.every(uuid) && !e.parentIds.includes(e.id)
    && ids(e.subjectIds) && ids(e.order) && e.orderBasis === 'persisted-score-order'
    && (e.explicitOrder === undefined || ids(e.explicitOrder))
    && Array.isArray(e.comparisons) && e.comparisons.every(c => c && typeof c.restaurantId === 'string' && !!c.restaurantId
      && typeof c.comparisonId === 'string' && !!c.comparisonId && c.restaurantId !== c.comparisonId
      && ['preferred', 'not-preferred', 'tie', 'skip'].includes(c.outcome) && time(c.answeredAt));
}

/** Same sorting as the saved rating ladder; exact numeric ties retain input order. */
export function savedRankingOrder(ratings: OrderedRating[]): string[] {
  return [...ratings].sort((a, b) => b.score - a.score).map(r => r.restaurantId);
}

export function mergeRankingEvents(...sets: readonly RankingEvidenceEvent[][]): RankingEvidenceEvent[] {
  const byId = new Map<string, RankingEvidenceEvent>();
  for (const set of sets) for (const event of set) if (isRankingEvidenceEvent(event)) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));
}

export function rankingHeads(events: RankingEvidenceEvent[]): string[] {
  const parents = new Set(events.flatMap(e => e.parentIds));
  return events.filter(e => !parents.has(e.id)).map(e => e.id).sort();
}

export function makeRankingEvent(
  events: RankingEvidenceEvent[], ratings: OrderedRating[],
  input: Pick<RankingEvidenceEvent, 'kind' | 'source' | 'subjectIds'> & Partial<Pick<RankingEvidenceEvent, 'comparisons' | 'explicitOrder'>>,
  now = Date.now(), id: string = crypto.randomUUID(),
): RankingEvidenceEvent {
  return {
    version: 1, id, capturedAt: now, parentIds: rankingHeads(events), ...input,
    subjectIds: [...new Set(input.subjectIds)], comparisons: input.comparisons?.map(c => ({ ...c })) ?? [],
    order: savedRankingOrder(ratings), orderBasis: 'persisted-score-order',
    ...(input.explicitOrder ? { explicitOrder: [...input.explicitOrder] } : {}),
  };
}

/** Timestamp UI history without modifying the head-to-head algorithm or undo state. */
export function stampComparisonStep<T extends { history: Array<{ answeredAt?: number }> }>(state: T, now = Date.now()): T {
  if (!state.history.length) return state;
  return { ...state, history: state.history.map((step, i) => i === state.history.length - 1 ? { ...step, answeredAt: now } : step) };
}

export function comparisonDraft(
  restaurantId: string, source: PreferenceDraft['source'],
  history: Array<{ kind: 'choice' | 'tie' | 'skip'; pickedNew?: boolean; comparisonId: string; answeredAt?: number }>,
): PreferenceDraft {
  return { source, comparisons: history.filter(s => time(s.answeredAt)).map(s => ({
    restaurantId, comparisonId: s.comparisonId, answeredAt: s.answeredAt!,
    outcome: s.kind === 'choice' ? (s.pickedNew ? 'preferred' : 'not-preferred') : s.kind,
  })) };
}

/** Research export helper. A skip is never a loss; concurrent branches stay ambiguous.
 * New judgments supersede only comparisons involving the affected restaurants.
 * Parent links, rather than client clocks, establish causal supersession.
 */
export function resolveRankingEvidence(raw: RankingEvidenceEvent[], currentIds?: string[]) {
  const events = mergeRankingEvents(raw), byId = new Map(events.map(e => [e.id, e]));
  const ancestors = new Map<string, Set<string>>();
  for (const event of events) {
    const seen = new Set<string>(), todo = [...event.parentIds];
    while (todo.length) {
      const id = todo.pop()!;
      if (seen.has(id)) continue;
      seen.add(id); todo.push(...(byId.get(id)?.parentIds ?? []));
    }
    ancestors.set(event.id, seen);
  }
  const heads = rankingHeads(events);
  const comparisons = events.flatMap(event => event.comparisons.map(comparison => {
    const involves = (e: RankingEvidenceEvent) => e.subjectIds.includes(comparison.restaurantId) || e.subjectIds.includes(comparison.comparisonId);
    const supersededBy = events.filter(e => e.source !== 'system' && ancestors.get(e.id)!.has(event.id) && involves(e)).map(e => e.id);
    const concurrent = events.some(e => e.id !== event.id && e.source !== 'system' && involves(e)
      && !ancestors.get(e.id)!.has(event.id) && !ancestors.get(event.id)!.has(e.id));
    const deleted = currentIds !== undefined && (!currentIds.includes(comparison.restaurantId) || !currentIds.includes(comparison.comparisonId));
    return { ...comparison, eventId: event.id, source: event.source, supersededBy,
      status: deleted ? 'deleted' : supersededBy.length ? 'superseded' : comparison.outcome === 'skip' ? 'skipped' : concurrent ? 'conflicting' : 'current' };
  }));
  return { heads, order: heads.length === 1 ? byId.get(heads[0])!.order.filter(id => !currentIds || currentIds.includes(id)) : null, comparisons };
}
