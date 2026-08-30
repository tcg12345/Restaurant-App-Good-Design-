/**
 * RatingFlow — the whole rating experience, as one popup card.
 *
 * Implements the Claude Design "Rating Flow" spec. The shape of it: a
 * centred card over a scrim, never a full page, whose HEIGHT is the thing
 * that changes between steps. Each step declares the height it needs and
 * the card grows or shrinks into it, so the flow reads as one object being
 * reshaped rather than four screens replacing each other.
 *
 *   gut      → how was it (three sentiments, or "I already know my score")
 *   compare  → head-to-head match-ups against your own list
 *   direct   → the slider, for when you already know
 *   details  → the revealed score + six detail chips + share + save
 *   saved    → the confirmation
 *
 * The comparisons are NOT the design's toy binary search — they run the
 * app's real `headToHeadRating` engine (similarity-biased pivots, ties,
 * skips, budget) so the score this produces is the same score the old flow
 * produced. The design contributes the presentation; the engine keeps the
 * arithmetic. Same for the save: it goes through `rateRestaurant` with the
 * placement order the search decided, exactly as before.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Heart, Minus, ThumbsDown, RotateCcw, StickyNote, ChefHat, DollarSign, CalendarDays, Tag, Image as ImageIcon, Check, Trash2, Camera } from 'lucide-react';
import { cn, localISODate } from '../lib/utils';
import { compressImage } from '../lib/images';
import { dropDeadPhotos } from '../lib/pendingPhotos';
import { useLists, type PhotoItem, type RestaurantRating } from '../contexts/ListsContext';
import { settleScores } from '../lib/settleScores';
import { useSubmitOnce } from '../lib/useSubmitOnce';
import { pushOverlay } from '../lib/overlay-registry';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, Calendar } from './RatingShared';
import {
  type H2HState, type Tier,
  initH2H, initH2HTieBreak, pickComparison, applyChoice, applyTie, applySkip,
  isComplete, computeFinalScore, comparisonsMade, totalEstimatedComparisons,
  placementOrder, TIER_LABELS,
} from '../lib/headToHeadRating';
import './RatingFlow.css';

type Step = 'gut' | 'compare' | 'direct' | 'details' | 'saved';
type Editor = 'notes' | 'dishes' | 'price' | 'when' | 'tags' | 'photos';

/** Which sentiment maps to which tier of the score range. */
const SENTIMENTS: Array<{
  tier: Tier; title: string; sub: string; tone: 'high' | 'mid' | 'low'; Icon: typeof Heart;
}> = [
  { tier: 'loved', title: 'Loved it', sub: 'An instant favorite', tone: 'high', Icon: Heart },
  { tier: 'fine', title: 'It was fine', sub: 'Solid, might be back', tone: 'mid', Icon: Minus },
  { tier: 'disliked', title: 'Not for me', sub: 'Wouldn’t go back', tone: 'low', Icon: ThumbsDown },
];

const EDITORS: Array<{ key: Editor; label: string; title: string; Icon: typeof StickyNote }> = [
  { key: 'notes', label: 'Notes', title: 'Notes', Icon: StickyNote },
  { key: 'dishes', label: 'Dishes', title: 'Favorite dishes', Icon: ChefHat },
  { key: 'price', label: 'Price', title: 'Price per person', Icon: DollarSign },
  { key: 'when', label: 'When', title: 'Date of visit', Icon: CalendarDays },
  { key: 'tags', label: 'Tags', title: 'Tags', Icon: Tag },
  { key: 'photos', label: 'Photos', title: 'Photos', Icon: ImageIcon },
];

/* Two different questions, two different cut points — both the app's own,
   and easy to conflate:
     toneOf  — the score COLOUR tier (score.ts: high >= 8, mid >= 5).
     bandOf  — the rating BAND (headToHeadRating tierRange: loved >= 7,
               fine >= 4), i.e. which sentiment the search partitions by.
   A 7.5 is amber AND "Loved it". Labelling the band with the colour's
   thresholds — which the first pass did — calls that same 7.5 "It was
   fine", contradicting the sentiment the user actually picked. */
const toneOf = (score: number): 'high' | 'mid' | 'low' => (score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low');
const bandOf = (score: number): Tier => (score >= 7 ? 'loved' : score >= 4 ? 'fine' : 'disliked');
const bandTone = (t: Tier): 'high' | 'mid' | 'low' => (t === 'loved' ? 'high' : t === 'fine' ? 'mid' : 'low');
const fmtDate = (iso: string) => {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
};

export const RatingFlow: React.FC = () => {
  const {
    addRestaurantModalOpen, addRestaurantModalMeta, addRestaurantModalInitialPage, closeAddRestaurantModal,
    rateRestaurant, getRating, removeRating, ratings, getRestaurantInfo, scoresUnlocked,
  } = useLists();
  const { submitting: saving, tryLock } = useSubmitOnce(addRestaurantModalOpen);

  const restaurant = addRestaurantModalMeta;
  const existing = restaurant ? getRating(restaurant.id) : undefined;

  const [step, setStep] = useState<Step>('gut');
  const [editor, setEditor] = useState<Editor | null>(null);
  /** Once an editor has been opened, returning to the overview slides back
   *  instead of replaying the reveal's delayed write-on. */
  const [edVisited, setEdVisited] = useState(false);

  // ── The score, and how it was reached ──
  const [h2h, setH2h] = useState<H2HState | null>(null);
  const [method, setMethod] = useState<'h2h' | 'slider' | null>(null);
  const [score, setScore] = useState(0);
  const [settled, setSettled] = useState(0);
  const [order, setOrder] = useState<string[] | null>(null);
  const [sliderVal, setSliderVal] = useState(7.5);
  const [tieBreak, setTieBreak] = useState(false);
  /** Which side the user just chose, held for the beat the win/lose
   *  reaction plays before the next match-up slides in. */
  const [pick, setPick] = useState<'new' | 'old' | 'tie' | null>(null);
  /** The score counting up on the reveal. */
  const [display, setDisplay] = useState(0);

  // ── The details ──
  const [notes, setNotes] = useState('');
  const [dishes, setDishes] = useState<string[]>([]);
  const [dishDraft, setDishDraft] = useState('');
  /* Price is two controls over one value, the way it was before: the tier
     ($–$$$$) and an exact per-person amount. Typing an amount SELECTS the
     tier it falls in (`priceIndexFromAmount`), and picking a tier clears
     the amount — the amount is a more precise way of saying the same
     thing, not a second field. Only the tier is persisted; the amount is
     the input method. */
  const [priceIndex, setPriceIndex] = useState(-1);
  const [priceAmount, setPriceAmount] = useState('');
  const price = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : '';
  const [visitDate, setVisitDate] = useState(localISODate());
  const [tags, setTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState('');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photosProcessing, setPhotosProcessing] = useState(0);
  const [share, setShare] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<Set<string>>(new Set());

  const resolvedCuisine = restaurant?.cuisine || existing?.cuisine || '';
  const resolvedPrice = price || restaurant?.price || existing?.price || '';

  // ── Open / reset ──────────────────────────────────────────────────
  // Editing an existing rating opens straight on the details — the score is
  // already decided, and re-rank is one tap away from there.
  useEffect(() => {
    if (!addRestaurantModalOpen || !restaurant) return;
    const prior = getRating(restaurant.id);
    setEditor(null);
    setEdVisited(false);
    setH2h(null);
    setPick(null);
    setTieBreak(false);
    setConfirmDelete(false);
    setNotes(prior?.notes ?? '');
    setDishes(prior?.favoriteDishes ?? []);
    setDishDraft('');
    setPriceIndex(prior?.price ? PRICE_RANGES.findIndex((r) => r.signs === prior.price) : -1);
    setPriceAmount('');
    setVisitDate(prior?.visitDate || localISODate());
    setTags(prior?.tags ?? []);
    setTagQuery('');
    setPhotos(prior?.photos ?? []);
    setPhotosProcessing(0);
    setShare(true);
    if (prior) {
      setMethod(null);
      setScore(prior.score);
      setSettled(prior.score);
      setDisplay(prior.score);
      setOrder(null);
      setSliderVal(prior.score);
      setStep(addRestaurantModalInitialPage === 'rate' ? 'gut' : 'details');
    } else {
      setMethod(null);
      setScore(0);
      setSettled(0);
      setDisplay(0);
      setOrder(null);
      setSliderVal(7.5);
      setStep('gut');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRestaurantModalOpen, restaurant?.id]);

  // The native glass chrome has to stand down while this is up — it draws
  // ABOVE the WebView, so a z-index here cannot cover it.
  useEffect(() => {
    if (!addRestaurantModalOpen) return;
    return pushOverlay();
  }, [addRestaurantModalOpen]);

  useEffect(() => () => { previewUrls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  // ── The score the tier will actually settle on ────────────────────
  const previewSettled = useCallback((raw: number, forOrder: string[] | null): number => {
    if (!restaurant) return raw;
    const self: RestaurantRating = {
      restaurantId: restaurant.id, name: restaurant.name, image: restaurant.image,
      cuisine: resolvedCuisine, price: resolvedPrice, address: restaurant.address,
      score: raw, notes: '', visitDate: '', wouldReturn: true, tags: [], photos: [],
      listIds: [], friendIds: [], createdAt: 0,
    };
    const change = settleScores(
      [self, ...ratings.filter((r) => r.restaurantId !== self.restaurantId)],
      { justRatedId: self.restaurantId, previousScore: existing?.score, explicitOrder: forOrder ?? undefined },
    ).find((c) => c.restaurantId === self.restaurantId);
    return change ? change.score : raw;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant, ratings, existing?.score, resolvedCuisine, resolvedPrice]);

  // ── Reveal: the number counts up once the card has finished growing ──
  const runReveal = useCallback((raw: number, placement: string[] | null, how: 'h2h' | 'slider') => {
    const shown = previewSettled(raw, placement);
    setScore(raw);
    setSettled(shown);
    setOrder(placement);
    setMethod(how);
    setEditor(null);
    setEdVisited(false);
    setStep('details');
    setDisplay(0);
    const t0 = performance.now();
    const DUR = 1050;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DUR);
      setDisplay(Math.round(shown * (1 - Math.pow(1 - p, 3)) * 10) / 10);
      if (p < 1) requestAnimationFrame(tick);
      else setDisplay(shown);
    };
    requestAnimationFrame(tick);
  }, [previewSettled]);

  // ── Head-to-head ──────────────────────────────────────────────────
  const startBand = (tier: Tier) => {
    if (!restaurant) return;
    const fresh = initH2H(ratings, tier, restaurant.id, { ...restaurant, tags }, getRestaurantInfo);
    // An empty band has nothing to compare against — the engine can score it
    // on bounds alone, so skip straight to the reveal.
    if (isComplete(fresh)) {
      runReveal(computeFinalScore(fresh), placementOrder(fresh, restaurant.id, computeFinalScore(fresh)), 'h2h');
      return;
    }
    setH2h(fresh);
    setPick(null);
    setStep('compare');
  };

  const comparison = h2h && !isComplete(h2h) ? pickComparison(h2h) : null;

  /* How long the answer is acknowledged before the next match-up arrives.
     The design held it for 520ms to let the win/lose reaction play out in
     full; in a real session that reads as the app thinking, and a run of
     seven match-ups spends most of its time waiting. Short enough now to
     feel like a direct response, long enough that the choice still
     visibly registers. */
  const PICK_BEAT = 130;

  /** Advance the search once the answer has registered. */
  const resolve = (next: H2HState, chose: 'new' | 'old' | 'tie') => {
    if (pick || !restaurant) return;
    setPick(chose);
    window.setTimeout(() => {
      setPick(null);
      if (isComplete(next)) {
        const raw = computeFinalScore(next);
        const placement = placementOrder(next, restaurant.id, raw);
        setH2h(null);
        if (tieBreak) {
          // A tie-break was triggered by Save on a slider score: it only
          // refines the ORDER, so it saves straight through and the rating
          // stays slider-made.
          setTieBreak(false);
          persist(raw, placement, 'slider');
          return;
        }
        runReveal(raw, placement, 'h2h');
      } else {
        setH2h(next);
      }
    }, PICK_BEAT);
  };

  // ── Photos ────────────────────────────────────────────────────────
  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? (Array.from(e.target.files) as File[]).filter((f) => f.type.startsWith('image/')) : [];
    e.target.value = '';
    if (files.length === 0) return;
    // Previews land immediately and the compressed JPEG swaps in per photo —
    // the same pipeline the old modal used, so the pending-photo upload pass
    // still recognises what it finds.
    const staged = files.map((file) => {
      const preview = URL.createObjectURL(file);
      previewUrls.current.add(preview);
      return { file, preview };
    });
    setPhotos((prev) => [...prev, ...staged.map((s): PhotoItem => ({ url: s.preview, caption: '', isFavorite: false }))]);
    setPhotosProcessing((n) => n + staged.length);
    const queue = [...staged];
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        try {
          const dataUrl = await compressImage(item.file);
          setPhotos((prev) => prev.map((p) => (p.url === item.preview ? { ...p, url: dataUrl } : p)));
        } catch {
          setPhotos((prev) => prev.filter((p) => p.url !== item.preview));
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(item.preview), 1000);
          previewUrls.current.delete(item.preview);
          setPhotosProcessing((n) => Math.max(0, n - 1));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, staged.length) }, () => worker()));
  };

  // ── Save ──────────────────────────────────────────────────────────
  const persist = (finalScore: number, placement: string[] | null, how: 'h2h' | 'slider' | null) => {
    if (!restaurant || !tryLock()) return;
    rateRestaurant(
      {
        restaurantId: restaurant.id, name: restaurant.name, image: restaurant.image,
        cuisine: resolvedCuisine, price: resolvedPrice, address: restaurant.address,
        score: finalScore, notes, visitDate, wouldReturn: existing?.wouldReturn ?? true, tags,
        photos: dropDeadPhotos(photos),
        favoriteDishes: dishes.length > 0 ? dishes : undefined,
        // Lists and friends aren't part of this flow's surface; carrying the
        // existing values through means editing a note can't silently drop
        // the lists a rating already belongs to.
        listIds: existing?.listIds ?? [], friendIds: existing?.friendIds ?? [], createdAt: Date.now(),
        ratingMethod: how ?? existing?.ratingMethod,
      },
      { isNewVisit: false, settleOrder: placement ?? undefined, shareToFeed: share },
    );
    setStep('saved');
  };

  const onSave = () => {
    if (!restaurant || photosProcessing > 0) return;
    // A slider score that ties with existing ratings needs a quick H2H
    // against just the tied ones so it lands in the right ORDER.
    if (method === 'slider') {
      const tb = initH2HTieBreak(ratings, score, restaurant.id);
      if (tb) {
        setH2h(tb);
        setTieBreak(true);
        setPick(null);
        setStep('compare');
        return;
      }
    }
    persist(score, order, method);
  };

  if (!addRestaurantModalOpen || !restaurant) return null;

  // ── Geometry: the height each step asks the card to become ────────
  const cardH = step === 'gut' ? 438
    : step === 'compare' ? 446
    : step === 'direct' ? 404
    : step === 'saved' ? 352
    : editor === 'when' ? 548 : editor === 'tags' ? 500 : editor === 'photos' ? 478
    : editor === 'price' ? 462
    : editor ? 424 : 512;

  const tone = toneOf(settled || sliderVal);
  const sliderTone = toneOf(sliderVal);
  const sliderBand = bandOf(sliderVal);
  const sliderBandTone = bandTone(sliderBand);
  const filteredTags = ALL_TAGS.filter((t) => t.toLowerCase().includes(tagQuery.trim().toLowerCase()));
  const done = h2h ? comparisonsMade(h2h) + (pick ? 1 : 0) : 0;
  const total = h2h ? Math.max(totalEstimatedComparisons(h2h), done + (isComplete(h2h) ? 0 : 1)) : 0;
  const subtitle = [restaurant.cuisine, restaurant.price, restaurant.address?.split(',')[0]].filter(Boolean).join(' · ');
  // Plain computations, not memos: everything below here sits AFTER the
  // `return null` guard, and a hook on that side of an early return is a
  // hook that some renders run and others don't.
  const others = ratings.filter((r) => r.restaurantId !== restaurant.id);
  const rank = settled ? others.filter((r) => r.score > settled).length + 1 : 0;
  const totalRated = others.length + 1;

  const chipSummary: Record<Editor, string> = {
    notes: notes.trim() ? 'Added' : '—',
    dishes: dishes.length ? `${dishes.length} added` : '—',
    price: priceAmount.trim() ? `$${priceAmount.trim()}` : price || '—',
    when: fmtDate(visitDate),
    tags: tags.length ? `${tags.length} picked` : '—',
    photos: photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : '—',
  };
  const chipSet: Record<Editor, boolean> = {
    notes: !!notes.trim(), dishes: dishes.length > 0, price: priceIndex >= 0,
    when: true, tags: tags.length > 0, photos: photos.length > 0,
  };

  const closeBtn = (
    <button type="button" onClick={closeAddRestaurantModal} aria-label="Close" className="rf-icon-btn">
      <X size={11} strokeWidth={1.8} />
    </button>
  );

  return createPortal(
    <div
      className="rf-scrim"
      /* Tap-outside-to-close, and ONLY that. Closing on any click that
         reaches this element meant the hidden file input below — a child
         of the scrim — dismissed the whole flow the instant
         `fileRef.current.click()` fired, because a programmatic click
         bubbles like any other. The picker then opened over a modal that
         had already torn its state down. */
      onClick={(e) => { if (e.target === e.currentTarget) closeAddRestaurantModal(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Rate this visit"
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onPickPhotos}
        onClick={(e) => e.stopPropagation()}
        className="hidden"
      />
      <div className="rf-card" style={{ height: cardH }} onClick={(e) => e.stopPropagation()}>

        {/* ══ GUT — the sentiment that picks the band ══ */}
        {step === 'gut' && (
          <div className="rf-step">
            <div className="flex items-start gap-2.5">
              <span className="flex-1 min-w-0">
                <span className="block text-[10.5px] font-extrabold tracking-[1.5px] text-primary">RATE THIS VISIT</span>
                <span className="rf-name font-serif block text-[23px] font-bold leading-[1.2] tracking-[-0.3px] mt-1.5 text-on-surface">
                  How was {restaurant.name}?
                </span>
                <span className="block text-[12px] text-ink-3 mt-[3px] truncate">{subtitle}</span>
              </span>
              {closeBtn}
            </div>
            <div className="flex flex-col gap-[9px] mt-4">
              {SENTIMENTS.map(({ tier, title, sub, tone: t, Icon }) => (
                <button key={tier} type="button" className="rf-gut-btn" onClick={() => startBand(tier)}>
                  <span
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `var(--color-score-${t}-tint)`, color: `var(--color-score-${t}-ink)` }}
                  >
                    <Icon size={19} strokeWidth={2} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-serif block text-[17px] font-bold text-on-surface">{title}</span>
                    <span className="block text-[11.5px] text-ink-3 mt-px">{sub}</span>
                  </span>
                  <ChevronRight size={13} strokeWidth={2.2} className="text-ink-4 flex-shrink-0" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setSliderVal(existing?.score ?? 7.5); setStep('direct'); }}
              className="mt-3.5 self-center text-[12.5px] font-bold text-primary"
            >
              I already know my score
            </button>
          </div>
        )}

        {/* ══ COMPARE — the real head-to-head, in the design's clothes ══ */}
        {step === 'compare' && comparison && (
          <div className="rf-step">
            <div className="flex items-center gap-2.5">
              <span className="flex-1 min-w-0">
                <span className="font-serif block text-[20px] font-bold tracking-[-0.25px] text-on-surface">Which was better?</span>
                <span className="block text-[11px] font-bold tracking-[0.6px] text-ink-3 mt-[3px]">
                  {tieBreak ? 'Tie-break' : `Match-up ${Math.min(done + 1, total)} of ${total}`}
                </span>
              </span>
              <div className="flex gap-[5px] items-center">
                {Array.from({ length: total }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      width: i < done ? 16 : 6, height: 6, borderRadius: 99,
                      background: i < done ? 'var(--color-primary)' : 'var(--color-line-2)',
                      transition: 'all .4s var(--ease-out)',
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="mt-3.5 flex-1 min-h-0 flex flex-col justify-center">
              <div className={cn('rf-comp-wrap', pick === 'new' && 'is-win', pick === 'old' && 'is-lose', pick === 'tie' && 'is-tie')}>
                <button type="button" className="rf-comp-btn" onClick={() => h2h && resolve(applyChoice(h2h, true), 'new')}>
                  <span className="flex items-center gap-[7px] mb-[5px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span className="text-[9.5px] font-extrabold tracking-[1.3px] text-primary">TONIGHT</span>
                  </span>
                  <span className="rf-name font-serif block text-[19px] font-bold text-on-surface leading-[1.2]">{restaurant.name}</span>
                  <span className="block text-[11.5px] text-ink-3 mt-[3px] truncate">{subtitle}</span>
                </button>
              </div>
              <div className="flex items-center gap-2.5 py-[7px] px-1">
                <div className="flex-1 h-px bg-line" />
                <div className="font-serif italic text-[13px] text-ink-4">or</div>
                <div className="flex-1 h-px bg-line" />
              </div>
              <div className={cn('rf-comp-wrap', pick === 'old' && 'is-win', pick === 'new' && 'is-lose', pick === 'tie' && 'is-tie')}>
                <button type="button" className="rf-comp-btn" onClick={() => h2h && resolve(applyChoice(h2h, false), 'old')}>
                  <span className="flex items-center gap-[7px] mb-[5px]">
                    <span className="text-[9.5px] font-extrabold tracking-[1.3px] text-ink-4">ON YOUR LIST</span>
                    {scoresUnlocked && (
                      <span
                        className="text-[10.5px] font-extrabold px-[7px] py-0.5 rounded-full tabular-nums"
                        style={{
                          color: `var(--color-score-${toneOf(comparison.score)}-ink)`,
                          background: `var(--color-score-${toneOf(comparison.score)}-tint)`,
                        }}
                      >
                        {comparison.score.toFixed(1)}
                      </span>
                    )}
                  </span>
                  <span className="rf-name font-serif block text-[19px] font-bold text-on-surface leading-[1.2]">{comparison.name}</span>
                  <span className="block text-[11.5px] text-ink-3 mt-[3px] truncate">
                    {[comparison.cuisine, comparison.price].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2.5 mt-3.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => h2h && resolve(applyTie(h2h), 'tie')}
                className="flex-1 h-[42px] rounded-full border border-line-2 bg-paper text-[13.5px] font-bold text-ink-2 active:scale-[0.97] transition-transform"
              >
                Too close to call
              </button>
              <button
                type="button"
                onClick={() => h2h && resolve(applySkip(h2h), 'tie')}
                className="h-[42px] px-[15px] rounded-full border border-line bg-transparent text-[13px] font-bold text-ink-3 active:scale-[0.97] transition-transform"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* ══ DIRECT — the slider ══ */}
        {step === 'direct' && (
          <div className="rf-step">
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => setStep('gut')} aria-label="Back" className="rf-icon-btn">
                <ChevronLeft size={12} strokeWidth={2.2} />
              </button>
              <span className="font-serif flex-1 text-[19px] font-bold tracking-[-0.2px] text-on-surface">Score it yourself</span>
            </div>
            <div className="flex-1 flex flex-col justify-center items-center gap-1 py-2">
              <div
                className="font-serif text-[74px] font-bold leading-none tabular-nums"
                style={{ color: `var(--color-score-${sliderTone})`, transition: 'color .3s var(--ease-out)' }}
              >
                {sliderVal.toFixed(1)}
              </div>
              <div
                className="mt-2.5 text-[12px] font-bold px-[13px] py-1.5 rounded-full"
                style={{
                  color: `var(--color-score-${sliderBandTone}-ink)`,
                  background: `var(--color-score-${sliderBandTone}-tint)`,
                  transition: 'all .3s var(--ease-out)',
                }}
              >
                “{TIER_LABELS[sliderBand]}” territory
              </div>
              <input
                type="range" min={1} max={10} step={0.1} value={sliderVal}
                onChange={(e) => setSliderVal(parseFloat(e.target.value))}
                aria-label="Your score" className="rf-range mt-[18px]"
              />
              <div className="flex justify-between w-full text-[10.5px] text-ink-4 -mt-1"><span>1</span><span>10</span></div>
            </div>
            <button
              type="button"
              className="rf-cta"
              onClick={() => {
                const sc = Math.round(sliderVal * 10) / 10;
                runReveal(sc, null, 'slider');
              }}
            >
              Lock it in
            </button>
          </div>
        )}

        {/* ══ DETAILS — the reveal, then everything else about the visit ══ */}
        {step === 'details' && !editor && (
          <div className={cn('rf-ov', edVisited && 'is-back')}>
            <div className="flex items-start gap-1.5">
              <span className="flex-1 min-w-0 pt-0.5">
                <span className="block text-[10px] font-extrabold tracking-[1.4px] text-primary">
                  {method === 'slider' ? 'SCORED BY YOU'
                    : method === 'h2h' ? 'COMPARED'
                    : 'YOUR RATING'}
                </span>
                <span className="rf-name font-serif block text-[21px] font-bold tracking-[-0.25px] leading-[1.2] mt-[5px] text-on-surface">
                  {restaurant.name}
                </span>
                <span className="block text-[12px] text-ink-3 mt-1 truncate">{subtitle}</span>
              </span>
              <button type="button" onClick={() => setStep('gut')} aria-label="Re-rank" className="rf-icon-btn">
                <RotateCcw size={13} strokeWidth={2} />
              </button>
              {closeBtn}
            </div>

            <div
              className="flex items-center gap-3 rounded-[18px] px-4 py-3"
              style={{ background: `var(--color-score-${tone}-tint)` }}
            >
              {scoresUnlocked ? (
                <>
                  {/* `font-serif font-bold tabular-nums` — the app's score
                      numeral, the same one ScoreBadge, the feed discs and
                      the restaurant page all set. The design file asked for
                      font-display (Fraunces), whose high-contrast curves
                      read as a different number system next to every other
                      score the user sees. */}
                  <div
                    className="font-serif text-[40px] font-bold leading-[0.9] tabular-nums"
                    style={{ color: `var(--color-score-${tone}-ink)` }}
                  >
                    {display.toFixed(1)}
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[12.5px] font-extrabold" style={{ color: `var(--color-score-${tone}-ink)` }}>
                      {TIER_LABELS[bandOf(settled)]}
                    </span>
                    <span className="text-[10px] font-bold tracking-[1.2px] text-ink-4">OUT OF 10</span>
                  </div>
                  <div className="flex-1" />
                  <span className="text-[12px] font-bold text-ink-3">#{rank} of {totalRated}</span>
                </>
              ) : (
                <>
                  <div className="font-serif text-[17px] font-bold" style={{ color: `var(--color-score-${tone}-ink)` }}>
                    Ranked #{rank}
                  </div>
                  <div className="flex-1" />
                  <span className="text-[11px] font-bold text-ink-3">Scores unlock at 10 ratings</span>
                </>
              )}
            </div>

            <div className="grid grid-cols-3 gap-[9px]">
              {EDITORS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className="rf-chip"
                  onClick={() => {
                    if (key === 'photos' && photos.length === 0) { fileRef.current?.click(); }
                    setEditor(key);
                    setEdVisited(true);
                  }}
                >
                  <Icon size={16} strokeWidth={1.9} />
                  <span className="text-[11px] font-bold">{label}</span>
                  <span className={cn('text-[10px] font-bold', chipSet[key] ? 'text-primary' : 'text-ink-4')}>
                    {chipSummary[key]}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2.5">
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-bold text-ink-2">Share to your circle</span>
                <span className="block text-[10.5px] text-ink-4 mt-px">Friends see your score and photos</span>
              </span>
              <button
                type="button"
                onClick={() => setShare((v) => !v)}
                aria-label="Toggle sharing"
                aria-checked={share}
                role="switch"
                className="w-[46px] h-7 rounded-full border-none cursor-pointer p-[2.5px] flex flex-shrink-0"
                style={{ background: share ? 'var(--color-primary)' : 'var(--color-line-2)', transition: 'background .25s var(--ease-out)' }}
              >
                <span
                  className="w-[23px] h-[23px] rounded-full bg-white"
                  style={{
                    boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                    transform: share ? 'translateX(18px)' : 'translateX(0)',
                    transition: 'transform .25s var(--ease-out)',
                  }}
                />
              </button>
            </div>

            <button type="button" className="rf-cta" onClick={onSave} disabled={saving || photosProcessing > 0}>
              {photosProcessing > 0 ? 'Processing photos…' : existing ? 'Update rating' : 'Save rating'}
            </button>

            {existing && (
              <button
                type="button"
                onClick={() => {
                  if (!confirmDelete) { setConfirmDelete(true); return; }
                  removeRating(restaurant.id);
                  closeAddRestaurantModal();
                }}
                className={cn(
                  'self-center inline-flex items-center gap-1.5 text-[12px] font-bold transition-colors',
                  confirmDelete ? 'text-red-500' : 'text-ink-4',
                )}
              >
                <Trash2 size={12} />{confirmDelete ? 'Tap again to delete' : 'Delete rating'}
              </button>
            )}
          </div>
        )}

        {/* ══ The editors — one pane, six contents ══ */}
        {step === 'details' && editor && (
          <div className="rf-ed">
            <div className="flex items-center gap-[11px] flex-shrink-0">
              <button type="button" onClick={() => setEditor(null)} aria-label="Back" className="rf-icon-btn">
                <ChevronLeft size={12} strokeWidth={2.2} />
              </button>
              <span className="font-serif flex-1 text-[18px] font-bold tracking-[-0.2px] text-on-surface">
                {EDITORS.find((e) => e.key === editor)?.title}
              </span>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="h-8 px-[15px] rounded-full border-none text-[13px] font-bold text-primary active:scale-95 transition-transform"
                style={{ background: 'color-mix(in srgb, var(--color-primary) 9%, transparent)' }}
              >
                Done
              </button>
            </div>
            <div className="rf-ed-pane">
              {editor === 'notes' && (
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Standout dishes, moments, things to remember…"
                  className="rf-pop flex-1 w-full box-border resize-none bg-transparent border-none text-[13.5px] leading-[1.5] text-on-surface outline-none"
                />
              )}

              {editor === 'dishes' && (
                <div className="rf-pop flex flex-col gap-2.5 flex-1 min-h-0">
                  <input
                    type="text" value={dishDraft}
                    onChange={(e) => setDishDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && dishDraft.trim()) {
                        e.preventDefault();
                        setDishes((d) => [...d, dishDraft.trim()]);
                        setDishDraft('');
                      }
                    }}
                    placeholder="Type a dish, press return"
                    className="rf-field flex-shrink-0"
                  />
                  <div className="flex flex-wrap gap-[7px] overflow-auto content-start">
                    {dishes.map((d, i) => (
                      <button
                        key={`${d}-${i}`}
                        type="button"
                        onClick={() => setDishes((prev) => prev.filter((_, j) => j !== i))}
                        className="rf-pop flex items-center gap-1.5 h-7 px-[11px] rounded-full border-none text-[12px] font-bold text-primary"
                        style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}
                      >
                        {d} <span className="opacity-60">×</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {editor === 'price' && (
                <div className="rf-pop flex-1 flex flex-col items-center justify-center gap-3">
                  <div className="text-[11px] font-extrabold tracking-[1.4px] text-ink-3">PER PERSON</div>
                  <div className="flex gap-2 w-full">
                    {PRICE_RANGES.map((p, idx) => (
                      <button
                        key={p.signs}
                        type="button"
                        onClick={() => {
                          setPriceIndex((cur) => (cur === idx ? -1 : idx));
                          setPriceAmount('');
                        }}
                        className={cn(
                          'flex-1 py-2.5 rounded-2xl border text-center transition-colors',
                          priceIndex === idx
                            ? 'bg-primary/10 border-primary/40 text-primary'
                            : 'bg-surface border-line text-ink-3',
                        )}
                      >
                        <span className="block text-[15px] font-bold">{p.signs}</span>
                        <span className="block text-[9.5px] font-semibold opacity-70 mt-0.5">{p.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="w-full pt-1">
                    <p className="text-[9.5px] font-bold uppercase tracking-[1.3px] text-ink-4 mb-1.5 text-center">
                      Or enter exact amount
                    </p>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[13px] text-ink-4 font-semibold">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={priceAmount}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPriceAmount(val);
                          const num = parseInt(val, 10);
                          if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
                        }}
                        placeholder="0"
                        aria-label="Exact amount per person"
                        className="w-full box-border bg-surface border border-line rounded-2xl pl-8 pr-[86px] h-11 text-center text-[15px] font-semibold text-on-surface outline-none focus:border-primary/40 transition-colors"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-ink-4">per person</span>
                    </div>
                  </div>
                </div>
              )}

              {editor === 'when' && (
                <div className="rf-pop flex-1 min-h-0 overflow-auto">
                  <Calendar value={visitDate} onChange={setVisitDate} />
                </div>
              )}

              {editor === 'tags' && (
                <div className="rf-pop flex-1 min-h-0 flex flex-col gap-2.5">
                  <input
                    type="text" value={tagQuery} onChange={(e) => setTagQuery(e.target.value)}
                    placeholder="Search tags…" aria-label="Search tags" className="rf-field flex-shrink-0"
                  />
                  <div className="flex-1 flex flex-wrap content-start gap-[7px] overflow-auto pb-0.5">
                    {filteredTags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
                        className={cn(
                          'h-7 px-3 rounded-full text-[12px] font-bold transition-colors',
                          tags.includes(t) ? 'bg-primary text-white' : 'bg-surface border border-line text-ink-2',
                        )}
                      >
                        {t}
                      </button>
                    ))}
                    {filteredTags.length === 0 && (
                      <div className="w-full text-center text-[12px] text-ink-4 py-3.5">No tags match “{tagQuery}”</div>
                    )}
                  </div>
                </div>
              )}

              {editor === 'photos' && (
                <div className="rf-pop flex-1 min-h-0 flex flex-col gap-[9px]">
                  <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-[9px]">
                    {photos.map((p, i) => (
                      <div key={`${p.url}-${i}`} className="rf-pop flex gap-2.5 items-center flex-shrink-0">
                        <div
                          className="w-14 h-14 flex-shrink-0 rounded-xl bg-cover bg-center border border-line"
                          style={{ backgroundImage: p.url ? `url(${p.url})` : undefined }}
                        />
                        <input
                          type="text" value={p.caption ?? ''}
                          onChange={(e) => setPhotos((prev) => prev.map((q, j) => (j === i ? { ...q, caption: e.target.value } : q)))}
                          placeholder="What’s this?" aria-label="Photo description"
                          className="rf-field flex-1 min-w-0 !h-9 !text-[12.5px] !px-[13px]"
                        />
                        <button
                          type="button"
                          onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="Remove photo"
                          className="w-7 h-7 rounded-full border border-line bg-surface flex items-center justify-center text-ink-3 flex-shrink-0 active:scale-90 transition-transform"
                        >
                          <X size={10} strokeWidth={1.8} />
                        </button>
                      </div>
                    ))}
                    {photos.length === 0 && (
                      <div className="flex-1 flex items-center justify-center text-[12px] text-ink-4">No photos yet</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex-shrink-0 h-[34px] rounded-full bg-transparent text-[12.5px] font-bold text-ink-3 active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5"
                    style={{ border: '1.5px dashed var(--color-line-2)' }}
                  >
                    <Camera size={13} /> Add {photos.length > 0 ? 'another photo' : 'a photo'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ SAVED ══ */}
        {step === 'saved' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div
              className="w-[74px] h-[74px] rounded-full flex items-center justify-center"
              style={{ background: 'var(--color-score-high-tint)', animation: 'rf-check-pop .55s var(--ease-out-strong) both' }}
            >
              <Check size={32} strokeWidth={2.4} style={{ color: 'var(--color-score-high-ink)' }} />
            </div>
            <div
              className="font-serif text-[24px] font-bold tracking-[-0.3px] mt-[18px] text-on-surface"
              style={{ animation: 'rf-fade-up .5s var(--ease-out) .15s both' }}
            >
              On the list.
            </div>
            <div
              className="text-[12.5px] text-ink-3 mt-1.5"
              style={{ animation: 'rf-fade-up .5s var(--ease-out) .25s both' }}
            >
              {scoresUnlocked
                ? <>Saved at <b className="text-on-surface">{settled.toFixed(1)}</b> — #{rank} of {totalRated}</>
                : <>Saved — #{rank} of {totalRated}</>}
            </div>
            <button
              type="button"
              className="rf-cta w-full mt-[26px]"
              style={{ animation: 'rf-fade-up .5s var(--ease-out) .35s both' }}
              onClick={closeAddRestaurantModal}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
