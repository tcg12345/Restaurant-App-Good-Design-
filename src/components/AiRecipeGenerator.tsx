import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowUp, ChefHat, AlertCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { generateRecipe } from '../lib/build-recipe-client';
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

// Example prompts shown as tappable chips to seed the input. Concrete
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

const guidelinePill = (active: boolean) =>
  cn(
    'px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors',
    active
      ? 'bg-primary text-white border-primary'
      : 'border-on-surface/12 bg-on-surface/[0.02] text-on-surface/65 hover:border-primary/30 hover:text-on-surface',
  );

const GuidelineRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="text-[11px] font-semibold text-on-surface/45 mb-1.5 pl-1">{label}</p>
    <div className="flex flex-wrap gap-2">{children}</div>
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
    const t = setTimeout(() => textareaRef.current?.focus(), phoneMode ? 280 : 150);
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

  // Fold the free-text prompt + any guideline chips into one instruction the
  // recipe generator can honor.
  const composePrompt = (): string => {
    const base = prompt.trim();
    const reqs: string[] = [];
    if (course) reqs.push(`a ${course.toLowerCase()} dish`);
    if (dietary.length) reqs.push(dietary.map((d) => d.toLowerCase()).join(', '));
    if (servings) reqs.push(`serves ${servings}`);
    if (timeBudget) reqs.push(`ready in ${(TIME_OPTIONS.find((t) => t.key === timeBudget)?.label ?? `${timeBudget} min`).toLowerCase()}`);
    if (difficulty) reqs.push(`${difficulty.toLowerCase()} difficulty`);
    if (!base && reqs.length === 0) return '';
    const head = base || 'A recipe';
    return reqs.length ? `${head}. Requirements: ${reqs.join('; ')}.` : head;
  };

  const handleGenerate = async () => {
    const finalPrompt = composePrompt();
    if (!finalPrompt || loading) return;
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await generateRecipe(finalPrompt, controller.signal);
    abortRef.current = null;
    setLoading(false);
    if (result.ok && result.meal) {
      onGenerated(result.meal, { prompt: finalPrompt, rawInput: result.recipe });
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

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab strip + close — mirrors the Basic page header layout. */}
      <div className="px-6 pt-safe-5 sm:pt-6 pb-2 flex items-center justify-between flex-shrink-0 gap-2">
        {tabSlot}
        <button
          onClick={onClose}
          className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"
          aria-label="Close"
        >
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-4 flex flex-col">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 py-12">
            <div className="relative">
              <motion.div
                className="w-20 h-20 rounded-3xl bg-primary/[0.08] flex items-center justify-center"
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <ChefHat size={34} className="text-primary" />
              </motion.div>
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ rotate: [0, 18, -10, 0], scale: [1, 1.15, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles size={20} className="text-primary fill-primary/30" />
              </motion.div>
            </div>
            <div className="space-y-1.5">
              <h3 className="font-serif font-bold text-xl text-on-surface">
                {elapsed >= 18 ? 'Almost there…' : elapsed >= 8 ? 'Writing the steps…' : 'Drafting your recipe…'}
              </h3>
              <p className="text-sm text-on-surface/50 max-w-[18rem]">
                Measuring ingredients, sequencing steps, and dialing in the timing.
              </p>
            </div>
            {elapsed >= 3 && (
              <span className="text-[12px] font-semibold text-on-surface/40 tabular-nums px-3 py-1 rounded-full bg-on-surface/[0.05]">
                {elapsed}s
              </span>
            )}
          </div>
        ) : (
          <>
            {/* Hero intro */}
            <div className="pt-2 pb-5 text-center sm:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/[0.08] text-primary text-[11px] font-bold uppercase tracking-wider mb-3">
                <Sparkles size={13} />
                Create with AI
              </div>
              <h2 className="font-serif font-bold text-[26px] leading-tight text-on-surface">
                What do you want to cook?
              </h2>
              <p className="text-sm text-on-surface/55 mt-2 leading-relaxed max-w-md mx-auto sm:mx-0">
                Describe the dish — flavors, servings, dietary needs, time budget — and I'll
                draft a complete recipe you can review, tweak, and publish.
              </p>
            </div>

            {/* Prompt box */}
            <div
              className={cn(
                'rounded-3xl border bg-on-surface/[0.02] transition-colors',
                error ? 'border-red-300' : 'border-on-surface/12 focus-within:border-primary/40',
              )}
            >
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="e.g. A creamy one-pot Tuscan chicken pasta for 4, ready in under 45 minutes…"
                rows={4}
                className="w-full bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed text-on-surface placeholder:text-on-surface/30 focus:outline-none resize-none"
              />
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <span className="text-[11px] text-on-surface/35 pl-2">
                  {prompt.trim().length > 0 ? 'Enter to generate · Shift+Enter for a new line' : 'Press Enter to generate'}
                </span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canSubmit}
                  className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-full transition-all flex-shrink-0',
                    canSubmit
                      ? 'bg-primary text-white hover:opacity-90 shadow-sm'
                      : 'bg-on-surface/[0.06] text-on-surface/30 cursor-not-allowed',
                  )}
                  aria-label="Generate recipe"
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 mt-3 px-4 py-3 rounded-2xl bg-red-50 border border-red-200 text-red-700">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <p className="text-[13px] leading-relaxed">{error}</p>
              </div>
            )}

            {/* Guidelines — optional structured constraints */}
            <div className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface/35 mb-3 pl-1">
                Guidelines <span className="font-medium tracking-normal text-on-surface/30">· optional</span>
              </p>
              <div className="space-y-3.5">
                <GuidelineRow label="Difficulty">
                  {DIFFICULTIES.map((d) => (
                    <button key={d} type="button" onClick={() => setDifficulty(difficulty === d ? '' : d)} className={guidelinePill(difficulty === d)}>{d}</button>
                  ))}
                </GuidelineRow>
                <GuidelineRow label="Total time">
                  {TIME_OPTIONS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setTimeBudget(timeBudget === t.key ? '' : t.key)} className={guidelinePill(timeBudget === t.key)}>{t.label}</button>
                  ))}
                </GuidelineRow>
                <GuidelineRow label="Servings">
                  {SERVING_OPTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => setServings(servings === s ? null : s)} className={guidelinePill(servings === s)}>{s}</button>
                  ))}
                </GuidelineRow>
                <GuidelineRow label="Meal">
                  {COURSE_OPTIONS.map((c) => (
                    <button key={c} type="button" onClick={() => setCourse(course === c ? '' : c)} className={guidelinePill(course === c)}>{c}</button>
                  ))}
                </GuidelineRow>
                <GuidelineRow label="Dietary">
                  {DIETARY_OPTIONS.map((d) => (
                    <button key={d} type="button" onClick={() => toggleDietary(d)} className={guidelinePill(dietary.includes(d))}>{d}</button>
                  ))}
                </GuidelineRow>
              </div>
            </div>

            {/* Example chips */}
            <div className="mt-6">
              <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface/35 mb-2.5 pl-1">
                Need inspiration?
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setPrompt(ex);
                      setError(null);
                      textareaRef.current?.focus();
                    }}
                    className="text-left px-3.5 py-2 rounded-2xl border border-on-surface/12 bg-on-surface/[0.02] text-[12.5px] text-on-surface/70 hover:border-primary/30 hover:bg-primary/[0.04] hover:text-on-surface transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-on-surface/35 mt-auto pt-6 text-center leading-relaxed">
              AI-generated recipes can have mistakes. Review measurements and steps before cooking.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
