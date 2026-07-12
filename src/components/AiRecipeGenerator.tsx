// "Create with AI" mode of the recipe modal — describe a dish (or tap an
// idea), set optional guidelines, and get a complete editable draft that
// lands on the Advanced builder's Review step. Shares the rcx- design
// language with the Advanced builder: same header, chips, and footer CTA.

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, ChefHat, AlertCircle, X, Loader2, Minus, Plus } from 'lucide-react';
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
  /** The Basic / Advanced / AI tab strip, injected by the parent so it
   *  stays consistent with the other tabs. */
  tabSlot?: React.ReactNode;
  phoneMode?: boolean;
}

// Example prompts shown as a tappable suggestion strip under the prompt
// box. Concrete and varied so users see the breadth of what they can
// ask for; tapping one fills the prompt (and can still be edited).
const EXAMPLES = [
  'A cozy weeknight mushroom risotto for 4',
  'The best fudgy brown-butter brownies',
  'A high-protein chicken meal-prep bowl',
  'Crispy Korean fried chicken wings',
  'A vegan Thai red curry, ready in 30 min',
  'Classic New York–style cheesecake',
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

const DISCLAIMER = 'AI-generated recipes can have mistakes. Review measurements and steps before cooking.';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Desktop only — auto-focusing on phone pops the keyboard the instant
    // the modal opens, hiding the header and guidelines. Let the user tap in.
    if (phoneMode) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [phoneMode]);

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
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await generateRecipe(finalPrompt, controller.signal, {
      difficulty: (difficulty || undefined) as 'Easy' | 'Medium' | 'Hard' | undefined,
      constraints: composeConstraints(),
    });
    abortRef.current = null;
    setLoading(false);
    if (result.ok && result.meal) {
      onGenerated(result.meal, { prompt: describeRequest() || finalPrompt, rawInput: result.recipe });
    } else {
      setError(result.error || 'Something went wrong. Try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const canSubmit = (prompt.trim().length > 0 || hasGuidelines) && !loading;
  const loadingTitle = elapsed >= 18 ? 'Almost there…' : elapsed >= 8 ? 'Writing the steps…' : 'Drafting your recipe…';

  const ctaLabel = loading
    ? 'Writing your recipe…'
    : canSubmit ? 'Generate recipe' : 'Describe or pick an idea to generate';

  return (
    <div className={`rcx${phoneMode ? ' is-phone' : ''}`}>
      {/* ── Header ── */}
      <div className="rcx-head">
        <div className="rcx-head-row">
          {tabSlot}
          <div className="rcx-head-actions">
            <button type="button" className="rcx-head-close" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="rcx-title-row">
          <h2 className="rcx-step-title">Build with AI</h2>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="rcx-body" style={{ paddingBottom: 'calc(120px + var(--kb-height, 0px))' }}>
        {loading ? (
          <div className="rcx-ai-loading">
            <div className="rcx-ai-orb"><ChefHat size={32} /></div>
            <div className="rcx-ai-loading-title">{loadingTitle}</div>
            <p className="rcx-ai-loading-sub">
              Measuring ingredients, sequencing steps, and dialing in the timing.
            </p>
            {elapsed >= 3 && <span className="rcx-ai-loading-secs">{elapsed}s</span>}
          </div>
        ) : (
          <div className="rcx-step-anim rcx-ai-stack">
            {/* Prompt + tappable idea strip */}
            <div>
              <div className="rcx-kicker">What should we cook?</div>
              <textarea
                ref={textareaRef}
                className={cn('rcx-prompt', error && 'is-error')}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="A cozy pasta for two with things I already have — garlic, a lemon, parmesan, and half a box of rigatoni."
                rows={3}
              />
              {error && (
                <p className="rcx-modal-error"><AlertCircle size={13} /> {error}</p>
              )}
              <div className="rcx-idea-strip">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className={`rcx-idea-pill${prompt === ex ? ' is-on' : ''}`}
                    onClick={() => { setPrompt(ex); setError(null); }}
                  >
                    <Sparkles size={11} />
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {/* Guidelines — one compact card, a labeled row per constraint */}
            <div>
              <div className="rcx-kicker">
                Guidelines<span className="rcx-kicker-opt"> · optional — the AI will respect these</span>
              </div>
              <div className="rcx-card">
                <div className="rcx-ai-row">
                  <span className="rcx-ai-row-label">Time</span>
                  <div className="rcx-ai-row-chips">
                    {TIME_OPTIONS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`rcx-chip is-mini${timeBudget === t.key ? ' is-on' : ''}`}
                        onClick={() => setTimeBudget((prev) => (prev === t.key ? '' : t.key))}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rcx-ai-row">
                  <span className="rcx-ai-row-label">Skill</span>
                  <div className="rcx-ai-row-chips">
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`rcx-chip is-mini${difficulty === d ? ' is-on' : ''}`}
                        onClick={() => setDifficulty((prev) => (prev === d ? '' : d))}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rcx-ai-row">
                  <span className="rcx-ai-row-label">Course</span>
                  <div className="rcx-ai-row-chips">
                    {COURSE_OPTIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`rcx-chip is-mini${course === c ? ' is-on' : ''}`}
                        onClick={() => setCourse((prev) => (prev === c ? '' : c))}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rcx-ai-row">
                  <span className="rcx-ai-row-label">Dietary</span>
                  <div className="rcx-ai-row-chips">
                    {DIETARY_OPTIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`rcx-chip is-mini${dietary.includes(d) ? ' is-on' : ''}`}
                        onClick={() => toggleDietary(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rcx-ai-row">
                  <span className="rcx-ai-row-label">Serves</span>
                  <div className="rcx-ai-serves">
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
                </div>
              </div>
            </div>

            <p className="rcx-fineprint">
              The AI writes a full draft — name, timing, ingredients, and method — into the builder.
              Everything stays editable before you publish. {DISCLAIMER}
            </p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="rcx-foot">
        <button
          type="button"
          className={cn('rcx-foot-cta', !canSubmit && !loading && 'is-disabled', (canSubmit || loading) && 'is-publish', loading && 'is-busy')}
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? <Loader2 size={15} className="rcx-spin" /> : canSubmit ? <Sparkles size={14} /> : null}
          {ctaLabel}
        </button>
      </div>
    </div>
  );
};
