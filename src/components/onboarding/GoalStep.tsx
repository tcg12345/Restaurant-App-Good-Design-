import React, { useId } from 'react';
import { ChefHat, Check, Compass, Sparkles, Utensils } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { APP_GOAL_LABELS, type AppGoal } from '../../lib/app-goal';

export const GOAL_TITLE = 'Good food. Your way.';
export const GOAL_SUBTITLE = 'What brings you to GoodEats? Choose what you’d like to do most.';
const OPTIONS = [
  { id: 'restaurants', icon: Utensils, detail: 'Discover new places and save your next favorite table.' },
  { id: 'cooking', icon: ChefHat, detail: 'Find recipe inspiration and make more meals you love.' },
  { id: 'both', icon: Compass, detail: 'Great nights out. Good meals in. The best of both.' },
] as const;

export function GoalStep({ selected, onChange }: { selected?: AppGoal; onChange: (goal: AppGoal) => void }) {
  const name = useId();
  const reduce = useReducedMotion();
  return <>
    <fieldset className="ob-goals">
      <legend className="sr-only">How would you like to use GoodEats?</legend>
      {OPTIONS.map(({ id, icon: Icon, detail }, i) => <motion.label key={id} className="ob-goal-card" data-selected={selected === id}
        initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, delay: reduce ? 0 : i * .05 }}>
        <input type="radio" name={name} value={id} checked={selected === id} onChange={() => onChange(id)} />
        <span className="ob-goal-icon" aria-hidden="true"><Icon size={24} strokeWidth={1.5} /></span>
        <span className="ob-goal-copy"><strong>{APP_GOAL_LABELS[id]}</strong><span>{detail}</span></span>
        <span className="ob-goal-check" aria-hidden="true">{selected === id && <Check size={13} strokeWidth={2.5} />}</span>
      </motion.label>)}
    </fieldset>
    <div className="ob-goal-note"><Sparkles size={17} strokeWidth={1.5} aria-hidden="true" /><p>We’ll use this to shape your Home suggestions. You can explore everything, whatever you choose.</p></div>
  </>;
}
