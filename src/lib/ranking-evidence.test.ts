import { describe, expect, it } from 'vitest';
import { applyChoice, applySkip, applyTie, computeFinalScore, initH2H, isComplete, pickComparison, placementOrder, undoLastChoice } from './headToHeadRating';
import { comparisonDraft, isRankingEvidenceEvent, makeRankingEvent, mergeRankingEvents, resolveRankingEvidence, savedRankingOrder, stampComparisonStep } from './ranking-evidence';
import type { RestaurantRating } from '../contexts/ListsContext';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ratings = [{ restaurantId: 'A', score: 8 }, { restaurantId: 'B', score: 7 }, { restaurantId: 'C', score: 6 }];
const comparison = { restaurantId: 'A', comparisonId: 'B', outcome: 'preferred' as const, answeredAt: 10 };

describe('preference observations', () => {
  it('stores numeric-free order and explicit answers without creating implied pair votes', () => {
    const before = JSON.stringify(ratings);
    const event = makeRankingEvent([], ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'], comparisons: [comparison], explicitOrder: ['A', 'B'] }, 20, id(1));
    expect(event.order).toEqual(['A', 'B', 'C']); expect(event.comparisons).toHaveLength(1);
    expect(JSON.stringify(event)).not.toContain('"score":'); expect(JSON.stringify(ratings)).toBe(before);
    expect(isRankingEvidenceEvent(JSON.parse(JSON.stringify(event)))).toBe(true);
  });
  it('retains ties and skips, and excludes undone answers from committed history', () => {
    const candidates = ratings.map(r => ({ ...r, name: r.restaurantId, cuisine: '', price: '', tags: [], address: '' })) as RestaurantRating[];
    let state = initH2H(candidates, 'loved', 'new');
    state = stampComparisonStep(applyTie(state), 10);
    state = stampComparisonStep(applySkip(state), 20);
    const draft = comparisonDraft('new', 'h2h', state.history);
    expect(draft.comparisons.map(c => c.outcome)).toEqual(['tie', 'skip']);
    expect(comparisonDraft('new', 'h2h', undoLastChoice(state).history).comparisons.map(c => c.outcome)).toEqual(['tie']);
  });
  it('adding timestamps leaves H2H scores and placements exactly unchanged', () => {
    const candidates = Array.from({ length: 15 }, (_, i) => ({ restaurantId: String(i), name: String(i), score: 7 + i / 5, cuisine: '', price: '', tags: [], address: '' })) as RestaurantRating[];
    let plain = initH2H(candidates, 'loved', 'new'), observed = initH2H(candidates, 'loved', 'new'), step = 0;
    while (!isComplete(plain)) {
      expect(pickComparison(observed)?.restaurantId).toBe(pickComparison(plain)?.restaurantId);
      const action = step % 3 === 0 ? applyTie : step % 3 === 1 ? applySkip : (s: typeof plain) => applyChoice(s, true);
      plain = action(plain); observed = stampComparisonStep(action(observed), 100 + step++);
      expect(computeFinalScore(observed)).toBe(computeFinalScore(plain));
      expect(placementOrder(observed, 'new', computeFinalScore(observed))).toEqual(placementOrder(plain, 'new', computeFinalScore(plain)));
    }
    expect(step).toBeGreaterThan(1);
  });
  it('uses causal versions rather than client-clock order for supersession', () => {
    const first = makeRankingEvent([], ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'], comparisons: [comparison] }, 100, id(1));
    const second = makeRankingEvent([first], [...ratings].reverse(), { kind: 'rating', source: 'h2h', subjectIds: ['A'], comparisons: [{ ...comparison, outcome: 'not-preferred', answeredAt: 1 }] }, 2, id(2));
    const resolved = resolveRankingEvidence([second, first]);
    expect(resolved.heads).toEqual([second.id]);
    expect(resolved.comparisons.find(c => c.eventId === first.id)?.status).toBe('superseded');
    expect(resolved.comparisons.find(c => c.eventId === second.id)?.status).toBe('current');
  });
  it('keeps concurrent preferences ambiguous and merges immutable IDs without duplication', () => {
    const a = makeRankingEvent([], ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'], comparisons: [comparison] }, 1, id(1));
    const b = makeRankingEvent([], ratings, { kind: 'rating', source: 'h2h', subjectIds: ['B'], comparisons: [{ ...comparison, outcome: 'tie' }] }, 2, id(2));
    const merged = mergeRankingEvents([a], [b, a]); expect(merged).toHaveLength(2);
    expect(resolveRankingEvidence(merged).order).toBeNull();
    expect(resolveRankingEvidence(merged).comparisons.every(c => c.status === 'conflicting')).toBe(true);
  });
  it('manual reorder and deletion retire related comparisons; automatic settlement does not', () => {
    const first = makeRankingEvent([], ratings, { kind: 'rating', source: 'h2h', subjectIds: ['A'], comparisons: [comparison] }, 1, id(1));
    const automatic = makeRankingEvent([first], ratings, { kind: 'reorder', source: 'system', subjectIds: [] }, 2, id(2));
    expect(resolveRankingEvidence([first, automatic]).comparisons[0].status).toBe('current');
    const manual = makeRankingEvent([first, automatic], ratings, { kind: 'reorder', source: 'manual-reorder', subjectIds: ['B'], explicitOrder: ['B', 'A', 'C'] }, 3, id(3));
    expect(resolveRankingEvidence([first, automatic, manual]).comparisons[0].status).toBe('superseded');
    const removed = makeRankingEvent([first], ratings.slice(1), { kind: 'delete', source: 'score-edit', subjectIds: ['A'] }, 4, id(4));
    expect(resolveRankingEvidence([first, removed], ['B', 'C']).comparisons[0].status).toBe('deleted');
  });
  it('imported/legacy orders contain no fabricated H2H answers; malformed events are rejected', () => {
    for (const source of ['import', 'legacy'] as const) {
      const event = makeRankingEvent([], ratings, { kind: 'snapshot', source, subjectIds: [] }, 1, id(1));
      expect(event.comparisons).toEqual([]); expect(savedRankingOrder(ratings)).toEqual(event.order);
      expect(isRankingEvidenceEvent({ ...event, order: ['A', 'A'] })).toBe(false);
      expect(isRankingEvidenceEvent({ ...event, comparisons: [{ ...comparison, comparisonId: 'A' }] })).toBe(false);
    }
  });
});
