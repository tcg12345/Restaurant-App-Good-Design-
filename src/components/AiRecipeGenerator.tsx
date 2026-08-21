// "Create with AI" mode of the recipe modal — a minimal, prompt-first
// surface in the style of a professional AI product: a calm centered
// canvas (identity line + a few tappable ideas), guideline dropdowns,
// and a floating prompt bar docked at the bottom. Describe the dish (or
// just set guidelines) and a complete editable draft lands on the
// Advanced builder's Review step.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GlassButton } from '../lib/glass-buttons';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  ChefHat,
  AlertCircle,
  X,
  ArrowUp,
  ChevronDown,
  Check,
  Minus,
  Plus,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { generateRecipe, type RecipeConstraints } from '../lib/build-recipe-client';
import type { HomeMeal } from '../contexts/ListsContext';
import './AdvancedRecipeBuilder.css';
import './RecipeBuilder.css';

interface AiRecipeGeneratorProps {
  /** Called with a fully-formed HomeMeal once the AI finishes. The
   *  parent seeds the Advanced builder with it for review + publish.
   *  `meta` carries the originating prompt + raw tool input so the parent
   *  can also record the draft into the assistant's chat history. */
  onGenerated: (meal: HomeMeal, meta?: { prompt: string; rawInput: unknown }) => void;
  /** Close the whole Add Recipe modal. */
  onClose: () => void;
  /** The method chip ("back to methods"), injected by the parent so it
   *  stays consistent with the other modes. */
  tabSlot?: React.ReactNode;
  phoneMode?: boolean;
}

// A few tappable starting points on the empty canvas — concrete and
// varied so users see the breadth of what they can ask for. Tapping one
// fills the prompt bar (and can still be edited).
const EXAMPLES = [
  'A cozy weeknight mushroom risotto for 4',
  'The best fudgy brown-butter brownies',
  'A vegan Thai red curry, ready in 30 minutes',
  'A high-protein chicken meal-prep bowl',
];

// Optional guidelines — sent to the API as STRUCTURED constraints
// (difficulty, time budget, servings, course, dietary) rather than being
// folded into the prompt prose: the server renders them as an explicit
// hard-requirement checklist the model must satisfy and re-check.
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
const TIME_OPTIONS: { key: string; label: string }[] = [
  { key: '30', label: 'Under 30 min' },
  { key: '60', label: 'Under 1 hr' },
  { key: '120', label: 'Under 2 hr' },
];
const COURSE_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Side'];
const DIETARY_OPTIONS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'High-protein', 'Low-carb'];

type MenuKey = 'time' | 'skill' | 'course' | 'dietary' | 'serves';

/* ── Guideline dropdown — pill trigger + upward-opening panel ────────
   The panel portals to <body>: the pills row scrolls horizontally (it
   would clip an in-place panel), and the modal card's residual framer
   transform would trap position:fixed inside it anyway. Anchored to the
   pill's rect at open time. */

const GuidelineMenu: React.FC<{
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

const MenuOption: React.FC<{ label: string; selected: boolean; onSelect: () => void }> = ({
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

/* ── The generator ─────────────────────────────────────────────────── */

export const AiRecipeGenerator: React.FC<AiRecipeGeneratorProps> = ({
  onGenerated,
  onClose,
  tabSlot,
  phoneMode,
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Optional guidelines.
  const [difficulty, setDifficulty] = useState('');
  const [timeBudget, setTimeBudget] = useState('');
  const [servings, setServings] = useState<number | null>(null);
  const [course, setCourse] = useState('');
  const [dietary, setDietary] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Desktop only — auto-focusing on phone pops the keyboard the instant
    // the modal opens, hiding the canvas. Let the user tap in.
    if (phoneMode) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [phoneMode]);

  // The prompt bar grows with the text (single line → ~5 lines).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [prompt, loading]);

  // Tick the elapsed-seconds counter while generating so the user has
  // visible proof the request is alive during the (sometimes 15–25s)
  // generation.
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const started = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  // Abort any in-flight request if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toggleDietary = (d: string) =>
    setDietary((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const hasGuidelines = !!(difficulty || timeBudget || servings || course || dietary.length);

  const composeConstraints = (): RecipeConstraints | undefined => {
    const c: RecipeConstraints = {};
    if (timeBudget) c.totalTimeMax = Number(timeBudget);
    if (servings) c.servings = servings;
    if (course) c.course = course;
    if (dietary.length) c.dietary = dietary;
    return Object.keys(c).length > 0 ? c : undefined;
  };

  // Human-readable description of the full request — used as the prompt
  // when the user typed nothing, and as the chat-history label.
  const describeRequest = (): string => {
    const base = prompt.trim();
    const parts: string[] = [];
    if (course) parts.push(`a ${course.toLowerCase()} dish`);
    if (dietary.length) parts.push(dietary.map((d) => d.toLowerCase()).join(', '));
    if (servings) parts.push(`serves ${servings}`);
    if (timeBudget) parts.push(`ready in ${(TIME_OPTIONS.find((t) => t.key === timeBudget)?.label ?? `${timeBudget} min`).toLowerCase()}`);
    if (difficulty) parts.push(`${difficulty.toLowerCase()} difficulty`);
    if (base) return parts.length ? `${base} (${parts.join('; ')})` : base;
    return parts.length ? `A recipe: ${parts.join('; ')}` : '';
  };

  const handleGenerate = async () => {
    const base = prompt.trim();
    if ((!base && !hasGuidelines) || loading) return;
    // With no free text, ask for the model's best pick within the
    // guidelines (which travel separately as hard requirements).
    const finalPrompt = base || 'Pick a great dish that fits the requirements and write the recipe for it.';
    setError(null);
    setOpenMenu(null);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await generateRecipe(finalPrompt, controller.signal, {
        difficulty: (difficulty || undefined) as 'Easy' | 'Medium' | 'Hard' | undefined,
        constraints: composeConstraints(),
      });
      // Cancelled — the user already moved on; don't flash an error.
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      if (result.ok && result.meal) {
        onGenerated(result.meal, { prompt: describeRequest() || finalPrompt, rawInput: result.recipe });
      } else {
        setError(result.error || 'Something went wrong. Try again.');
      }
    } catch (err) {
      // A throw anywhere in the stream/normalize path used to strand the
      // spinner forever — surface it as a retryable error instead.
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      console.warn('[AiRecipeGenerator] generate failed:', err);
      setError('Something went wrong. Try again.');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter inserts a newline. IME confirm-Enter
    // commits the composition instead of submitting.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const pickIdea = (ex: string) => {
    setPrompt(ex);
    setError(null);
    if (!phoneMode) textareaRef.current?.focus();
  };

  const canSubmit = (prompt.trim().length > 0 || hasGuidelines) && !loading;
  const loadingTitle = elapsed >= 18 ? 'Almost there…' : elapsed >= 8 ? 'Writing the steps…' : 'Drafting your recipe…';

  // Value-aware pill labels — the selection IS the label, so nothing
  // needs a second "selected" readout anywhere else.
  const timeLabel = timeBudget ? TIME_OPTIONS.find((t) => t.key === timeBudget)?.label ?? 'Time' : 'Time';
  const dietaryLabel =
    dietary.length === 0 ? 'Dietary' : dietary.length === 1 ? dietary[0] : `Dietary · ${dietary.length}`;
  const servesLabel = servings === null ? 'Serves' : `Serves ${servings}`;

  const toggleMenu = (key: MenuKey) => setOpenMenu((prev) => (prev === key ? null : key));
  const closeMenu = () => setOpenMenu(null);

  return (
    <div className={`rcx rcxa${phoneMode ? ' is-phone' : ''}`}>
      {/* ── Header — navigation only; the canvas carries the identity. ── */}
      <div className="rcx-head rcxa-head">
        <div className="rcx-head-row">
          {tabSlot}
          <div className="rcx-head-actions">
            <GlassButton
              id="recipe-ai-close"
              symbol="xmark"
              label="Close"
              onClick={onClose}
              className="rcx-head-close"
            >
              <X size={14} />
            </GlassButton>
          </div>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div className="rcxa-canvas">
        <AnimatePresence mode="wait" initial={false}>
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="rcx-ai-loading"
            >
              <div className="rcx-ai-orb"><ChefHat size={30} /></div>
              <div className="rcx-ai-loading-title">{loadingTitle}</div>
              <p className="rcx-ai-loading-sub">
                Measuring ingredients, sequencing steps, and dialing in the timing.
              </p>
              {elapsed >= 3 && <span className="rcx-ai-loading-secs">{elapsed}s</span>}
              <button type="button" className="rcxa-cancel" onClick={handleCancel}>
                Cancel
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="hero"
              className="rcxa-hero"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="rcxa-orb"><Sparkles size={20} strokeWidth={1.9} /></div>
              <h3 className="rcxa-title">What should we cook?</h3>
              <p className="rcxa-sub">
                Describe a dish, a few ingredients, or a mood — you&rsquo;ll get a
                complete draft to review and edit before publishing.
              </p>
              <div className="rcxa-ideas">
                {EXAMPLES.map((ex, i) => (
                  <motion.button
                    key={ex}
                    type="button"
                    className="rcxa-idea"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 + i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => pickIdea(ex)}
                  >
                    <Sparkles size={12} />
                    <span>{ex}</span>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Dock — guideline dropdowns + the floating prompt bar ── */}
      <AnimatePresence initial={false}>
        {!loading && (
          <motion.div
            key="dock"
            className="rcxa-dock"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <AnimatePresence>
              {error && (
                <motion.p
                  key="err"
                  className="rcxa-error"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.16 }}
                >
                  <AlertCircle size={13} /> {error}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="rcxa-pills">
              <GuidelineMenu
                label={timeLabel}
                active={!!timeBudget}
                open={openMenu === 'time'}
                onToggle={() => toggleMenu('time')}
                onClose={closeMenu}
              >
                {TIME_OPTIONS.map((t) => (
                  <MenuOption
                    key={t.key}
                    label={t.label}
                    selected={timeBudget === t.key}
                    onSelect={() => {
                      setTimeBudget((prev) => (prev === t.key ? '' : t.key));
                      closeMenu();
                    }}
                  />
                ))}
              </GuidelineMenu>

              <GuidelineMenu
                label={difficulty || 'Skill'}
                active={!!difficulty}
                open={openMenu === 'skill'}
                onToggle={() => toggleMenu('skill')}
                onClose={closeMenu}
              >
                {DIFFICULTIES.map((d) => (
                  <MenuOption
                    key={d}
                    label={d}
                    selected={difficulty === d}
                    onSelect={() => {
                      setDifficulty((prev) => (prev === d ? '' : d));
                      closeMenu();
                    }}
                  />
                ))}
              </GuidelineMenu>

              <GuidelineMenu
                label={course || 'Course'}
                active={!!course}
                open={openMenu === 'course'}
                onToggle={() => toggleMenu('course')}
                onClose={closeMenu}
              >
                {COURSE_OPTIONS.map((c) => (
                  <MenuOption
                    key={c}
                    label={c}
                    selected={course === c}
                    onSelect={() => {
                      setCourse((prev) => (prev === c ? '' : c));
                      closeMenu();
                    }}
                  />
                ))}
              </GuidelineMenu>

              <GuidelineMenu
                label={dietaryLabel}
                active={dietary.length > 0}
                open={openMenu === 'dietary'}
                onToggle={() => toggleMenu('dietary')}
                onClose={closeMenu}
              >
                {/* Multi-select — stays open across toggles. */}
                {DIETARY_OPTIONS.map((d) => (
                  <MenuOption
                    key={d}
                    label={d}
                    selected={dietary.includes(d)}
                    onSelect={() => toggleDietary(d)}
                  />
                ))}
              </GuidelineMenu>

              <GuidelineMenu
                label={servesLabel}
                active={servings !== null}
                open={openMenu === 'serves'}
                onToggle={() => toggleMenu('serves')}
                onClose={closeMenu}
              >
                <div className="rcxa-serves-row">
                  <button
                    type="button"
                    className="rcx-round-btn"
                    onClick={() => setServings((prev) => {
                      if (prev === null) return null;
                      return prev <= 1 ? null : prev - 1;
                    })}
                    disabled={servings === null}
                    aria-label="Decrease servings"
                  >
                    <Minus size={12} strokeWidth={2.4} />
                  </button>
                  <span className={`rcx-serves-value${servings === null ? ' is-any' : ''}`}>
                    {servings === null ? 'Any' : servings}
                  </span>
                  <button
                    type="button"
                    className="rcx-round-btn"
                    onClick={() => setServings((prev) => (prev === null ? 2 : Math.min(24, prev + 1)))}
                    disabled={servings !== null && servings >= 24}
                    aria-label="Increase servings"
                  >
                    <Plus size={12} strokeWidth={2.4} />
                  </button>
                </div>
              </GuidelineMenu>
            </div>

            <div className="rcxa-bar">
              <textarea
                ref={textareaRef}
                className="rcxa-input"
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="Describe your dish…"
                rows={1}
              />
              <button
                type="button"
                className="rcxa-send"
                onClick={handleGenerate}
                disabled={!canSubmit}
                aria-label="Generate recipe"
              >
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            </div>

            <p className="rcxa-note">AI drafts can make mistakes — review before publishing.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
