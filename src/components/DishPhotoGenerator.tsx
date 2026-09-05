// "Recreate a dish" mode of the recipe modal — one photo of a plated dish
// in, one complete AI-authored draft out. The photo comes from the
// camera, the library, the user's own rating photos, or a restaurant's
// member photos (PhotoSourceSheet); an optional hint and the shared
// guideline pills steer the model; the result lands on the same draft
// sheet every AI create uses.

import React, { useEffect, useRef, useState } from 'react';
import { GlassButton } from '../lib/glass-buttons';
import { AlertCircle, Camera, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { usePaywall } from '../contexts/PaywallContext';
import { QuotaMeter } from './pro/QuotaMeter';
import type { HomeMeal, DishPhotoRef } from '../contexts/ListsContext';
import { generateRecipeFromPhoto } from '../lib/build-recipe-client';
import {
  estimateRemainingMs, formatRemaining, loadExpectation, recordGeneration, type GenExpectation,
} from '../lib/gen-progress';
import { dishPhotoUrlToFile, prepareDishPhoto, type DishPhotoOrigin } from '../lib/dish-photo';
import {
  GuidelinePills, EMPTY_GUIDELINES, composeConstraints, describeGuidelines,
  type Guidelines, type MenuKey,
} from './recipe-guidelines';
import { PhotoSourceSheet } from './PhotoSourceSheet';
import './AdvancedRecipeBuilder.css';
import './RecipeBuilder.css';

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
  const { user } = useAuth();
  const { showToast } = useToast();
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
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
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
      setRemainingMs(null);
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
      setRemainingMs(estimateRemainingMs({ elapsedMs, chars, expected }));
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
      // Nothing to show yet — open the picker once the flow has settled
      // in, so the first tap is already spent.
      const t = setTimeout(() => { if (!cancelled) setSheetOpen(true); }, 420);
      return () => { cancelled = true; clearTimeout(t); };
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
        if (!cancelled) showToast("Couldn't load that photo");
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
      setError("Couldn't read that photo. Try another one.");
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
    if (!photo || loading || photoBusy) return;
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
    setRemainingMs(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await generateRecipeFromPhoto(photo.dataUrl, {
        hint: hint.trim() || undefined,
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

  const canSubmit = !!photo && !loading && !photoBusy;
  const ctaLabel = loading ? 'Recreating…' : photo ? 'Recreate this dish' : 'Add a photo first';
  // Phase copy is tied to what is actually happening: nothing has streamed
  // yet → the model is still reading the image; tokens flowing → it is
  // writing; a long tail → nearly done.
  const loadingTitle = !writing ? 'Analyzing the photo…' : progress >= 0.8 ? 'Almost there…' : 'Writing the recipe…';
  const loadingSub = !writing
    ? 'Reading the plate — components, sauces, garnish, and how it was cooked.'
    : 'Measuring ingredients, sequencing steps, and dialing in the timing.';
  const pct = Math.round(progress * 100);
  const remainingLabel = formatRemaining(remainingMs) || (elapsed >= 2 ? `${elapsed}s` : '');

  return (
    <div className={`rcx${phoneMode ? ' is-phone' : ''}`}>
      {/* ── Header ── */}
      <div className="rcx-head">
        <div className="rcx-head-row">
          {tabSlot}
          <div className="rcx-head-actions">
            <GlassButton id="recipe-dish-close" symbol="xmark" label="Close" onClick={onClose} className="rcx-head-close">
              <X size={14} />
            </GlassButton>
          </div>
        </div>
        <div className="rcx-title-row">
          <h2 className="rcx-step-title">Recreate a dish</h2>
        </div>
      </div>

      {/* ── Body ── */}
      <div ref={bodyRef} className="rcx-body" style={{ paddingBottom: 'calc(120px + var(--kb-height, 0px))' }}>
        {loading && photo ? (
          <div className="rcx-dish-analyze" aria-live="polite">
            {/* The photo stays on the page while it is read: a light sweep
                passes over it during analysis and settles once the recipe
                starts streaming. */}
            <div className={cn('rcx-dish-analyze-photo', writing && 'is-writing')}>
              <img src={photo.dataUrl} alt="The dish being analyzed" />
              <div className="rcx-dish-scan" aria-hidden />
            </div>
            <div className="rcx-dish-analyze-text">
              <div className="rcx-dish-analyze-title">{loadingTitle}</div>
              <p className="rcx-dish-analyze-sub">{loadingSub}</p>
            </div>
            <div className="rcx-dish-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={loadingTitle}>
              <div className="rcx-dish-progress-track">
                <div className="rcx-dish-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="rcx-dish-progress-meta">
                <span>{writing ? 'Writing the recipe' : 'Analyzing the photo'}</span>
                <span>{pct}%{remainingLabel ? ` · ${remainingLabel}` : ''}</span>
              </div>
            </div>
            <button type="button" className="rcxa-cancel" onClick={handleCancel}>Cancel</button>
          </div>
        ) : (
          <div className="rcx-step-anim rcx-ai-stack">
            <div>
              <div className="rcx-kicker">The dish</div>
              {photo ? (
                <>
                  <div className="rcx-dish-photo">
                    <img src={photo.dataUrl} alt="The dish to recreate" />
                    <button type="button" className="rcx-dish-photo-change" onClick={() => setSheetOpen(true)} disabled={photoBusy}>
                      <RefreshCw size={12} strokeWidth={2.4} /> Change
                    </button>
                    {photoBusy && <div className="rcx-dish-photo-busy"><Loader2 size={20} className="rcx-spin" /></div>}
                  </div>
                  {(restaurantName || captionLine) && (
                    <div className="rcx-dish-from">
                      {restaurantName && <strong>At {restaurantName}</strong>}
                      {captionLine && <span>{restaurantName ? ` · ${captionLine}` : captionLine}</span>}
                    </div>
                  )}
                  {error && (
                    <p className="rcx-modal-error" style={{ marginTop: 10 }} role="alert">
                      <AlertCircle size={13} /> {error}
                    </p>
                  )}
                </>
              ) : (
                <div
                  className={cn('rcx-photo-slot', photoBusy && 'is-busy')}
                  onClick={() => { if (!photoBusy) setSheetOpen(true); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheetOpen(true); } }}
                >
                  <span className="rcx-photo-slot-icon">{photoBusy ? <Loader2 size={18} className="rcx-spin" /> : <Camera size={18} />}</span>
                  <span className="rcx-photo-slot-text"><strong>Add a photo</strong> of the plate</span>
                  <span className="rcx-photo-slot-sub">
                    From your camera, your library, your ratings, or a restaurant&rsquo;s photos.
                  </span>
                </div>
              )}
            </div>

            <div>
              <div className="rcx-kicker">
                Anything you know?<span className="rcx-kicker-opt"> · optional</span>
              </div>
              <textarea
                ref={hintRef}
                className="rcx-prompt rcx-dish-hint"
                value={hint}
                maxLength={MAX_HINT}
                onChange={(e) => { setHint(e.target.value); if (error) setError(null); }}
                placeholder={'“The lamb shawarma from Mamoun’s”, “make it vegetarian”, “it had a miso glaze”…'}
                rows={2}
              />
            </div>

            <div>
              <div className="rcx-kicker">Guidelines<span className="rcx-kicker-opt"> · optional</span></div>
              <GuidelinePills value={guidelines} onChange={setGuidelines} openMenu={openMenu} onOpenMenu={setOpenMenu} className="rcx-dish-pills" />
            </div>

            {error && !photo && (
              <p className="rcx-modal-error" style={{ marginTop: -8 }} role="alert">
                <AlertCircle size={13} /> {error}
              </p>
            )}
            <p className="rcxa-note">AI drafts can make mistakes — review before publishing.</p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="rcx-foot">
        <QuotaMeter feature="recipe-photo" className="rcx-foot-meter" />
        <button
          type="button"
          className={cn('rcx-foot-cta', !canSubmit && !loading && 'is-disabled', (canSubmit || loading) && 'is-publish', loading && 'is-busy')}
          onClick={() => void handleGenerate()}
          disabled={loading || !canSubmit}
        >
          {loading ? <Loader2 size={15} className="rcx-spin" /> : canSubmit ? <Sparkles size={14} /> : null}
          {ctaLabel}
        </button>
      </div>

      <PhotoSourceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onPick={(pick) => void handlePick(pick)} />
    </div>
  );
};
