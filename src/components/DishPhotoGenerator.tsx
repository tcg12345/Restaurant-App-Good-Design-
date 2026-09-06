// "Recreate a dish" mode of the recipe modal — one photo of a plated dish
// in, one complete AI-authored draft out. The photo comes from the
// camera, the library, the user's own rating photos, or a restaurant's
// member photos (PhotoSourceSheet); an optional hint and the shared
// guideline pills steer the model; the result lands on the same draft
// sheet every AI create uses.

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GlassButton } from '../lib/glass-buttons';
import { AlertCircle, ArrowRight, Camera, Check, ChefHat, ImagePlus, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { usePaywall } from '../contexts/PaywallContext';
import { QuotaMeter } from './pro/QuotaMeter';
import type { HomeMeal, DishPhotoRef } from '../contexts/ListsContext';
import { generateRecipeFromPhoto } from '../lib/build-recipe-client';
import {
  loadExpectation, recordGeneration, type GenExpectation,
} from '../lib/gen-progress';
import { dishPhotoHint, dishPhotoUrlToFile, prepareDishPhoto, type DishPhotoOrigin } from '../lib/dish-photo';
import {
  GuidelinePills, EMPTY_GUIDELINES, composeConstraints, describeGuidelines,
  type Guidelines, type MenuKey,
} from './recipe-guidelines';
import { PhotoSourceSheet } from './PhotoSourceSheet';
import './AdvancedRecipeBuilder.css';
import './RecipeBuilder.css';
import './DishRecreation.css';

export interface DishPhoto {
  /** JPEG data URL sized for the model (lib/dish-photo). */
  dataUrl: string;
  origin: DishPhotoOrigin;
}

interface DishPhotoGeneratorProps {
  /** Called with the finished draft. `photo` lets the parent decide on
   *  the cover and record provenance. */
  onGenerated: (meal: HomeMeal, meta: { prompt: string; rawInput: unknown }, photo: DishPhoto) => void;
  onClose: () => void;
  /** The "‹ New recipe" chip, injected by the parent. */
  tabSlot?: React.ReactNode;
  phoneMode?: boolean;
  /** A photo handed in from outside (the restaurant gallery). Loaded on
   *  mount; the slot stays empty if it cannot be fetched. */
  initialPhoto?: DishPhotoRef;
}

const MAX_HINT = 600;

export const DishPhotoGenerator: React.FC<DishPhotoGeneratorProps> = ({
  onGenerated,
  onClose,
  tabSlot,
  phoneMode,
  initialPhoto,
}) => {
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const { handleAiError } = usePaywall();
  const [photo, setPhoto] = useState<DishPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState(!!initialPhoto);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [guidelines, setGuidelines] = useState<Guidelines>(EMPTY_GUIDELINES);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const hintRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Failures land right under the photo, at the top of the page — the
   *  first cut put them under the pills, below the fold, where a failed
   *  run just looked like the panel silently coming back. */
  const failWith = (message: string) => {
    setError(message);
    requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  /* ── Progress ──
     Two real phases, one continuous bar. While the model is still reading
     the image nothing streams, so the bar eases along a time curve toward
     a third; the moment recipe JSON starts arriving it hands over to the
     streamed size against what a photo recipe usually weighs, with a slow
     time creep underneath so it never stalls between chunks. Monotonic,
     ticked every 100ms, and capped short of full until the stream ends. */
  const [progress, setProgress] = useState(0);
  /** False while the model is still reading the photo; true once the
   *  first recipe tokens stream in. Drives the phase label + the sweep. */
  const [writing, setWriting] = useState(false);
  const genCharsRef = useRef(0);
  const genStartRef = useRef(0);
  const writingStartRef = useRef(0);
  const writingBaseRef = useRef(0);
  const progressRef = useRef(0);
  const expectedRef = useRef<GenExpectation | null>(null);

  const ANALYZE_CEILING = 0.34;
  const ANALYZE_TAU_MS = 9000;
  const STREAM_CEILING = 0.96;

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      setProgress(0);
      progressRef.current = 0;
      setWriting(false);
      return;
    }
    const started = Date.now();
    const tick = () => {
      const now = Date.now();
      const elapsedMs = now - started;
      setElapsed(Math.floor(elapsedMs / 1000));
      const expected = expectedRef.current ?? { chars: 9000, ms: 36000 };
      const chars = genCharsRef.current;
      let next: number;
      if (chars <= 0) {
        next = ANALYZE_CEILING * (1 - Math.exp(-elapsedMs / ANALYZE_TAU_MS));
      } else {
        if (!writingStartRef.current) {
          writingStartRef.current = now;
          writingBaseRef.current = progressRef.current;
        }
        const base = writingBaseRef.current;
        const span = STREAM_CEILING - base;
        const bySize = Math.min(1, chars / Math.max(1, expected.chars));
        const byTime = 1 - Math.exp(-(now - writingStartRef.current) / Math.max(1000, expected.ms));
        next = base + span * Math.max(bySize, byTime * 0.85);
      }
      const clamped = Math.min(STREAM_CEILING, Math.max(progressRef.current, next));
      progressRef.current = clamped;
      setProgress(clamped);
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ── The handed-in photo, or an open picker ── */
  useEffect(() => {
    let cancelled = false;
    if (!initialPhoto) {
      return;
    }
    (async () => {
      try {
        const file = await dishPhotoUrlToFile(initialPhoto.url);
        if (!file) throw new Error('unreadable');
        const dataUrl = await prepareDishPhoto(file);
        if (cancelled) return;
        const own = !!user?.id && initialPhoto.ownerUserId === user.id;
        const origin: DishPhotoOrigin = initialPhoto.restaurantId
          ? own
            ? { kind: 'rating', restaurantId: initialPhoto.restaurantId, restaurantName: initialPhoto.restaurantName || '', caption: initialPhoto.caption, url: initialPhoto.url }
            : { kind: 'community', restaurantId: initialPhoto.restaurantId, restaurantName: initialPhoto.restaurantName || '', caption: initialPhoto.caption, url: initialPhoto.url, ownerUserId: initialPhoto.ownerUserId || '' }
          : { kind: 'library' };
        setPhoto({ dataUrl, origin });
      } catch (err) {
        console.warn('[DishPhotoGenerator] could not load the photo:', err);
        if (!cancelled) setError("Couldn't load that photo. Choose another photo to continue.");
      } finally {
        if (!cancelled) setPhotoBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // Mount-only: the seed is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = async (pick: { file: File; origin: DishPhotoOrigin }) => {
    setSheetOpen(false);
    setError(null);
    setPhotoBusy(true);
    try {
      const dataUrl = await prepareDishPhoto(pick.file);
      setPhoto({ dataUrl, origin: pick.origin });
    } catch (err) {
      console.warn('[DishPhotoGenerator] could not read the photo:', err);
      failWith("Couldn't read that photo. Try another one.");
    } finally {
      setPhotoBusy(false);
    }
  };

  /* ── Generate ── */
  const restaurantName = photo && (photo.origin.kind === 'rating' || photo.origin.kind === 'community') ? photo.origin.restaurantName : '';
  const captionLine = photo && (photo.origin.kind === 'rating' || photo.origin.kind === 'community') ? photo.origin.caption : undefined;

  const describeRequest = (): string => {
    const base = hint.trim() || `Recreate the dish in this photo${restaurantName ? ` at ${restaurantName}` : ''}`;
    const parts = describeGuidelines(guidelines);
    return parts.length ? `${base} (${parts.join('; ')})` : base;
  };

  const handleGenerate = async () => {
    if (!photo || abortRef.current || loading || photoBusy) return;
    hintRef.current?.blur();
    bodyRef.current?.scrollTo({ top: 0 });
    setError(null);
    setOpenMenu(null);
    setLoading(true);
    genCharsRef.current = 0;
    genStartRef.current = Date.now();
    writingStartRef.current = 0;
    writingBaseRef.current = 0;
    progressRef.current = 0;
    expectedRef.current = loadExpectation('photo');
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await generateRecipeFromPhoto(photo.dataUrl, {
        hint: dishPhotoHint(hint, photo.origin),
        difficulty: guidelines.difficulty || undefined,
        constraints: composeConstraints(guidelines),
        signal: controller.signal,
        onProgress: (chars) => {
          genCharsRef.current = chars;
          if (chars > 0) setWriting(true);
        },
      });
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      if (result.ok && result.meal) {
        recordGeneration('photo', { chars: genCharsRef.current, ms: Date.now() - genStartRef.current });
        onGenerated(result.meal, { prompt: describeRequest(), rawInput: result.recipe }, photo);
      } else if (result.declined) {
        // The photo stays; a hint usually resolves it.
        failWith(result.declineReason || result.error || "That photo doesn't seem to show a dish.");
        setTimeout(() => hintRef.current?.focus(), 60);
      } else if (!handleAiError('recipe-photo', result)) {
        failWith(result.error || 'Something went wrong. Try again.');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      abortRef.current = null;
      setLoading(false);
      console.warn('[DishPhotoGenerator] generate failed:', err);
      failWith(`Something went wrong. ${err instanceof Error && err.message ? err.message : 'Try again.'}`);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const ctaLabel = photo ? 'Recreate this dish' : 'Choose a dish photo';
  // Phase copy is tied to what is actually happening: nothing has streamed
  // yet → the model is still reading the image; tokens flowing → it is
  // writing; a long tail → nearly done.
  const loadingTitle = !writing ? 'Analyzing the photo…' : progress >= 0.8 ? 'Almost there…' : 'Writing the recipe…';
  const loadingSub = !writing
    ? 'Reading the plate — components, sauces, garnish, and how it was cooked.'
    : 'Measuring ingredients, sequencing steps, and dialing in the timing.';
  const pct = Math.round(progress * 100);
  const transition = { duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <div className={`rcx dish-flow${phoneMode ? ' is-phone' : ''}`}>
      <div className="rcx-head">
        <div className="rcx-head-row">
          {tabSlot}
          <div className="rcx-head-actions">
            <GlassButton id="recipe-dish-close" symbol="xmark" label="Close" onClick={onClose} className="rcx-head-close"><X size={18} /></GlassButton>
          </div>
        </div>
        <div className="dish-steps" aria-label="Recipe progress">
          {['Photo', 'Create', 'Your recipe'].map((step, i) => <span key={step} className={i === (loading ? 1 : 0) ? 'is-current' : i < (loading ? 1 : 0) ? 'is-complete' : ''}><i>{loading && i === 0 ? <Check size={10} /> : i + 1}</i>{step}</span>)}
        </div>
      </div>
      <div ref={bodyRef} className="rcx-body dish-body">
        <AnimatePresence mode="wait" initial={false}>
          {loading && photo ? (
            <motion.div key="creating" initial={{ opacity: 0, y: reduceMotion ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={transition} className="dish-creating">
              <div className="dish-orbit-photo">
                <img src={photo.dataUrl} alt="The dish being recreated" />
                <div className="dish-photo-sheen" aria-hidden="true" />
                <span className="dish-photo-badge"><Sparkles size={17} /></span>
              </div>
              <div className="dish-creating-copy" role="status" aria-live="polite">
                <span className="dish-eyebrow">A little kitchen magic</span>
                <h2>{loadingTitle}</h2>
                <p>{loadingSub}</p>
              </div>
              <div className="dish-activity" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
              <div className="dish-milestones">
                <div className={writing ? 'is-done' : 'is-active'}>{writing ? <Check size={17} /> : <Loader2 size={17} className="rcx-spin" />}<span>Find the flavors<small>Ingredients, textures & technique</small></span></div>
                <div className={writing ? 'is-active' : ''}>{writing ? <Loader2 size={17} className="rcx-spin" /> : <ChefHat size={17} />}<span>Make it cookable<small>Measurements & step-by-step instructions</small></span></div>
              </div>
              <p className="dish-patience">{elapsed >= 60 ? 'Still working on the details. You can cancel and try again at any time.' : 'Good recipes take a moment. We’re working on yours.'}</p>
            </motion.div>
          ) : (
            <motion.div key="setup" initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }} transition={transition} className="dish-setup">
              <div className="dish-intro">
                <span className="dish-eyebrow"><Sparkles size={13} /> From plate to recipe</span>
                <h2>Recreate a dish</h2>
              </div>
              {photo ? (
                <div className="dish-selected">
                  <div className="dish-selected-image">
                    <img src={photo.dataUrl} alt="Your selected dish" />
                    <span className="dish-selected-label"><Check size={13} /> Photo added</span>
                    <button type="button" className="dish-change" onClick={() => setSheetOpen(true)} disabled={photoBusy}><RefreshCw size={14} /> Change</button>
                    {photoBusy && <div className="dish-photo-busy" role="status"><Loader2 size={24} className="rcx-spin" /><span className="sr-only">Preparing photo</span></div>}
                  </div>
                  {(restaurantName || captionLine) && <p className="dish-provenance">{restaurantName && <strong>{restaurantName}</strong>}{captionLine && <span>{captionLine}</span>}</p>}
                </div>
              ) : (
                <button type="button" className="dish-add-photo" disabled={photoBusy} onClick={() => setSheetOpen(true)}>
                  <span className="dish-photo-art" aria-hidden="true"><span /><span /><i>{photoBusy ? <Loader2 size={30} className="rcx-spin" /> : <ImagePlus size={30} strokeWidth={1.5} />}</i></span>
                  <strong>{photoBusy ? 'Getting your photo ready…' : 'Start with a delicious photo'}</strong>
                  <span>Snap a plate, choose from your library,<br />or rediscover a restaurant favorite.</span>
                  <span className="dish-add-link">Choose a photo <ArrowRight size={15} /></span>
                </button>
              )}
              {error && <div className="dish-error" role="alert"><AlertCircle size={18} /><p>{error}</p><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button></div>}
              <div className="dish-details">
                <div className="dish-field-heading"><label htmlFor="dish-hint">Make it yours</label><span>Optional</span></div>
                <textarea id="dish-hint" ref={hintRef} className="dish-hint" value={hint} maxLength={MAX_HINT} onChange={(e) => setHint(e.target.value)} placeholder="The name, a flavor you remember, or a twist you’d like to try…" rows={2} />
                <div className="dish-field-heading"><span>Recipe preferences</span>{describeGuidelines(guidelines).length > 0 && <button type="button" onClick={() => { setGuidelines(EMPTY_GUIDELINES); setOpenMenu(null); }}>Reset</button>}</div>
                <GuidelinePills value={guidelines} onChange={setGuidelines} openMenu={openMenu} onOpenMenu={setOpenMenu} className="dish-guidelines" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="dish-footer">
        {!loading && <QuotaMeter feature="recipe-photo" className="dish-quota" />}
        <button type="button" className={cn('dish-primary', loading && 'is-cancel')} onClick={loading ? handleCancel : photo ? () => void handleGenerate() : () => setSheetOpen(true)} disabled={photoBusy}>
          {loading ? <X size={17} /> : photo ? <Sparkles size={18} /> : <Camera size={18} />}{loading ? 'Cancel generation' : ctaLabel}{!loading && <ArrowRight size={17} />}
        </button>
        <p>{loading ? 'Your photo and preferences will stay here.' : 'An AI interpretation, ready for you to review and refine.'}</p>
      </div>
      <PhotoSourceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onPick={(pick) => void handlePick(pick)} />
    </div>
  );
};
