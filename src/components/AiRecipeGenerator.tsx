// "Create with AI" mode of the recipe modal — a minimal, prompt-first
// surface in the style of a professional AI product: a calm centered
// canvas (identity line + a few tappable ideas), guideline dropdowns,
// and a floating prompt bar docked at the bottom. Describe the dish (or
// just set guidelines) and a complete editable draft lands on the
// Advanced builder's Review step.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Search,
  Lightbulb,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { usePaywall } from '../contexts/PaywallContext';
import {
  generateRecipe, generateRecipeIdeas, combineRecipes,
  type RecipeConstraints, type RecipeIdea,
} from '../lib/build-recipe-client';
import type { HomeMeal } from '../contexts/ListsContext';
import {
  estimateProgress, estimateRemainingMs, formatRemaining, loadExpectation, recordGeneration,
  type GenExpectation, type GenKind,
} from '../lib/gen-progress';
import { saveIdeasSession, takeIdeasSession } from '../lib/ideas-session';
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
  /** Which view to open on. The Pantry "Ideas" pill lands straight on
   *  the brainstorm; everything else starts on the full-recipe prompt. */
  initialView?: 'recipe' | 'ideas';
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

/* ── Progress — a bar fed by the streamed size, and the time left ──── */

const GenProgressBar: React.FC<{ progress: number; remainingMs: number | null; elapsed: number }> = ({
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

/* ── The generator ─────────────────────────────────────────────────── */

export const AiRecipeGenerator: React.FC<AiRecipeGeneratorProps> = ({
  onGenerated,
  onClose,
  tabSlot,
  phoneMode,
  initialView,
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // A brainstorm parked by "Find existing" (lib/ideas-session): the search
  // page's back arrow reopens this on the ideas view, and everything below
  // seeds from it so the session resumes exactly where it was.
  const [restored] = useState(() => (initialView === 'ideas' ? takeIdeasSession() : null));
  // Optional guidelines.
  const [difficulty, setDifficulty] = useState(restored?.guidelines.difficulty ?? '');
  const [timeBudget, setTimeBudget] = useState(restored?.guidelines.timeBudget ?? '');
  const [servings, setServings] = useState<number | null>(restored?.guidelines.servings ?? null);
  const [course, setCourse] = useState(restored?.guidelines.course ?? '');
  const [dietary, setDietary] = useState<string[]>(restored?.guidelines.dietary ?? []);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* ── Ideas mode ──
     All of the brainstorm session lives HERE, in component state: the
     search sub-view below renders as a sibling layer inside this
     component precisely so opening it never unmounts the grid. */
  const [view, setView] = useState<'recipe' | 'ideas'>(initialView ?? 'recipe');
  /** The mood the current batch was brainstormed from. The input clears on
   *  send (a sent message doesn't linger in a composer), so "More ideas"
   *  needs the mood remembered somewhere. */
  const [ideasPrompt, setIdeasPrompt] = useState(restored?.ideasPrompt ?? '');
  const [ideas, setIdeas] = useState<RecipeIdea[]>(restored?.ideas ?? []);
  const [selectedTitles, setSelectedTitles] = useState<string[]>(restored?.selectedTitles ?? []);
  const [ideasLoading, setIdeasLoading] = useState(false);
  /** Every title ever shown this session — the server-side no-repeats list. */
  const [shownTitles, setShownTitles] = useState<string[]>(restored?.shownTitles ?? []);

  /* ── Progress ──
     The stream reports characters received; lib/gen-progress turns that
     (plus elapsed time and what this kind of request usually produces)
     into a bar and a time-left estimate, and learns from each finish. */
  const [genKind, setGenKind] = useState<GenKind | null>(null);
  const [progress, setProgress] = useState(0);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const genCharsRef = useRef(0);
  const genStartRef = useRef(0);
  const expectedRef = useRef<GenExpectation | null>(null);
  const beginProgress = (kind: GenKind) => {
    genCharsRef.current = 0;
    genStartRef.current = Date.now();
    expectedRef.current = loadExpectation(kind);
    setProgress(0);
    setRemainingMs(null);
    setGenKind(kind);
  };
  const onProgress = (chars: number) => { genCharsRef.current = chars; };
  /** Snap the bar to full and teach the estimator what this one cost. */
  const finishProgress = (kind: GenKind) => {
    recordGeneration(kind, { chars: genCharsRef.current, ms: Date.now() - genStartRef.current });
    setProgress(1);
    setRemainingMs(0);
  };
  /** Bumped when a 4th selection is refused, to pulse the count. */
  const [capPulse, setCapPulse] = useState(0);
  // Combine-from-ideas sheet.
  const [combineOpen, setCombineOpen] = useState(false);
  const [combineNotes, setCombineNotes] = useState('');
  const [combining, setCombining] = useState(false);
  const navigate = useNavigate();
  const { handleAiError } = usePaywall();

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
    const busy = loading || combining || ideasLoading;
    if (!busy) {
      setElapsed(0);
      setProgress(0);
      setRemainingMs(null);
      setGenKind(null);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const tick = () => {
      const elapsedMs = Date.now() - started;
      setElapsed(Math.floor(elapsedMs / 1000));
      const expected = expectedRef.current;
      if (!expected) return;
      const input = { elapsedMs, chars: genCharsRef.current, expected };
      // Monotonic: a re-estimate never walks the bar backwards.
      setProgress((prev) => Math.max(prev, estimateProgress(input)));
      setRemainingMs(estimateRemainingMs(input));
    };
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [loading, combining, ideasLoading]);

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
    beginProgress('recipe');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await generateRecipe(finalPrompt, controller.signal, {
        difficulty: (difficulty || undefined) as 'Easy' | 'Medium' | 'Hard' | undefined,
        constraints: composeConstraints(),
        onProgress,
      });
      // Cancelled — the user already moved on; don't flash an error.
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      if (result.ok && result.meal) {
        finishProgress('recipe');
        onGenerated(result.meal, { prompt: describeRequest() || finalPrompt, rawInput: result.recipe });
      } else if (!handleAiError('recipe-generate', result)) {
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

  /* ── Ideas handlers ── */

  const selectedIdeas = ideas.filter((i) => selectedTitles.includes(i.title));

  const handleBrainstorm = async () => {
    if (ideasLoading || loading || combining) return;
    setError(null);
    setOpenMenu(null);
    setIdeasLoading(true);
    beginProgress('ideas');
    // A typed mood replaces the remembered one and leaves the composer;
    // "More ideas" with nothing typed re-brainstorms the remembered mood.
    const typed = prompt.trim();
    const mood = typed || ideasPrompt;
    if (typed) { setIdeasPrompt(typed); setPrompt(''); }
    const controller = new AbortController();
    abortRef.current = controller;
    const res = await generateRecipeIdeas(mood, {
      difficulty: (difficulty || undefined) as 'Easy' | 'Medium' | 'Hard' | undefined,
      constraints: composeConstraints(),
      avoidTitles: shownTitles,
      signal: controller.signal,
      onProgress,
    });
    if (controller.signal.aborted) return;
    abortRef.current = null;
    setIdeasLoading(false);
    if (!res.ok || !res.ideas) {
      if (!handleAiError('recipe-ideas', res)) setError(res.error || 'Something went wrong. Try again.');
      return;
    }
    finishProgress('ideas');
    const incoming = res.ideas;
    // Selected cards stay pinned at the front across refreshes; the new
    // batch fills in behind them (minus any title collisions).
    setIdeas((prev) => {
      const kept = prev.filter((i) => selectedTitles.includes(i.title));
      const keptTitles = new Set(kept.map((i) => i.title));
      return [...kept, ...incoming.filter((i) => !keptTitles.has(i.title))];
    });
    setShownTitles((prev) => [...prev, ...incoming.map((i) => i.title)].slice(-40));
  };

  const toggleIdea = (title: string) => {
    setSelectedTitles((prev) => {
      if (prev.includes(title)) return prev.filter((t) => t !== title);
      if (prev.length >= 3) {
        // The cap is the message — pulse the count instead of a toast.
        setCapPulse(Date.now());
        return prev;
      }
      return [...prev, title];
    });
  };

  /** One idea → the full recipe, through the ordinary create pipeline
   *  (same loading orb, same draft-sheet landing). */
  const handleCreateFromIdea = async (idea: RecipeIdea) => {
    if (loading || combining) return;
    setError(null);
    setOpenMenu(null);
    setLoading(true);
    beginProgress('recipe');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const ideaPrompt = `${idea.title} — ${idea.blurb}`;
      const result = await generateRecipe(ideaPrompt, controller.signal, {
        difficulty: (difficulty || idea.difficulty) as 'Easy' | 'Medium' | 'Hard',
        constraints: composeConstraints(),
        onProgress,
      });
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      if (result.ok && result.meal) {
        finishProgress('recipe');
        onGenerated(result.meal, { prompt: idea.title, rawInput: result.recipe });
      } else if (!handleAiError('recipe-generate', result)) {
        setError(result.error || 'Something went wrong. Try again.');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      console.warn('[AiRecipeGenerator] idea generate failed:', err);
      setError('Something went wrong. Try again.');
    }
  };

  /** 2–3 selected ideas → one merged recipe. Runs INSIDE the notes sheet
   *  (its own progress + cancel) rather than the full-screen orb, so the
   *  user can still back out of a 15–30s build. */
  const handleCombine = async () => {
    const chosen = selectedIdeas.slice(0, 3);
    if (chosen.length < 2 || combining) return;
    setError(null);
    setCombining(true);
    beginProgress('combine');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await combineRecipes(
        chosen.map((idea) => ({ kind: 'idea' as const, idea })),
        {
          notes: combineNotes,
          difficulty: (difficulty || undefined) as 'Easy' | 'Medium' | 'Hard' | undefined,
          constraints: composeConstraints(),
          signal: controller.signal,
          onProgress,
        },
      );
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setCombining(false);
      if (result.ok && result.meal) {
        finishProgress('combine');
        setCombineOpen(false);
        onGenerated(result.meal, {
          prompt: `Combined: ${chosen.map((c) => c.title).join(' + ')}`,
          rawInput: result.recipe,
        });
      } else if (!handleAiError('recipe-combine', result)) {
        setError(result.error || 'Something went wrong. Try again.');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setCombining(false);
      console.warn('[AiRecipeGenerator] combine failed:', err);
      setError('Something went wrong. Try again.');
    }
  };

  const handleCancelCombine = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCombining(false);
  };

  /** Per-idea "is there already a real one?" — leaves the modal for the
   *  real Search page's Recipes tab with the title as the query (the
   *  page consumes `state.recipeQuery` once). The ideas session ends;
   *  the user asked for the actual search page, not a copy of it here. */
  const openSearchFor = (idea: RecipeIdea) => {
    saveIdeasSession({
      ideas, selectedTitles, ideasPrompt, shownTitles,
      guidelines: { difficulty, timeBudget, servings, course, dietary },
    });
    onClose();
    navigate('/search', { state: { recipeQuery: idea.title } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter inserts a newline. IME confirm-Enter
    // commits the composition instead of submitting.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const pickIdea = (ex: string) => {
    setPrompt(ex);
    setError(null);
    if (!phoneMode) textareaRef.current?.focus();
  };

  // Ideas can brainstorm from nothing — "surprise me" is a legitimate ask
  // — so only the full-recipe view requires input.
  const canSubmit = view === 'ideas'
    ? !loading && !ideasLoading && !combining
    : (prompt.trim().length > 0 || hasGuidelines) && !loading;
  const handleSubmit = () => (view === 'ideas' ? void handleBrainstorm() : void handleGenerate());
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
          {/* Full recipe ⇄ Ideas — one decision, so a segment, not tabs. It
              lives in the header (not the dock) so the dock stays a single
              band of pills + prompt above the keyboard. */}
          <div className="rcxa-mode">
            {([['recipe', 'Recipe'], ['ideas', 'Ideas']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rcxa-mode-btn${view === key ? ' is-on' : ''}`}
                aria-pressed={view === key}
                onClick={() => { setView(key); setError(null); }}
              >
                {key === 'ideas' ? <Lightbulb size={12} strokeWidth={2.2} /> : <Sparkles size={12} strokeWidth={2.2} />}
                {label}
              </button>
            ))}
          </div>
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
          {!loading && view === 'ideas' ? (
            <motion.div
              key="ideas"
              className="rcxa-ideas-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {ideas.length === 0 && !ideasLoading ? (
                <div className="rcxa-hero rcxa-hero-ideas">
                  <div className="rcxa-orb"><Lightbulb size={20} strokeWidth={1.9} /></div>
                  <h3 className="rcxa-title">What are you in the mood for?</h3>
                  <p className="rcxa-sub">
                    Say a craving, a cuisine, or nothing at all — you&rsquo;ll get eight
                    ideas to pick from, search for, or combine.
                  </p>
                </div>
              ) : ideas.length === 0 ? (
                <div className="rcx-ai-loading">
                  <div className="rcx-ai-orb"><Lightbulb size={30} /></div>
                  <div className="rcx-ai-loading-title">Brainstorming…</div>
                  <GenProgressBar progress={progress} remainingMs={remainingMs} elapsed={elapsed} />
                </div>
              ) : (
                <>
                  <div className="rcxa-grid-head">
                    <span className="rcxa-grid-mood">{ideasPrompt || 'A little of everything'}</span>
                    <span className="rcxa-grid-count">
                      {selectedTitles.length > 0 ? `${selectedTitles.length} of 3 picked` : 'Pick up to 3'}
                    </span>
                  </div>
                  <div className="rcxa-grid">
                    {ideas.map((idea) => {
                      const on = selectedTitles.includes(idea.title);
                      return (
                        <div
                          key={idea.title}
                          role="button"
                          tabIndex={0}
                          aria-pressed={on}
                          className={`rcxa-card${on ? ' is-on' : ''}`}
                          onClick={() => toggleIdea(idea.title)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIdea(idea.title); } }}
                        >
                          <span className="rcxa-card-body">
                            <span className="rcxa-card-title">{idea.title}</span>
                            <span className="rcxa-card-blurb">{idea.blurb}</span>
                            <span className="rcxa-card-foot">
                              <span className="rcxa-card-meta">
                                {[idea.totalTimeMin ? `${idea.totalTimeMin} min` : '', idea.difficulty, idea.cuisine]
                                  .filter(Boolean).join(' · ')}
                              </span>
                              {phoneMode && (
                                <button
                                  type="button"
                                  className="rcxa-card-search"
                                  aria-label={`Search existing recipes for ${idea.title}`}
                                  onClick={(e) => { e.stopPropagation(); openSearchFor(idea); }}
                                >
                                  <Search size={11} strokeWidth={2.4} /> Find existing
                                </button>
                              )}
                            </span>
                          </span>
                          <span className={`rcxa-card-check${on ? ' is-on' : ''}`} aria-hidden>
                            <Check size={13} strokeWidth={3} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rcxa-grid-cta">
                    <button
                      type="button"
                      className="rcxa-more"
                      onClick={() => void handleBrainstorm()}
                      disabled={ideasLoading}
                    >
                      {ideasLoading ? `Thinking… ${Math.round(progress * 100)}%` : 'More ideas'}
                    </button>
                    {selectedTitles.length === 1 && (
                      <button
                        type="button"
                        className="rcxa-cta"
                        onClick={() => void handleCreateFromIdea(selectedIdeas[0])}
                      >
                        <Sparkles size={14} /> Create this recipe
                      </button>
                    )}
                    {selectedTitles.length >= 2 && (
                      <button
                        type="button"
                        className="rcxa-cta"
                        onClick={() => { setError(null); setCombineOpen(true); }}
                      >
                        <Sparkles size={14} />
                        <span key={capPulse} className="rcxa-cta-count">Combine these {selectedTitles.length}</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          ) : loading ? (
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
              <GenProgressBar progress={progress} remainingMs={remainingMs} elapsed={elapsed} />
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
                placeholder={view === 'ideas'
                  ? (ideas.length > 0 ? 'Try a different mood…' : 'What are you in the mood for?')
                  : 'Describe your dish…'}
                rows={1}
              />
              <button
                type="button"
                className="rcxa-send"
                onClick={handleSubmit}
                disabled={!canSubmit}
                aria-label={view === 'ideas' ? 'Get ideas' : 'Generate recipe'}
              >
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            </div>

            {/* Ideas aren't drafts — nothing to review yet, so no disclaimer
                spending a line under the prompt. */}
            {view !== 'ideas' && (
              <p className="rcxa-note">AI drafts can make mistakes — review before publishing.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Combine notes sheet ──
          Optional steering, and the generation runs IN HERE with its own
          progress + cancel — a 15–30s build needs a visible pulse and a
          way out, and the full-screen orb belongs to single creates. */}
      <AnimatePresence>
        {combineOpen && (
          <motion.div
            key="combine"
            className="rcxa-combine-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => { if (!combining) setCombineOpen(false); else handleCancelCombine(); }}
          >
            <motion.div
              className="rcxa-combine-sheet"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="rcxa-combine-title">
                Combine {selectedIdeas.slice(0, 3).map((i) => i.title).join(' + ')}
              </h4>
              {combining ? (
                <div className="rcxa-combine-progress">
                  <div className="rcx-ai-orb"><ChefHat size={24} /></div>
                  <p>{elapsed >= 18 ? 'Almost there…' : 'Merging them into one dish…'}</p>
                  <GenProgressBar progress={progress} remainingMs={remainingMs} elapsed={elapsed} />
                  <button type="button" className="rcxa-cancel" onClick={handleCancelCombine}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <p className="rcxa-combine-sub">What do you want from each? <span>Optional — leave it blank and the kitchen decides.</span></p>
                  <textarea
                    className="rcxa-combine-notes"
                    value={combineNotes}
                    onChange={(e) => setCombineNotes(e.target.value)}
                    placeholder="e.g. the crust from the galette, the filling from the pie"
                    rows={2}
                    maxLength={600}
                  />
                  {error && <p className="rcxa-error"><AlertCircle size={13} /> {error}</p>}
                  <div className="rcxa-combine-actions">
                    <button type="button" className="rcxa-cancel" onClick={() => setCombineOpen(false)}>
                      Back
                    </button>
                    <button type="button" className="rcxa-cta" onClick={() => void handleCombine()}>
                      <Sparkles size={14} /> Combine
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
