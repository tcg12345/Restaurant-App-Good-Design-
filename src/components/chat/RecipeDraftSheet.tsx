import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChefHat, Clock, Users, Flame, Sparkles, Lightbulb, CalendarClock, Repeat, BookOpenCheck, CheckCircle2, Trash2, ImagePlus, Camera, ArrowUp, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { processPhoto, processDataUrl } from '../../lib/images';
import { useSettings } from '../../contexts/SettingsContext';
import type { HomeMeal, RecipeIngredient } from '../../contexts/ListsContext';
import type { IngredientEdit } from '../../lib/build-recipe-client';

interface RecipeDraftSheetProps {
  open: boolean;
  draft: HomeMeal | null;
  publishedMealId: string | null;
  onClose: () => void;
  onPublish: (draft: HomeMeal) => void;
  onEdit: (draft: HomeMeal) => void;
  onDelete: () => void;
  /** Set / clear the cover photo on the draft. Pass null to remove. */
  onCoverPhotoChange: (dataUrl: string | null) => void;
  /** Tailwind z-index class for the overlay. Defaults to `z-[70]` (the
   *  chat context). The Add Recipe modal passes a higher value so the
   *  sheet sits above the modal (`z-[100]`) and its picker sheets. */
  zClass?: string;
  /** Override the primary action label. Defaults to "Publish to my
   *  cookbook". The modal uses a shorter "Publish recipe". */
  publishLabel?: string;
  /** Refine the draft with a free-text AI instruction. When provided,
   *  the sheet shows a "Refine with AI" composer. The parent runs the
   *  edit and updates its draft; resolve `{ ok }` (with an optional
   *  user-facing `error`). Omit to hide the composer entirely. */
  onRefine?: (instruction: string) => Promise<{ ok: boolean; error?: string }>;
  /** Generate an AI hero photo of the finished dish. When provided, the
   *  cover-photo area offers a "Generate with AI" action. The parent runs
   *  the network call and resolves the raw image `dataUrl`; the sheet then
   *  compresses it and applies it via `onCoverPhotoChange` (same path as an
   *  upload). Omit to hide the AI generation option. */
  onGenerateImage?: () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  /** Remove or substitute ONE ingredient. When provided (and the draft is
   *  unpublished), every ingredient row becomes tappable and opens a small
   *  remove/swap panel — separate from the free-text "Refine with AI"
   *  composer. The AI may DECLINE the change when it would compromise the
   *  dish; resolve `{ ok: false, declined: true, declineReason }` in that
   *  case and the sheet explains it without touching the draft. */
  onIngredientEdit?: (edit: IngredientEdit) => Promise<{
    ok: boolean;
    declined?: boolean;
    declineReason?: string;
    error?: string;
  }>;
}

/** Downsize an image (given as a data-URL / object-URL `src`) to fit within
 *  800px and re-encode as JPEG@0.6. Shared by uploaded cover photos and
 *  AI-generated ones so both are stored at the same modest size — matches
 *  the AddHomeMealModal compression pipeline. */

/** Full read-only preview of an AI-built recipe draft. Footer carries
 *  Publish (commits to homeMeals via createHomeMeal), Edit (opens the
 *  Advanced builder pre-filled), and Delete draft (removes the chat
 *  block). Phone uses a draggable bottom sheet; desktop renders a
 *  centered modal — mirrors AddFriendSheet. */
export const RecipeDraftSheet: React.FC<RecipeDraftSheetProps> = ({
  open,
  draft,
  publishedMealId,
  onClose,
  onPublish,
  onEdit,
  onDelete,
  onCoverPhotoChange,
  zClass = 'z-[70]',
  publishLabel = 'Publish to my cookbook',
  onRefine,
  onGenerateImage,
  onIngredientEdit,
}) => {
  const { phoneMode } = useSettings();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  // AI cover generation: in-flight flag + last error, shown inline in the
  // cover-photo area.
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // Estimated progress for the image generation. The image API can't report
  // real progress (one OpenAI call, ~10-40s), so we ease a bar toward ~95%
  // off elapsed time and let it snap to done when the photo arrives.
  const [imageElapsed, setImageElapsed] = useState(0);   // whole seconds
  const [imageProgress, setImageProgress] = useState(0); // 0–100
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refine-with-AI: collapsed by default, expands into a floating
  // composer panel above the footer.
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const refineInputRef = useRef<HTMLTextAreaElement>(null);

  // Ingredient remove/swap: tapping an ingredient row selects it and opens
  // a compact action card under the list. Remove fires immediately; Swap
  // expands an inline replacement input. The AI may decline the change —
  // `ingNotice` carries its explanation (or a success/error message).
  const [ingTarget, setIngTarget] = useState<string | null>(null);
  const [ingSwapOpen, setIngSwapOpen] = useState(false);
  const [ingReplacement, setIngReplacement] = useState('');
  const [ingBusy, setIngBusy] = useState(false);
  const [ingNotice, setIngNotice] = useState<{ kind: 'success' | 'declined' | 'error'; text: string } | null>(null);
  const ingSwapInputRef = useRef<HTMLInputElement>(null);

  // Reset transient state any time the sheet opens with a new draft.
  React.useEffect(() => {
    if (open) {
      setConfirmingDelete(false);
      setUploadingCover(false);
      setGeneratingImage(false);
      setImageError(null);
      setRefineOpen(false);
      setRefineText('');
      setRefining(false);
      setRefineError(null);
      setIngTarget(null);
      setIngSwapOpen(false);
      setIngReplacement('');
      setIngBusy(false);
      setIngNotice(null);
    }
  }, [open, draft?.id]);

  // Focus the swap input the moment it expands.
  React.useEffect(() => {
    if (ingSwapOpen) {
      const t = setTimeout(() => ingSwapInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [ingSwapOpen]);

  // Focus the composer when it expands.
  React.useEffect(() => {
    if (refineOpen) {
      const t = setTimeout(() => refineInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [refineOpen]);

  const submitRefine = async (override?: string) => {
    const instruction = (override ?? refineText).trim();
    if (!instruction || refining || !onRefine) return;
    setRefining(true);
    setRefineError(null);
    const res = await onRefine(instruction);
    setRefining(false);
    if (res.ok) {
      setRefineText('');
      setRefineOpen(false);
    } else {
      setRefineError(res.error || "Couldn't apply that. Try rephrasing.");
    }
  };

  // Select / deselect an ingredient row for the remove/swap card.
  const toggleIngredientTarget = (name: string) => {
    if (ingBusy) return;
    setIngNotice(null);
    setIngSwapOpen(false);
    setIngReplacement('');
    setIngTarget((cur) => (cur === name ? null : name));
  };

  const submitIngredientEdit = async (action: 'remove' | 'substitute') => {
    if (!ingTarget || ingBusy || !onIngredientEdit) return;
    const target = ingTarget;
    const replacement = action === 'substitute' ? ingReplacement.trim() : '';
    setIngBusy(true);
    setIngNotice(null);
    const res = await onIngredientEdit({
      action,
      ingredient: target,
      replacement: replacement || undefined,
    });
    setIngBusy(false);
    if (res.ok) {
      setIngTarget(null);
      setIngSwapOpen(false);
      setIngReplacement('');
      setIngNotice({
        kind: 'success',
        text: action === 'remove'
          ? `Removed ${target} and rebalanced the recipe.`
          : `Swapped ${target}${replacement ? ` for ${replacement}` : ''} and updated the recipe.`,
      });
    } else if (res.declined) {
      setIngNotice({
        kind: 'declined',
        text: res.declineReason || 'That change would compromise the recipe, so it was left unchanged.',
      });
    } else {
      setIngNotice({ kind: 'error', text: res.error || 'Something went wrong. Try again.' });
    }
  };

  // Ask the parent to generate an AI hero photo, then compress + apply it
  // through the same cover-photo path an upload uses.
  const handleGenerateImage = async () => {
    if (!onGenerateImage || generatingImage || uploadingCover) return;
    setGeneratingImage(true);
    setImageError(null);
    try {
      const res = await onGenerateImage();
      if (res.ok && res.dataUrl) {
        try {
          onCoverPhotoChange(await processDataUrl(res.dataUrl));
        } catch {
          // Compression failed (decode error) — keep the full-size image
          // rather than dropping the user's generated photo.
          onCoverPhotoChange(res.dataUrl);
        }
      } else {
        setImageError(res.error || "Couldn't generate a photo. Try again.");
      }
    } finally {
      setGeneratingImage(false);
    }
  };

  // Drive the estimated progress bar while a photo is generating. We don't
  // get real progress events, so ease toward ~95% on an exponential curve
  // tuned to a ~30s typical generation, then let the arriving image finish
  // it. Resets each time a generation starts.
  useEffect(() => {
    if (!generatingImage) return;
    const ESTIMATE_S = 30;       // typical generation time
    const TAU = ESTIMATE_S / 2.3; // ~90% by the estimate, asymptotic after
    const start = Date.now();
    setImageElapsed(0);
    setImageProgress(0);
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setImageElapsed(Math.floor(elapsed));
      setImageProgress(Math.min(95, 100 * (1 - Math.exp(-elapsed / TAU))));
    }, 150);
    return () => window.clearInterval(id);
  }, [generatingImage]);

  const handleCoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setUploadingCover(true);
    try {
      onCoverPhotoChange(await processPhoto(file));
    } catch {
      // Compression failed (huge file, decode error). Leave the cover
      // untouched; user can retry. No noisy alert — the placeholder
      // still says "Add cover photo".
    } finally {
      setUploadingCover(false);
    }
  };

  const cover = draft?.coverPhoto || '';
  const canEditCover = !publishedMealId;

  return (
    <AnimatePresence>
      {open && draft && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.2 : 0.16 }}
          className={cn(
            'fixed inset-0',
            zClass,
            phoneMode ? 'bg-black/50' : 'bg-black/50 backdrop-blur-md flex items-center justify-center px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { opacity: 0, y: 28 },
                  animate: { opacity: 1, y: 0 },
                  exit: { opacity: 0, y: 28 },
                  transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
                }
              : {
                  initial: { opacity: 0, scale: 0.96, y: -8 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.97, y: -6 },
                  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex flex-col overflow-hidden bg-surface',
              phoneMode
                // Full-page on mobile — not a draggable bottom sheet.
                ? 'fixed inset-0 h-full w-full'
                : 'w-full max-w-3xl rounded-[28px] max-h-[90vh] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-safe-4 pb-3' : 'px-7 pt-6 pb-3',
            )}>
              <div className="flex items-center gap-2 min-w-0">
                {publishedMealId ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-100/70 px-2 py-1 rounded-full">
                    <CheckCircle2 size={12} />
                    Published
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-on-surface/60 bg-on-surface/[0.06] px-2 py-1 rounded-full">
                    <Sparkles size={12} />
                    AI draft
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
                aria-label="Close"
              >
                <X size={15} className="text-on-surface/60" />
              </button>
            </div>

            <div className={cn('flex-1 overflow-y-auto pb-5', phoneMode ? 'px-5' : 'px-7')}>
              {/* Cover photo — full-bleed hero. Acts as either the
                  rendered cover (with a "Change" overlay) or as the
                  "Add cover photo" call-to-action when no cover is
                  attached. Hidden once published since the source-of-
                  truth then lives on the saved meal, not the draft. */}
              {canEditCover ? (
                <div className="mb-5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCoverPick}
                  />
                  {generatingImage ? (
                    // AI is painting the dish — placeholder hero with a
                    // shimmer + an estimated progress bar so the long
                    // (10-40s) call reads as visible progress.
                    <div className="relative w-full rounded-2xl overflow-hidden bg-on-surface/[0.05] aspect-[16/9] flex flex-col items-center justify-center gap-3 px-6">
                      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-on-surface/[0.03] to-on-surface/[0.10]" />
                      <Loader2 size={22} className="relative animate-spin text-primary" />
                      <div className="relative text-[13px] font-semibold text-on-surface/75 flex items-center gap-1.5">
                        <Sparkles size={13} className="text-primary" />
                        Generating photo… {Math.round(imageProgress)}%
                      </div>
                      <div className="relative w-full max-w-[260px] h-1.5 rounded-full bg-on-surface/[0.12] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                          style={{ width: `${imageProgress}%` }}
                        />
                      </div>
                      <div className="relative text-[11px] text-on-surface/45 tabular-nums">
                        {imageElapsed}s elapsed · usually ~30s
                      </div>
                    </div>
                  ) : cover ? (
                    <div className="relative w-full rounded-2xl overflow-hidden bg-on-surface/[0.05] aspect-[16/9]">
                      <img
                        src={cover}
                        alt={draft.name}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute bottom-2 right-2 flex gap-2">
                        {onGenerateImage && (
                          <button
                            type="button"
                            onClick={handleGenerateImage}
                            disabled={uploadingCover}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/55 backdrop-blur-sm text-white hover:bg-black/70 transition-colors disabled:opacity-60"
                            aria-label="Regenerate photo with AI"
                          >
                            <Sparkles size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingCover}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[12px] font-semibold hover:bg-black/70 transition-colors disabled:opacity-60"
                        >
                          <Camera size={13} />
                          {uploadingCover ? 'Uploading…' : 'Change'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onCoverPhotoChange(null)}
                          disabled={uploadingCover}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/55 backdrop-blur-sm text-white hover:bg-black/70 transition-colors disabled:opacity-60"
                          aria-label="Remove cover photo"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Empty state — upload your own, or let AI picture the
                    // finished dish from the recipe.
                    <div className="w-full rounded-2xl border-2 border-dashed border-on-surface/15 bg-on-surface/[0.03] py-6 px-5 flex flex-col items-center justify-center gap-2.5">
                      <div className="w-10 h-10 rounded-full bg-on-surface/[0.06] flex items-center justify-center text-on-surface/55">
                        <ImagePlus size={18} />
                      </div>
                      <div className="text-[13px] font-semibold text-on-surface/75">
                        {uploadingCover ? 'Uploading photo…' : 'Add a cover photo'}
                      </div>
                      <div className="text-[11px] text-on-surface/45 -mt-1">
                        Optional · saved with the recipe
                      </div>
                      <div className="flex items-center gap-2 w-full max-w-sm mt-1">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingCover}
                          className="flex-1 h-10 rounded-xl bg-on-surface/[0.06] text-on-surface text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-on-surface/[0.10] transition-colors disabled:opacity-60"
                        >
                          <Camera size={14} />
                          Upload
                        </button>
                        {onGenerateImage && (
                          <button
                            type="button"
                            onClick={handleGenerateImage}
                            disabled={uploadingCover}
                            className="flex-1 h-10 rounded-xl bg-primary/[0.08] border border-primary/25 text-primary text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-primary/[0.12] transition-colors disabled:opacity-60"
                          >
                            <Sparkles size={14} />
                            Generate with AI
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {imageError && (
                    <p className="text-[11.5px] text-red-600 mt-2 pl-1 flex items-center gap-1.5">
                      <AlertCircle size={12} />
                      {imageError}
                    </p>
                  )}
                </div>
              ) : cover ? (
                <div className="mb-5 w-full rounded-2xl overflow-hidden bg-on-surface/[0.05] aspect-[16/9] relative">
                  <img
                    src={cover}
                    alt={draft.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
              ) : null}

              <h2 className={cn('font-serif font-bold text-on-surface leading-tight', phoneMode ? 'text-[26px]' : 'text-[32px]')}>
                {draft.name}
              </h2>
              {draft.summary && (
                <p className={cn('text-on-surface/70 mt-2.5 leading-relaxed', phoneMode ? 'text-[14px]' : 'text-[15.5px]')}>
                  {draft.summary}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {draft.cuisine && (
                  <Chip icon={<ChefHat size={12} />}>{draft.cuisine}</Chip>
                )}
                {draft.course?.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/75"
                  >
                    {c}
                  </span>
                ))}
                {draft.difficulty && (
                  <Chip icon={<Flame size={12} />}>{draft.difficulty}</Chip>
                )}
                {(() => {
                  // Active = hands-on prep + cook; total also banks the passive
                  // proof/chill/rest time. Showing both keeps long/overnight
                  // projects honest instead of reading a tiny "108 min".
                  const active = (draft.prepTime || 0) + (draft.cookTime || 0);
                  const total = active + (draft.chillTime || 0);
                  if (total <= 0) return null;
                  const fmt = (m: number) =>
                    m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`;
                  return (
                    <Chip icon={<Clock size={12} />}>
                      {draft.chillTime ? `Active ${fmt(active)} · Total ${fmt(total)}` : fmt(total)}
                    </Chip>
                  );
                })()}
                {draft.servings && (
                  <Chip icon={<Users size={12} />}>
                    {draft.yieldDescription || `${draft.servings} ${draft.servings === 1 ? 'serving' : 'servings'}`}
                  </Chip>
                )}
              </div>

              {draft.equipment && draft.equipment.length > 0 && (
                <Section title="Equipment">
                  <ul className="flex flex-wrap gap-2">
                    {draft.equipment.map((e) => (
                      <li
                        key={e}
                        className="text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/70"
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Ingredients">
                {(() => {
                  const canIngredientEdit = !!onIngredientEdit && !publishedMealId;
                  const renderIngredient = (i: RecipeIngredient, key: string) => {
                    const inner = (
                      <>
                        <span className="font-medium text-on-surface">
                          {[i.amount, i.unit].filter(Boolean).join(' ')}
                        </span>{' '}
                        {i.name}
                      </>
                    );
                    if (!canIngredientEdit) {
                      return (
                        <li key={key} className="text-[14px] text-on-surface/85 leading-relaxed">
                          {inner}
                        </li>
                      );
                    }
                    const selected = ingTarget === i.name;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => toggleIngredientTarget(i.name)}
                          disabled={ingBusy}
                          className={cn(
                            'group w-full flex items-start gap-2 text-left text-[14px] leading-relaxed rounded-lg px-2 py-1 -mx-2 transition-colors disabled:opacity-60',
                            selected
                              ? 'bg-primary/[0.08] text-on-surface'
                              : 'text-on-surface/85 hover:bg-on-surface/[0.04]',
                          )}
                        >
                          <span className="flex-1 min-w-0">{inner}</span>
                          <Repeat
                            size={13}
                            className={cn(
                              'flex-shrink-0 mt-1 transition-opacity',
                              selected ? 'text-primary opacity-100' : 'text-on-surface/35 opacity-0 group-hover:opacity-100',
                            )}
                          />
                        </button>
                      </li>
                    );
                  };

                  return (
                    <>
                      {canIngredientEdit && (
                        <p className="text-[11.5px] text-on-surface/45 -mt-1 mb-2.5">
                          Tap an ingredient to remove it or swap it for something else.
                        </p>
                      )}
                      {draft.ingredientGroups && draft.ingredientGroups.length > 0 ? (
                        draft.ingredientGroups.map((g) => (
                          <div key={g.name} className="mb-4 last:mb-0">
                            {(draft.ingredientGroups!.length > 1 || g.name !== 'Ingredients') && (
                              <h4 className="text-[12px] font-semibold uppercase tracking-wider text-on-surface/50 mb-2">
                                {g.name}
                              </h4>
                            )}
                            <ul className="space-y-1.5">
                              {g.ingredients.map((i, idx) => renderIngredient(i, `${g.name}-${idx}`))}
                            </ul>
                          </div>
                        ))
                      ) : (
                        <ul className="space-y-1.5">
                          {draft.ingredients?.map((i, idx) => renderIngredient(i, String(idx)))}
                        </ul>
                      )}

                      {/* Remove / swap action card for the selected row —
                          one tap on Remove fires immediately; Swap expands
                          an inline replacement input. */}
                      <AnimatePresence>
                        {canIngredientEdit && ingTarget && (
                          <motion.div
                            key="ing-panel"
                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            className="mt-3 rounded-[20px] bg-on-surface text-surface p-2 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)]"
                          >
                            {ingBusy ? (
                              <div className="flex items-center gap-2.5 px-3 py-2.5">
                                <Loader2 size={15} className="animate-spin text-surface/80 flex-shrink-0" />
                                <span className="text-[13px] font-medium text-surface/90 truncate">
                                  Updating the recipe…
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 px-3 pt-1.5 pb-2">
                                  <Sparkles size={12} className="text-surface/55 flex-shrink-0" />
                                  <span className="text-[12.5px] font-semibold text-surface truncate flex-1">
                                    {ingTarget}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setIngTarget(null)}
                                    aria-label="Close"
                                    className="w-6 h-6 -mr-0.5 rounded-full hover:bg-surface/10 flex items-center justify-center text-surface/55 hover:text-surface transition-colors flex-shrink-0"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                                {ingSwapOpen ? (
                                  <div className="flex items-center gap-1.5 rounded-[14px] bg-surface/10 pl-3 pr-1 py-1">
                                    <input
                                      ref={ingSwapInputRef}
                                      type="text"
                                      value={ingReplacement}
                                      onChange={(e) => setIngReplacement(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); submitIngredientEdit('substitute'); }
                                        if (e.key === 'Escape') setIngSwapOpen(false);
                                      }}
                                      placeholder="Swap with… (blank = AI picks)"
                                      className="flex-1 min-w-0 bg-transparent text-[13px] text-surface placeholder:text-surface/40 focus:outline-none py-1.5"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => submitIngredientEdit('substitute')}
                                      aria-label="Apply swap"
                                      className="w-8 h-8 rounded-full bg-surface text-on-surface flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0"
                                    >
                                      <ArrowUp size={14} strokeWidth={2.5} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => submitIngredientEdit('remove')}
                                      className="flex-1 h-9 rounded-[14px] bg-surface/10 hover:bg-surface/[0.16] text-surface text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                      <Trash2 size={13} />
                                      Remove
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setIngSwapOpen(true)}
                                      className="flex-1 h-9 rounded-[14px] bg-surface/10 hover:bg-surface/[0.16] text-surface text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                                    >
                                      <Repeat size={13} />
                                      Swap
                                    </button>
                                  </div>
                                )}
                                <p className="px-3 pt-2 pb-1 text-[10.5px] leading-snug text-surface/45">
                                  AI keeps the dish authentic — it declines changes that would hurt it.
                                </p>
                              </>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Result of the last ingredient edit: applied, declined
                          (recipe untouched, with the AI's reason), or error. */}
                      <AnimatePresence>
                        {canIngredientEdit && ingNotice && (
                          <motion.div
                            key={`ing-notice-${ingNotice.kind}`}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.16 }}
                            className={cn(
                              'mt-3 flex gap-2.5 text-[13px] leading-relaxed p-3 rounded-2xl',
                              ingNotice.kind === 'success' && 'bg-emerald-50 text-emerald-900',
                              ingNotice.kind === 'declined' && 'bg-amber-50 text-amber-900',
                              ingNotice.kind === 'error' && 'bg-red-50 text-red-900',
                            )}
                          >
                            {ingNotice.kind === 'success' ? (
                              <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                            ) : (
                              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                            )}
                            <span>
                              {ingNotice.kind === 'declined' && (
                                <span className="font-semibold">Kept as is. </span>
                              )}
                              {ingNotice.text}
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  );
                })()}
              </Section>

              <Section title="Steps">
                {(() => {
                  type DraftStep = { title?: string; body: string; durationMin?: number; tip?: string };
                  const renderStep = (s: DraftStep, idx: number) => (
                    <li key={idx} className="flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-on-surface/[0.08] flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[11px] font-bold text-on-surface/70">{idx + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {s.title && (
                            <h4 className="text-[14px] font-semibold text-on-surface">{s.title}</h4>
                          )}
                          {typeof s.durationMin === 'number' && s.durationMin > 0 && (
                            <span className="text-[11px] text-on-surface/55 inline-flex items-center gap-1">
                              <Clock size={10} />
                              {s.durationMin} min
                            </span>
                          )}
                        </div>
                        <p className="text-[14px] text-on-surface/85 leading-relaxed mt-0.5">
                          {s.body}
                        </p>
                        {s.tip && (
                          <p className="text-[12px] text-on-surface/60 leading-relaxed mt-1.5 italic flex gap-1.5">
                            <Lightbulb size={12} className="flex-shrink-0 mt-0.5" />
                            <span>{s.tip}</span>
                          </p>
                        )}
                      </div>
                    </li>
                  );

                  // Grouped method (multi-component dishes): section labels
                  // with continuously-numbered steps.
                  const groups = draft.stepGroups;
                  const meaningful = !!groups && (groups.length > 1 || !!(groups[0]?.name || '').trim());
                  if (groups && meaningful) {
                    let n = 0;
                    return (
                      <div className="space-y-5">
                        {groups.map((g, gi) => {
                          const steps = g.steps.filter((s) => (s.body || '').trim());
                          if (steps.length === 0) return null;
                          return (
                            <div key={gi}>
                              {g.name && (
                                <h4 className="text-[12px] font-semibold uppercase tracking-wider text-on-surface/50 mb-2.5">
                                  {g.name}
                                </h4>
                              )}
                              <ol className="space-y-4">
                                {steps.map((s) => renderStep(s, n++))}
                              </ol>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }

                  const flat: DraftStep[] = draft.stepDetails && draft.stepDetails.length > 0
                    ? draft.stepDetails
                    : (draft.steps || []).map((s) => ({ body: s }));
                  return (
                    <ol className="space-y-4">
                      {flat.map((s, idx) => renderStep(s, idx))}
                    </ol>
                  );
                })()}
              </Section>

              {draft.notes && draft.notes.length > 0 && (
                <Section title="Notes">
                  <ul className="space-y-2">
                    {draft.notes.map((n, idx) => {
                      const meta = NOTE_META[n.type] ?? NOTE_META.general;
                      return (
                        <li
                          key={idx}
                          className={cn('flex gap-2.5 text-[13px] leading-relaxed p-3 rounded-2xl', meta.bg, meta.text)}
                        >
                          <meta.Icon size={14} className="flex-shrink-0 mt-0.5" />
                          <span>{n.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {draft.tags && draft.tags.length > 0 && (
                <Section title="Tags">
                  <ul className="flex flex-wrap gap-2">
                    {draft.tags.map((t) => (
                      <li
                        key={t}
                        className="text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/70"
                      >
                        #{t}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>

            {/* Refine with AI — only while unpublished and when the
                parent wired a handler. Collapsed by default; tapping
                "Refine with AI" expands a floating composer that lets
                the user keep tweaking the draft ("make it spicier",
                "swap walnuts for pecans") without leaving the preview. */}
            <div
              className={cn(
                'relative flex-shrink-0 border-t border-on-surface/[0.06]',
                phoneMode ? 'px-5 py-4 pb-safe-4' : 'px-7 py-4',
              )}
              // Lift the footer (and the refine composer anchored to it)
              // above the iOS keyboard — Keyboard resize:"none" means the
              // WebView doesn't shrink, so the auto-focused textarea would
              // otherwise sit behind the keys.
              style={phoneMode ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom), var(--kb-height, 0px))' } : undefined}
            >
              {/* Floating refine composer — animates up out of the
                  "Refine with AI" trigger. */}
              <AnimatePresence>
                {refineOpen && onRefine && !publishedMealId && (
                  <motion.div
                    key="refine-panel"
                    initial={{ opacity: 0, y: 14, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 14, scale: 0.97 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className={cn('absolute left-0 right-0 bottom-full mb-3 z-20', phoneMode ? 'px-5' : 'px-7')}
                  >
                    <div className="rounded-[20px] bg-surface border border-on-surface/10 shadow-[0_20px_60px_-14px_rgba(0,0,0,0.4)] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-primary">
                          <Sparkles size={13} />
                          Refine with AI
                        </div>
                        <button
                          type="button"
                          onClick={() => setRefineOpen(false)}
                          aria-label="Close"
                          className="w-7 h-7 -mr-1 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.1] flex items-center justify-center text-on-surface/55 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {/* Quick suggestions — one tap applies. */}
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {REFINE_SUGGESTIONS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            disabled={refining}
                            onClick={() => submitRefine(s)}
                            className="text-[12px] font-medium px-2.5 py-1.5 rounded-full bg-on-surface/[0.05] text-on-surface/70 hover:bg-primary/[0.08] hover:text-primary transition-colors disabled:opacity-50"
                          >
                            {s}
                          </button>
                        ))}
                      </div>

                      <div className={cn(
                        'rounded-2xl border bg-on-surface/[0.03] transition-colors flex items-end gap-2 pl-3.5 pr-2 py-2',
                        refineError ? 'border-red-300' : 'border-on-surface/12 focus-within:border-primary/40',
                      )}>
                        <textarea
                          ref={refineInputRef}
                          value={refineText}
                          onChange={(e) => { setRefineText(e.target.value); if (refineError) setRefineError(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitRefine(); }
                          }}
                          disabled={refining}
                          rows={1}
                          placeholder="Describe a change…"
                          className="flex-1 bg-transparent text-[14px] leading-snug text-on-surface placeholder:text-on-surface/35 focus:outline-none resize-none py-1.5 max-h-28 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => submitRefine()}
                          disabled={!refineText.trim() || refining}
                          aria-label="Apply refinement"
                          className={cn(
                            'flex items-center justify-center w-9 h-9 rounded-full transition-all flex-shrink-0',
                            refineText.trim() && !refining
                              ? 'bg-primary text-white hover:opacity-90'
                              : 'bg-on-surface/[0.08] text-on-surface/30 cursor-not-allowed',
                          )}
                        >
                          {refining ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
                        </button>
                      </div>
                      {refining && (
                        <p className="text-[11.5px] text-on-surface/45 mt-2 pl-1 flex items-center gap-1.5">
                          <Sparkles size={11} className="text-primary/70" />
                          Reworking the recipe…
                        </p>
                      )}
                      {refineError && (
                        <p className="text-[11.5px] text-red-600 mt-2 pl-1 flex items-center gap-1.5">
                          <AlertCircle size={12} />
                          {refineError}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {confirmingDelete ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-on-surface/75">
                    Remove this draft from the chat? You'll lose the AI's version.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 h-11 rounded-2xl bg-on-surface/[0.06] text-on-surface text-[14px] font-semibold hover:bg-on-surface/[0.10] transition-colors"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep draft
                    </button>
                    <button
                      type="button"
                      className="flex-1 h-11 rounded-2xl bg-red-600 text-white text-[14px] font-semibold hover:bg-red-700 transition-colors"
                      onClick={() => {
                        setConfirmingDelete(false);
                        onDelete();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {/* Refine-with-AI trigger — expands the floating
                      composer above. */}
                  {onRefine && !publishedMealId && (
                    <button
                      type="button"
                      onClick={() => setRefineOpen((o) => !o)}
                      className={cn(
                        'w-full h-10 rounded-2xl border text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 transition-colors',
                        refineOpen
                          ? 'bg-primary/[0.08] border-primary/30 text-primary'
                          : 'bg-primary/[0.04] border-primary/20 text-primary/90 hover:bg-primary/[0.08]',
                      )}
                    >
                      <Sparkles size={14} />
                      Refine with AI
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Delete draft"
                      className="w-11 h-11 rounded-2xl bg-on-surface/[0.05] text-on-surface/60 flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors flex-shrink-0"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      type="button"
                      className="flex-1 h-11 rounded-2xl bg-on-surface/[0.06] text-on-surface text-[14px] font-semibold hover:bg-on-surface/[0.10] transition-colors"
                      onClick={() => onEdit(draft)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'flex-[1.5] h-11 rounded-2xl text-[14px] font-semibold transition-colors inline-flex items-center justify-center gap-1.5',
                        publishedMealId
                          ? 'bg-emerald-600 text-white cursor-default'
                          : 'bg-on-surface text-surface hover:bg-on-surface/90',
                      )}
                      disabled={publishedMealId !== null}
                      onClick={() => onPublish(draft)}
                    >
                      {publishedMealId ? (
                        <>
                          <CheckCircle2 size={15} />
                          Published
                        </>
                      ) : (
                        publishLabel
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// One-tap refine suggestions shown in the floating composer.
const REFINE_SUGGESTIONS = [
  'Make it spicier',
  'Make it simpler',
  'Healthier',
  'Bigger batch',
  'Add a make-ahead tip',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="font-serif text-[15px] font-bold text-on-surface/85 mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full bg-on-surface/[0.05] text-on-surface/75">
      {icon}
      {children}
    </span>
  );
}

const NOTE_META: Record<string, { Icon: typeof Lightbulb; bg: string; text: string }> = {
  tip: { Icon: Lightbulb, bg: 'bg-amber-50', text: 'text-amber-900' },
  makeAhead: { Icon: CalendarClock, bg: 'bg-sky-50', text: 'text-sky-900' },
  substitution: { Icon: Repeat, bg: 'bg-violet-50', text: 'text-violet-900' },
  general: { Icon: BookOpenCheck, bg: 'bg-on-surface/[0.04]', text: 'text-on-surface/80' },
};
