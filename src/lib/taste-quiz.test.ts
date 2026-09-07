import { beforeEach, describe, expect, it, vi } from 'vitest';
const { update, eq, maybeSingle } = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('./supabase', () => ({ supabaseConfigured: true, supabase: { from: vi.fn(() => ({ update })) } }));
import { getTasteQuiz, saveTasteQuiz } from './taste-quiz';
const values = new Map<string, string>();
beforeEach(() => {
  values.clear(); vi.clearAllMocks();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
  update.mockReturnValue({ eq }); eq.mockReturnValue({ select: () => ({ maybeSingle }) });
  maybeSingle.mockResolvedValue({ data: { user_id: 'test-user' }, error: null });
});
describe('taste draft persistence', () => {
  it('preserves all-skipped progress through local storage and reload', async () => {
    await saveTasteQuiz(undefined, { cuisines: [], prices: [], dietary: [], completedSteps: ['goal', 'city', 'cuisines', 'prices', 'atmosphere'] });
    expect(getTasteQuiz()?.completedSteps).toHaveLength(5);
    expect(update).not.toHaveBeenCalled();
  });
  it('reads goals from account profiles and rejects unknown values', async () => {
    expect(getTasteQuiz({ taste_profile: { goal: 'both' } })?.goal).toBe('both');
    expect(getTasteQuiz({ taste_profile: { goal: 'unknown' } })).toBeNull();
    await saveTasteQuiz(undefined, { goal: 'restaurants' });
    expect(getTasteQuiz()?.goal).toBe('restaurants');
  });
  it('sanitizes question history from stored data', () => {
    values.set('goodeats-taste-quiz', JSON.stringify({ completedSteps: ['wrong', 'prices', 'prices', null] }));
    expect(getTasteQuiz()?.completedSteps).toEqual(['prices']);
  });
  it('writes the full draft to the signed-in user without losing new preferences', async () => {
    const draft = { goal: 'cooking' as const, cuisines: ['Japanese'], pricePrimary: 2, priceSecondary: 4, atmosphere: 'intimate', dietary: ['vegetarian'], city: 'New York', completedSteps: ['cuisines', 'prices'] as const };
    await saveTasteQuiz('test-user', { ...draft, completedSteps: [...draft.completedSteps] });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ taste_profile: draft }));
    expect(eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(getTasteQuiz()).toMatchObject(draft);
  });
  it('lets an explicit empty array clear previous selections', async () => {
    await saveTasteQuiz(undefined, { cuisines: ['Italian'] });
    await saveTasteQuiz(undefined, { cuisines: [], completedSteps: ['cuisines'] });
    expect(getTasteQuiz()?.cuisines).toEqual([]);
  });
  it('reports a failed account save while retaining the local draft for retry', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(saveTasteQuiz('test-user', { cuisines: ['Thai'] }, { requireRemote: true })).rejects.toThrow();
    expect(getTasteQuiz()?.cuisines).toEqual(['Thai']);
  });
  it('does not claim a profile saved if the update affected no row', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(saveTasteQuiz('test-user', { cuisines: ['Thai'] }, { requireRemote: true })).rejects.toThrow();
  });
});
