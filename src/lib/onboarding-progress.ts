import type { TasteQuizAnswers } from './taste-quiz';

export const TASTE_QUESTION_ORDER = ['goal', 'city', 'cuisines', 'prices', 'atmosphere'] as const;
export type TasteQuestion = typeof TASTE_QUESTION_ORDER[number];

/** An intentional skip is an answer too. Legacy profiles without question
 * history still skip any question for which they already have a value. */
export function pendingTasteQuestions(answers: TasteQuizAnswers | null, hasCity = false): TasteQuestion[] {
  return TASTE_QUESTION_ORDER.filter(key => {
    if (answers?.completedSteps?.includes(key)) return false;
    if (key === 'goal') return !answers?.goal;
    if (key === 'city') return !hasCity && !answers?.city;
    if (key === 'prices') return answers?.pricePrimary === undefined && !answers?.prices?.length;
    if (key === 'atmosphere') return !answers?.atmosphere;
    return !answers?.[key]?.length;
  });
}
