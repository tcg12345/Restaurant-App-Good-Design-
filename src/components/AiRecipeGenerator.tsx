import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowUp, ArrowRight, ChefHat, AlertCircle, X, PenLine, Gauge, Eye, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { generateRecipe, type RecipeConstraints } from '../lib/build-recipe-client';
import type { HomeMeal } from '../contexts/ListsContext';

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

// Example prompts shown as tappable items to seed the input. Concrete
// and varied so users see the breadth of what they can ask for.
const EXAMPLES = [
  'A cozy weeknight mushroom risotto for 4',
  'The best fudgy brown-butter brownies',
  'A high-protein chicken meal-prep bowl',
  'Crispy Korean fried chicken wings',
  'A vegan Thai red curry, ready in 30 min',
  'Classic New York–style cheesecake',
];

// Optional guidelines the user can set; they're folded into the prompt as
// plain-language requirements (the build-recipe function honors any
// constraint in the prompt, so no API change is needed).
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
const TIME_OPTIONS: { key: string; label: string }[] = [
  { key: '30', label: 'Under 30 min' },
  { key: '60', label: 'Under 1 hr' },
  { key: '120', label: 'Under 2 hr' },
];
const SERVING_OPTIONS = [1, 2, 4, 6, 8];
const COURSE_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Side'];
const DIETARY_OPTIONS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'High-protein', 'Low-carb'];

const AI_DESC =
  "Describe the dish — flavors, servings, dietary needs, time budget — and I'll draft a complete recipe you can review, tweak, and publish.";
const DISCLAIMER = 'AI-generated recipes can have mistakes. Review measurements and steps before cooking.';

// Rail "table of contents" — mirrors the Advanced builder's step rail,
// but the entries are section anchors rather than a linear wizard.
const AI_STEPS: { title: string; sub: string; icon: React.ReactNode }[] = [
  { title: 'Describe it', sub: 'Flavors, time, servings', icon: <PenLine size={14} /> },
  { title: 'Set guidelines', sub: 'Optional constraints', icon: <Gauge size={14} /> },
  { title: 'Review & publish', sub: 'You stay in control', icon: <Eye size={14} /> },
];

// Guideline dropdown — a styled native <select> with a chevron.
const GuideSelect: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, value, onChange, options }) => (
  <div className="arb-guide-field">
    <label className="arb-guide-label">{label}</label>
    <div className="arb-select-wrap">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={16} className="arb-select-chev" />
    </div>
  </div>
);

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

  // Guidelines travel to the API as STRUCTURED constraints (difficulty,
  // time budget, servings, course, dietary) rather than being folded into
  // the prompt prose — the server renders them as an explicit hard-
  // requirement checklist the model must satisfy and re-check, which is
  // far more reliable than hoping it notices "ready in under 1 hr" inside
  // a sentence.
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

  // ── Shared body (prompt + guidelines + inspiration), used on both
  //    phone and desktop inside the .arb-pane-body. ──
  const body = loading ? (
    <div className="arb-ai-loading">
      <motion.div
        className="arb-ai-loading-orb"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ChefHat size={34} />
      </motion.div>
      <div>
        <div className="arb-ai-loading-title">{loadingTitle}</div>
        <p className="arb-ai-loading-sub" style={{ marginTop: 6 }}>
          Measuring ingredients, sequencing steps, and dialing in the timing.
        </p>
      </div>
      {elapsed >= 3 && <span className="arb-ai-loading-secs">{elapsed}s</span>}
    </div>
  ) : (
    <>
      {phoneMode && (
        <p className="arb-pane-sub" style={{ marginTop: 0, marginBottom: 18 }}>{AI_DESC}</p>
      )}

      {/* Prompt box */}
      <div className={cn('arb-prompt', error && 'is-error')}>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder="e.g. A creamy one-pot Tuscan chicken pasta for 4, ready in under 45 minutes…"
          rows={4}
        />
        <div className="arb-prompt-foot">
          <span className="arb-prompt-hint">
            <span className="arb-kbd">Enter</span>
            {prompt.trim().length > 0 ? 'to generate · Shift+Enter for a new line' : 'to generate'}
          </span>
          <button
            type="button"
            className="arb-prompt-send"
            onClick={handleGenerate}
            disabled={!canSubmit}
            aria-label="Generate recipe"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {error && (
        <div className="arb-ai-error">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <p>{error}</p>
        </div>
      )}

      {/* Guidelines — optional, as dropdowns */}
      <div className="arb-sec" style={{ marginTop: 26 }}>
        <div className="arb-sec-label">
          Guidelines <span className="opt">· optional</span>
        </div>
        <div className="arb-guide-grid">
          <GuideSelect label="Difficulty" value={difficulty} onChange={setDifficulty}
            options={DIFFICULTIES.map((d) => ({ value: d, label: d }))} />
          <GuideSelect label="Total time" value={timeBudget} onChange={setTimeBudget}
            options={TIME_OPTIONS.map((t) => ({ value: t.key, label: t.label }))} />
          <GuideSelect label="Servings" value={servings != null ? String(servings) : ''}
            onChange={(v) => setServings(v ? Number(v) : null)}
            options={SERVING_OPTIONS.map((s) => ({ value: String(s), label: String(s) }))} />
          <GuideSelect label="Meal" value={course} onChange={setCourse}
            options={COURSE_OPTIONS.map((c) => ({ value: c, label: c }))} />
          <div className="arb-guide-field is-full">
            <label className="arb-guide-label">
              Dietary <span style={{ color: 'var(--muted-2, #B8AFA4)' }}>· select any</span>
            </label>
            <div className="arb-diet-chips">
              {DIETARY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDietary(d)}
                  className={cn('arb-diet-chip', dietary.includes(d) && 'is-active')}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Inspiration list */}
      <div className="arb-sec">
        <div className="arb-sec-label">Need inspiration?</div>
        <div className="arb-inspo-list">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="arb-inspo-item"
              onClick={() => { setPrompt(ex); setError(null); textareaRef.current?.focus(); }}
            >
              <span className="arb-inspo-icon"><Sparkles size={16} /></span>
              <span className="arb-inspo-text">{ex}</span>
              <ArrowRight size={16} className="arb-inspo-arrow" />
            </button>
          ))}
        </div>
      </div>

      {phoneMode && (
        <p className="arb-foot-note" style={{ marginTop: 22, textAlign: 'center', maxWidth: 'none' }}>
          {DISCLAIMER}
        </p>
      )}
    </>
  );

  return (
    <div className={cn('advanced-recipe-builder', phoneMode && 'is-phone')}>
      {!phoneMode && (
        <button type="button" className="arb-pane-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      )}

      {/* Mobile sticky header — tab strip + title (replaces the rail). */}
      {phoneMode && (
        <header className="arb-m-header">
          <div className="arb-m-tabs">
            {tabSlot}
            <button type="button" className="arb-m-header-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="arb-m-titleblock-left">
            <div className="arb-m-header-eyebrow">Create with AI</div>
            <div className="arb-m-header-title">What do you want to cook?</div>
          </div>
        </header>
      )}

      <div className="arb-shell">
        {/* Desktop left rail */}
        {!phoneMode && (
          <nav className="arb-rail">
            <div className="arb-rail-eyebrow">New recipe</div>
            <div className="arb-rail-title">Cook with <em>intent</em>.</div>
            {tabSlot && <div style={{ marginTop: 16 }}>{tabSlot}</div>}
            <p className="arb-rail-desc">
              Describe a dish in your own words and get a complete, editable draft in seconds.
            </p>
            <ol className="arb-rail-steps is-toc">
              {AI_STEPS.map((s, i) => (
                <li key={s.title} className={`arb-rail-step is-toc${i === 0 ? ' is-current' : ''}`}>
                  <span className="arb-rail-step-circle">{s.icon}</span>
                  <span className="arb-rail-step-text">
                    <span className="arb-rail-step-title">{s.title}</span>
                    <span className="arb-rail-step-sub">{s.sub}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="arb-rail-foot">
              <div className="arb-rail-foot-status">
                <span className="dot" />
                <span>Always editable</span>
                <span style={{ marginLeft: 'auto' }}>Powered by AI</span>
              </div>
            </div>
          </nav>
        )}

        {/* Pane */}
        <div className="arb-pane">
          <div className="arb-pane-head is-flush">
            <div className="arb-pane-eyebrow is-pill">
              <Sparkles size={12} /> Create with AI
            </div>
            <h2 className="arb-pane-title is-hero">What do you want to cook?</h2>
            <p className="arb-pane-sub">{AI_DESC}</p>
          </div>

          <div className="arb-pane-body">{body}</div>

          {/* Mobile footer dock — single primary action. */}
          {phoneMode && (
            <div className="arb-m-foot is-single">
              <button
                type="button"
                className="arb-m-foot-primary"
                onClick={handleGenerate}
                disabled={!canSubmit}
              >
                <Sparkles size={16} /> {loading ? 'Generating…' : 'Generate recipe'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Desktop sticky footer */}
      {!phoneMode && (
        <div className="arb-foot">
          <span className="arb-foot-note">{DISCLAIMER}</span>
          <div className="arb-foot-right">
            <button type="button" className="arb-foot-publish" onClick={handleGenerate} disabled={!canSubmit}>
              <Sparkles size={16} /> {loading ? 'Generating…' : 'Generate recipe'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
