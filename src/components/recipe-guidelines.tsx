// The optional recipe GUIDELINES — time / skill / course / dietary /
// serves — shared by every AI recipe entry point ("Create with AI" and
// "Recreate a dish"). One value object, one pill row, and the helpers
// that turn the selection into the API's structured constraints. The
// pills' CSS (`rcxa-pill*`, `rcxa-menu*`, `rcxa-opt`) lives in
// RecipeBuilder.css alongside the rest of the rcx language.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check, Minus, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import type { RecipeConstraints } from '../lib/build-recipe-client';
import { formatRemaining } from '../lib/gen-progress';
import './RecipeBuilder.css';

// Sent to the API as STRUCTURED constraints (difficulty, time budget,
// servings, course, dietary) rather than being folded into the prompt
// prose: the server renders them as an explicit hard-requirement
// checklist the model must satisfy and re-check.
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const TIME_OPTIONS: { key: string; label: string }[] = [
  { key: '30', label: 'Under 30 min' },
  { key: '60', label: 'Under 1 hr' },
  { key: '120', label: 'Under 2 hr' },
];
export const COURSE_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Side'];
export const DIETARY_OPTIONS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'High-protein', 'Low-carb'];

export type MenuKey = 'time' | 'skill' | 'course' | 'dietary' | 'serves';

export interface Guidelines {
  difficulty: '' | Difficulty;
  /** A TIME_OPTIONS key (minutes as a string) or ''. */
  timeBudget: string;
  servings: number | null;
  course: string;
  dietary: string[];
}

export const EMPTY_GUIDELINES: Guidelines = { difficulty: '', timeBudget: '', servings: null, course: '', dietary: [] };

export function hasGuidelines(g: Guidelines): boolean {
  return !!(g.difficulty || g.timeBudget || g.servings || g.course || g.dietary.length);
}

/** The API's structured constraints for a selection (difficulty travels
 *  separately), or undefined when nothing is set. */
export function composeConstraints(g: Guidelines): RecipeConstraints | undefined {
  const c: RecipeConstraints = {};
  if (g.timeBudget) c.totalTimeMax = Number(g.timeBudget);
  if (g.servings) c.servings = g.servings;
  if (g.course) c.course = g.course;
  if (g.dietary.length) c.dietary = g.dietary;
  return Object.keys(c).length > 0 ? c : undefined;
}

/** Human-readable fragments of the selection ("serves 4", "vegan") for
 *  request descriptions and chat-history labels. */
export function describeGuidelines(g: Guidelines): string[] {
  const parts: string[] = [];
  if (g.course) parts.push(`a ${g.course.toLowerCase()} dish`);
  if (g.dietary.length) parts.push(g.dietary.map((d) => d.toLowerCase()).join(', '));
  if (g.servings) parts.push(`serves ${g.servings}`);
  if (g.timeBudget) parts.push(`ready in ${(TIME_OPTIONS.find((t) => t.key === g.timeBudget)?.label ?? `${g.timeBudget} min`).toLowerCase()}`);
  if (g.difficulty) parts.push(`${g.difficulty.toLowerCase()} difficulty`);
  return parts;
}

/* ── Guideline dropdown — pill trigger + upward-opening panel ────────
   The panel portals to <body>: the pills row scrolls horizontally (it
   would clip an in-place panel), and the modal card's residual framer
   transform would trap position:fixed inside it anyway. Anchored to the
   pill's rect at open time. */

export const GuidelineMenu: React.FC<{
  label: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ label, active, open, onToggle, onClose, children }) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setAnchor({
      // Keep the panel on-screen when the pill sits near the right edge.
      left: Math.max(8, Math.min(r.left, window.innerWidth - 212)),
      bottom: window.innerHeight - r.top + 8,
    });
  }, [open]);

  return (
    <div className="rcxa-pill-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={cn('rcxa-pill', active && 'is-on', open && 'is-open')}
        onClick={onToggle}
        aria-expanded={open}
      >
        {label}
        <ChevronDown size={13} strokeWidth={2.4} className="rcxa-pill-caret" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && anchor && (
            <>
              <div className="rcxa-menu-backdrop" onClick={onClose} />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="rcxa-menu"
                style={{ left: anchor.left, bottom: anchor.bottom }}
                role="listbox"
              >
                {children}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};

export const MenuOption: React.FC<{ label: string; selected: boolean; onSelect: () => void }> = ({
  label,
  selected,
  onSelect,
}) => (
  <button
    type="button"
    className={cn('rcxa-opt', selected && 'is-on')}
    onClick={onSelect}
    role="option"
    aria-selected={selected}
  >
    <span>{label}</span>
    {selected && <Check size={14} strokeWidth={2.6} />}
  </button>
);

/* ── The five pills ────────────────────────────────────────────────── */

export const GuidelinePills: React.FC<{
  value: Guidelines;
  onChange: (next: Guidelines) => void;
  openMenu: MenuKey | null;
  onOpenMenu: (key: MenuKey | null) => void;
  className?: string;
}> = ({ value: g, onChange, openMenu, onOpenMenu, className }) => {
  const set = (patch: Partial<Guidelines>) => onChange({ ...g, ...patch });
  const toggleMenu = (key: MenuKey) => onOpenMenu(openMenu === key ? null : key);
  const closeMenu = () => onOpenMenu(null);

  // Value-aware pill labels — the selection IS the label, so nothing
  // needs a second "selected" readout anywhere else.
  const timeLabel = g.timeBudget ? TIME_OPTIONS.find((t) => t.key === g.timeBudget)?.label ?? 'Time' : 'Time';
  const dietaryLabel =
    g.dietary.length === 0 ? 'Dietary' : g.dietary.length === 1 ? g.dietary[0] : `Dietary · ${g.dietary.length}`;
  const servesLabel = g.servings === null ? 'Serves' : `Serves ${g.servings}`;

  return (
    <div className={cn('rcxa-pills', className)}>
      <GuidelineMenu label={timeLabel} active={!!g.timeBudget} open={openMenu === 'time'} onToggle={() => toggleMenu('time')} onClose={closeMenu}>
        {TIME_OPTIONS.map((t) => (
          <MenuOption
            key={t.key}
            label={t.label}
            selected={g.timeBudget === t.key}
            onSelect={() => { set({ timeBudget: g.timeBudget === t.key ? '' : t.key }); closeMenu(); }}
          />
        ))}
      </GuidelineMenu>

      <GuidelineMenu label={g.difficulty || 'Skill'} active={!!g.difficulty} open={openMenu === 'skill'} onToggle={() => toggleMenu('skill')} onClose={closeMenu}>
        {DIFFICULTIES.map((d) => (
          <MenuOption
            key={d}
            label={d}
            selected={g.difficulty === d}
            onSelect={() => { set({ difficulty: g.difficulty === d ? '' : d }); closeMenu(); }}
          />
        ))}
      </GuidelineMenu>

      <GuidelineMenu label={g.course || 'Course'} active={!!g.course} open={openMenu === 'course'} onToggle={() => toggleMenu('course')} onClose={closeMenu}>
        {COURSE_OPTIONS.map((c) => (
          <MenuOption
            key={c}
            label={c}
            selected={g.course === c}
            onSelect={() => { set({ course: g.course === c ? '' : c }); closeMenu(); }}
          />
        ))}
      </GuidelineMenu>

      <GuidelineMenu label={dietaryLabel} active={g.dietary.length > 0} open={openMenu === 'dietary'} onToggle={() => toggleMenu('dietary')} onClose={closeMenu}>
        {/* Multi-select — stays open across toggles. */}
        {DIETARY_OPTIONS.map((d) => (
          <MenuOption
            key={d}
            label={d}
            selected={g.dietary.includes(d)}
            onSelect={() => set({ dietary: g.dietary.includes(d) ? g.dietary.filter((x) => x !== d) : [...g.dietary, d] })}
          />
        ))}
      </GuidelineMenu>

      <GuidelineMenu label={servesLabel} active={g.servings !== null} open={openMenu === 'serves'} onToggle={() => toggleMenu('serves')} onClose={closeMenu}>
        <div className="rcxa-serves-row">
          <button
            type="button"
            className="rcx-round-btn"
            onClick={() => set({ servings: g.servings === null ? null : g.servings <= 1 ? null : g.servings - 1 })}
            disabled={g.servings === null}
            aria-label="Decrease servings"
          >
            <Minus size={12} strokeWidth={2.4} />
          </button>
          <span className={`rcx-serves-value${g.servings === null ? ' is-any' : ''}`}>
            {g.servings === null ? 'Any' : g.servings}
          </span>
          <button
            type="button"
            className="rcx-round-btn"
            onClick={() => set({ servings: g.servings === null ? 2 : Math.min(24, g.servings + 1) })}
            disabled={g.servings !== null && g.servings >= 24}
            aria-label="Increase servings"
          >
            <Plus size={12} strokeWidth={2.4} />
          </button>
        </div>
      </GuidelineMenu>
    </div>
  );
};

/* ── Progress — a bar fed by the streamed size, and the time left ──── */

export const GenProgressBar: React.FC<{ progress: number; remainingMs: number | null; elapsed: number }> = ({
  progress,
  remainingMs,
  elapsed,
}) => {
  const pct = Math.round(progress * 100);
  return (
    <div className="rcx-ai-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="rcx-ai-progress-track">
        <div className="rcx-ai-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="rcx-ai-progress-label">
        {formatRemaining(remainingMs) || (elapsed >= 2 ? `${elapsed}s` : '')}
      </span>
    </div>
  );
};
