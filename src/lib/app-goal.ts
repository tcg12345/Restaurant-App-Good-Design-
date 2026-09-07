/** A starting preference for Home; every part of the app stays available. */
export const APP_GOALS = ['restaurants', 'cooking', 'both'] as const;
export type AppGoal = typeof APP_GOALS[number];
export const APP_GOAL_LABELS: Record<AppGoal, string> = {
  restaurants: 'Find great restaurants',
  cooking: 'Cook something good',
  both: 'A little of both',
};
export function isAppGoal(value: unknown): value is AppGoal {
  return APP_GOALS.some(goal => goal === value);
}
