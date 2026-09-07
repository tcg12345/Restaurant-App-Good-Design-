import { describe, expect, it } from 'vitest';
import { pendingTasteQuestions, TASTE_QUESTION_ORDER } from './onboarding-progress';

describe('onboarding account handoff', () => {
  it('does not include the removed eating-preferences page in either signup path', () => {
    expect(TASTE_QUESTION_ORDER).toEqual(['goal', 'city', 'cuisines', 'prices', 'atmosphere']);
    expect(pendingTasteQuestions({ dietary: ['vegan'] })).not.toContain('dietary');
  });
  it('asks every preference for a direct signup', () => {
    expect(pendingTasteQuestions(null)).toEqual([...TASTE_QUESTION_ORDER]);
  });
  it('never repeats a question deliberately skipped before signup', () => {
    expect(pendingTasteQuestions({ cuisines: [], prices: [], dietary: [], completedSteps: [...TASTE_QUESTION_ORDER] })).toEqual([]);
  });
  it('keeps only missing questions for a legacy taste profile', () => {
    expect(pendingTasteQuestions({ cuisines: ['Italian'], prices: [2], dietary: ['vegetarian'] }, true)).toEqual(['goal', 'atmosphere']);
  });
  it('does not ask a goal again after an answer or explicit skip', () => {
    expect(pendingTasteQuestions({ goal: 'cooking' })).not.toContain('goal');
    expect(pendingTasteQuestions({ completedSteps: ['goal'] })).not.toContain('goal');
  });
  it('recognizes a primary budget even without the legacy flat array', () => {
    expect(pendingTasteQuestions({ pricePrimary: 3 })).not.toContain('prices');
  });
  it('resumes a partly completed flow without asking location twice', () => {
    expect(pendingTasteQuestions({ completedSteps: ['city', 'cuisines'], cuisines: [] })).toEqual(['goal', 'prices', 'atmosphere']);
  });
});

import { buildTasteProfile } from './recommendations';
describe('onboarding answers personalize recommendations', () => {
  it('uses atmosphere and eating preferences as real restaurant tag signals', () => {
    const taste = buildTasteProfile([], [], [], [], { cuisines: ['Italian'], pricePrimary: 2, prices: [2], atmosphere: 'intimate', dietary: ['vegetarian'], city: 'New York, NY' });
    expect(taste.tagScore['Intimate']).toBeGreaterThan(0);
    expect(taste.tagScore['Good Vegetarian Options']).toBeGreaterThan(0);
    expect(taste.topCuisines).toContain('Italian');
    expect(taste.priceScore[2]).toBeGreaterThan(0);
  });
});
