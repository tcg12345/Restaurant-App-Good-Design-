import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowUp, ChefHat, AlertCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { generateRecipe } from '../lib/build-recipe-client';
import type { HomeMeal } from '../contexts/ListsContext';

interface AiRecipeGeneratorProps {
  /** Called with a fully-formed HomeMeal once the AI finishes. The
   *  parent seeds the Advanced builder with it for review + publish. */
  onGenerated: (meal: HomeMeal) => void;
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

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await generateRecipe(trimmed, controller.signal);
    abortRef.current = null;
    setLoading(false);
    if (result.ok && result.meal) {
      onGenerated(result.meal);
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

  const canSubmit = prompt.trim().length > 0 && !loading;

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
