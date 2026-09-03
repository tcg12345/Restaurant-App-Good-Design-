// Add / edit recipe modal — a two-stage experience:
//
//   1. CHOOSE — opening the modal for a NEW recipe first shows a compact
//      method chooser: a short bottom sheet on phone, a centered card on
//      desktop. Four ways in: web link, photo, from scratch, or AI.
//   2. FLOW — picking a method transitions into that flow full-size:
//      the Import panel (link/photo/text), the five-step Builder, or the
//      AI generator. A "‹ New recipe" chip in each flow's header returns
//      to the chooser.
//
// Editing an existing recipe (or resuming a draft from Activity) skips
// the chooser and opens the Builder directly — legacy basic recipes
// hydrate losslessly (flat ingredients/steps become a single section;
// photos / dishes / dates pass through untouched on update).

import React, { useState, useEffect } from 'react';
import { GlassButton } from '../lib/glass-buttons';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Link2, Camera, PenLine, ClipboardType, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type HomeMeal } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { usePaywall } from '../contexts/PaywallContext';
import { usePlan } from '../contexts/PlanContext';
import { ProTag } from './pro/ProMark';
import { useBottomSheet, acquireHardScrollLock } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';
import { wakeGlassButtons } from '../lib/glass-buttons';
import { ImportRecipePanel } from './ImportRecipePanel';
import { AdvancedRecipeBuilder } from './AdvancedRecipeBuilder';
import { AiRecipeGenerator } from './AiRecipeGenerator';
import { RecipeDraftSheet } from './chat/RecipeDraftSheet';
import { refineRecipe, editRecipeIngredient, type IngredientEdit, type IngredientEditResult } from '../lib/build-recipe-client';
import { generateRecipeImage } from '../lib/generate-recipe-image-client';
import { useAiChatHistory } from '../contexts/AiChatHistoryContext';
import { peekPendingResumeDraftId } from '../lib/recipe-drafts';
import './RecipeBuilder.css';

type BuilderMode = 'import' | 'advanced' | 'ai';
type Stage = 'choose' | 'flow';
type Method = 'link' | 'photo' | 'text' | 'custom' | 'ai';

/* ── Method chooser ───────────────────────────────────────────── */

const METHODS: Array<{ key: Method; icon: React.ReactNode; title: string; sub: string }> = [
  { key: 'link', icon: <Link2 size={17} strokeWidth={2} />, title: 'From a web link', sub: 'Paste a link from any recipe site' },
  { key: 'photo', icon: <Camera size={17} strokeWidth={2} />, title: 'From a photo', sub: 'A cookbook page, screenshot, or card' },
  { key: 'text', icon: <ClipboardType size={17} strokeWidth={2} />, title: 'From text', sub: 'Paste a recipe you already have' },
  { key: 'custom', icon: <PenLine size={17} strokeWidth={2} />, title: 'Start from scratch', sub: 'Build it step by step' },
  { key: 'ai', icon: <Sparkles size={17} strokeWidth={2} />, title: 'Create with AI', sub: 'Describe it, get a complete draft' },
];

/** Which chooser rows are Pro-only (they stay in the list, tagged). */
const PRO_METHODS: ReadonlySet<Method> = new Set<Method>(['photo']);

const MethodChooser: React.FC<{
  phoneMode: boolean;
  onPick: (m: Method) => void;
  onClose: () => void;
}> = ({ phoneMode, onPick, onClose }) => {
  const planCtx = usePlan();
  const locked = planCtx.checked && !planCtx.isPro ? PRO_METHODS : new Set<Method>();
  return (
  <div className="rcx-choose">
    {phoneMode ? (
      <div className="rcx-choose-handle" aria-hidden />
    ) : (
      <button type="button" className="rcx-choose-close" onClick={onClose} aria-label="Close">
        <X size={14} />
      </button>
    )}
    <h2 className="rcx-choose-title">Add a recipe</h2>
    <p className="rcx-choose-sub">How do you want to start?</p>
    {phoneMode ? (
      <div className="rcx-choose-list">
        {METHODS.map((m) => (
          <button key={m.key} type="button" className="rcx-choose-row" onClick={() => onPick(m.key)}>
            <span className="rcx-choose-icon">{m.icon}</span>
            <span className="rcx-choose-text">
              <span className="rcx-choose-name">{m.title}{locked.has(m.key) && <ProTag className="ml-2" />}</span>
              <span className="rcx-choose-hint">{m.sub}</span>
            </span>
            <ChevronRight size={15} className="rcx-choose-chev" />
          </button>
        ))}
      </div>
    ) : (
      <div className="rcx-choose-grid">
        {METHODS.map((m) => (
          <button key={m.key} type="button" className="rcx-choose-card" onClick={() => onPick(m.key)}>
            <span className="rcx-choose-icon">{m.icon}</span>
            <span className="rcx-choose-name">{m.title}{locked.has(m.key) && <ProTag className="ml-2" />}</span>
            <span className="rcx-choose-hint">{m.sub}</span>
          </button>
        ))}
      </div>
    )}
  </div>
  );
};

/* ── Modal ────────────────────────────────────────────────────── */

export const AddHomeMealModal: React.FC = () => {
  const {
    homeMealModalOpen, homeMealModalData, homeMealModalBackToDraft, homeMealModalTargetListId, homeMealModalInitialMethod, homeMealModalInitialAiView, homeMealModalSeed, closeHomeMealModal,
    createHomeMeal, addRecipeToList,
  } = useLists();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();
  const { addGeneratedRecipeChat } = useAiChatHistory();
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth.user?.id || null;

  const existing = homeMealModalData;

  const [stage, setStage] = useState<Stage>('choose');
  const [mode, setMode] = useState<BuilderMode>('advanced');
  const [importTab, setImportTab] = useState<'link' | 'photo' | 'text'>('link');

  // ── Create-with-AI state ──
  // `aiDraft` — the generated recipe shown in the RecipeDraftSheet
  //             preview (reuses the exact sheet from the main chat).
  // `seed`    — pre-fills the Advanced builder as a NEW recipe, opened
  //             on the Review step. Two origins: tapping Edit on an AI
  //             draft ('ai'), or a completed import ('import').
  const [aiDraft, setAiDraft] = useState<HomeMeal | null>(null);
  const { handleAiError, requirePro } = usePaywall();
  const [seed, setSeed] = useState<HomeMeal | null>(null);
  const [seedKind, setSeedKind] = useState<'ai' | 'import'>('ai');
  /* Consume-once copy of the caller's preselected AI view (the Pantry
     "Ideas" pill). A LOCAL copy, not the context value: backing out to
     the chooser and manually picking "Create with AI" in the same open
     must land on the normal prompt hero, not re-read 'ideas'. */
  const [aiView, setAiView] = useState<'recipe' | 'ideas' | null>(null);

  // Each open decides the entry point: editing an existing recipe or
  // resuming a draft skips the chooser; a preselected method (from the
  // Create page's embedded surface) jumps straight into that flow; new
  // recipes otherwise start on the chooser.
  useEffect(() => {
    if (!homeMealModalOpen) return;
    setAiView(homeMealModalInitialAiView);
    // An externally-handed draft (recipe-page Combine) outranks everything:
    // it is a NEW recipe to review, never an edit — `existing` means edit
    // and publishes over the original.
    if (homeMealModalSeed) {
      if (homeMealModalSeed.kind === 'import') {
        setSeed(homeMealModalSeed.meal);
        setSeedKind('import');
        setMode('advanced');
      } else {
        // 'ai' and 'combine' land on the draft-preview sheet, the same
        // landing every AI create gets.
        setAiDraft(homeMealModalSeed.meal);
        setMode('ai');
      }
      setStage('flow');
    } else if (existing || peekPendingResumeDraftId()) {
      setMode('advanced');
      setStage('flow');
    } else if (homeMealModalInitialMethod) {
      if (homeMealModalInitialMethod === 'custom') setMode('advanced');
      else if (homeMealModalInitialMethod === 'ai') setMode('ai');
      else {
        setMode('import');
        setImportTab(homeMealModalInitialMethod);
      }
      setStage('flow');
    } else {
      setStage('choose');
    }
  }, [homeMealModalOpen, existing, homeMealModalInitialMethod, homeMealModalInitialAiView, homeMealModalSeed]);

  // Reset transient state whenever the modal closes so the next open
  // starts clean.
  useEffect(() => {
    if (!homeMealModalOpen) {
      setAiDraft(null);
      setSeed(null);
      setSeedKind('ai');
      setAiView(null);
      setStage('choose');
      setMode('advanced');
    }
  }, [homeMealModalOpen]);

  // Drag-to-dismiss for the phone chooser sheet.
  const { dragProps, sheetRef } = useBottomSheet(homeMealModalOpen && stage === 'choose' && phoneMode, closeHomeMealModal);

  // The chooser's lock above releases the moment a flow opens, leaving the
  // document behind the (position:fixed) flow scrollable. With
  // Keyboard.resize:"none" that is exactly the room the focus-reveal scroll
  // (native-keyboard.ts, and WKWebView's own) uses: focusing the AI prompt
  // scrolled the page BEHIND the modal, dragging the modal down with it and
  // leaving every swipe on the ideas grid scrolling that page instead. Hold
  // a lock for the whole time the modal is open, whatever stage it's in.
  useEffect(() => {
    if (!homeMealModalOpen) return;
    return acquireHardScrollLock();
  }, [homeMealModalOpen]);

  /* The WHOLE modal is an overlay, not just its chooser stage.
     useBottomSheet above registers one only while the chooser is up on a
     phone, so the moment you picked a method the count fell back to zero
     and the native glass tab bar — a UIKit view ABOVE the WebView, which
     no amount of CSS can cover — came back and drew across the builder's
     footer. Registering for the modal's whole life keeps it away, and the
     same signal wakes the glass-button sampler so any button underneath
     re-samples as occluded. */
  useEffect(() => {
    if (!homeMealModalOpen) return;
    const release = pushOverlay();
    /* And re-sample the glass buttons AFTER the entrance settles. The
       sampler reads occlusion and ancestor opacity from the DOM, and this
       modal enters on a Framer transform+fade — which fires neither
       `transitionend` nor `animationend`, the two things that would
       normally re-arm it (see glass-buttons#occluded). Sample mid-entrance
       and every button under it, including this modal's OWN header chip
       and close button, latches the alpha it had while the sheet was still
       transparent, and nothing ever looks again. Three probes across the
       animation cost nothing and leave no frame to lose. */
    const wakes = [120, 400, 800].map((ms) => setTimeout(wakeGlassButtons, ms));
    return () => {
      wakes.forEach(clearTimeout);
      release();
    };
  }, [homeMealModalOpen]);

  const handlePickMethod = (m: Method) => {
    // A Pro-only method opens the paywall instead; a purchase lands the
    // person where they were headed.
    if (PRO_METHODS.has(m) && !requirePro('recipe-import-photo', { onUnlocked: () => handlePickMethod(m) })) return;
    // A manual pick is a fresh decision — the preselected AI view must
    // not leak into it (see aiView above).
    setAiView(null);
    if (m === 'custom') setMode('advanced');
    else if (m === 'ai') setMode('ai');
    else {
      setMode('import');
      setImportTab(m);
    }
    setStage('flow');
  };

  // Hand-off from the AI generator: stash the generated recipe and open
  // the preview sheet. Nothing is saved to the cookbook yet — the user
  // publishes (or edits) from the sheet. We also record the draft into the
  // assistant's chat history so a recipe generated here shows up there too,
  // exactly like one drafted in a conversation.
  const handleAiGenerated = (meal: HomeMeal, meta?: { prompt: string; rawInput: unknown }) => {
    setAiDraft(meal);
    if (meta) addGeneratedRecipeChat({ prompt: meta.prompt, draft: meal, rawInput: meta.rawInput });
  };

  // Hand-off from the Import tab: the transcription is done — seed the
  // builder and land on Review so the user can check it over.
  const handleImported = (meal: HomeMeal) => {
    setSeed(meal);
    setSeedKind('import');
    setMode('advanced');
    setStage('flow');
  };

  // Publish straight from the AI preview sheet.
  const handleAiPublish = (meal: HomeMeal) => {
    const { id: _id, createdAt: _createdAt, ...payload } = meal;
    const created = createHomeMeal(payload);
    // Honor the originating recipe list ("Add recipe" on a list page).
    if (created && homeMealModalTargetListId) addRecipeToList(homeMealModalTargetListId, created);
    setAiDraft(null);
    closeHomeMealModal();
    showToast('Recipe published', { variant: 'success' });
    if (created?.id) {
      const target = userId
        ? `/recipe/${userId}/${created.id}`
        : `/recipe/${created.id}`;
      setTimeout(() => navigate(target), 80);
    }
  };

  // Refine the in-preview AI draft with a free-text instruction.
  const handleAiRefine = async (instruction: string): Promise<{ ok: boolean; error?: string; handled?: boolean }> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to refine.' };
    const res = await refineRecipe(aiDraft, instruction);
    if (!res.ok && handleAiError('recipe-generate', res)) return { ok: false, handled: true };
    if (res.ok && res.meal) {
      setAiDraft(res.meal);
      return { ok: true };
    }
    return { ok: false, error: res.error };
  };

  // Remove or substitute one ingredient in the in-preview AI draft. The
  // AI may decline (recipe untouched) — the sheet renders its reason.
  const handleAiIngredientEdit = async (edit: IngredientEdit): Promise<IngredientEditResult> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to update.' };
    const res = await editRecipeIngredient(aiDraft, edit);
    if (!res.ok && !res.declined) handleAiError('recipe-generate', res);
    if (res.ok && res.meal) setAiDraft(res.meal);
    return res;
  };

  // Edit from the AI preview sheet → seed the Advanced builder (as a
  // brand-new recipe) and switch to it so the user can fine-tune.
  const handleAiEdit = (meal: HomeMeal) => {
    setSeed(meal);
    setSeedKind('ai');
    setAiDraft(null);
    setMode('advanced');
    setStage('flow');
  };

  // "Back to AI draft" from the Advanced builder. Only meaningful for
  // AI seeds (imports have no draft sheet to go back to). Two origins:
  //  • Modal "Create with AI" Edit → seed is set; reopen the local
  //    draft sheet and drop back to the AI tab behind it.
  //  • Chat Edit → the chat passed a reopen callback via
  //    openHomeMealModal(..., { onBackToDraft }); close this modal and
  //    fire it to re-surface the chat's draft sheet.
  const backToDraft = seed && seedKind === 'ai'
    ? () => { setAiDraft(seed); setSeed(null); setMode('ai'); }
    : homeMealModalBackToDraft
      ? () => { const cb = homeMealModalBackToDraft; closeHomeMealModal(); cb(); }
      : undefined;

  // Attach / clear a cover photo on the in-preview AI draft.
  const handleAiCoverChange = (dataUrl: string | null) => {
    setAiDraft((prev) =>
      prev
        ? {
            ...prev,
            coverPhoto: dataUrl || undefined,
            photos: dataUrl
              ? Array.from(new Set([dataUrl, ...(prev.photos || [])]))
              : (prev.photos || []).filter((p) => p !== prev.coverPhoto),
          }
        : prev,
    );
  };

  // Generate an AI hero photo of the finished dish. The sheet compresses
  // the result and applies it via handleAiCoverChange.
  const handleAiGenerateImage = async (): Promise<{ ok: boolean; dataUrl?: string; error?: string; handled?: boolean }> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to picture yet.' };
    // Pro-only: ask before spending the request. The server refuses a
    // forged call anyway, and that refusal takes the same road.
    if (!requirePro('recipe-image')) return { ok: false, handled: true };
    const res = await generateRecipeImage(aiDraft);
    if (!res.ok && handleAiError('recipe-image', res)) return { ok: false, handled: true };
    return res;
  };

  // Header-left slot inside each flow: a chip back to the chooser.
  // Hidden when editing (the builder shows an "Edit recipe" eyebrow) and
  // when a seed is under review (going back would discard it — the
  // dedicated "Back to AI draft" chip covers the AI case).
  const methodChip = (!existing && !seed) ? (
    <GlassButton
      id="recipe-method-chip"
      symbol="chevron.left"
      // A pill, not a circle: the native side lays the chevron and the word
      // out together when a title is set.
      title="New recipe"
      label="Back to new recipe"
      onClick={() => setStage('choose')}
      className="rcx-method-chip"
    >
      <ChevronLeft size={13} strokeWidth={2.4} />
      New recipe
    </GlassButton>
  ) : undefined;

  return (
    <>
      <AnimatePresence>
        {homeMealModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={cn('fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center',
              phoneMode ? 'items-end' : 'items-end sm:items-center'
            )}
            onClick={closeHomeMealModal}
          >
            <AnimatePresence mode="wait">
              {stage === 'choose' ? (
                <motion.div
                  key="chooser"
                  ref={phoneMode ? (sheetRef as React.RefObject<HTMLDivElement>) : undefined}
                  initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.94, y: 14 }}
                  animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
                  exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
                  transition={phoneMode
                    ? { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const }
                    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  {...(phoneMode ? dragProps : {})}
                  onClick={(e) => e.stopPropagation()}
                  className={cn('w-full overflow-hidden',
                    phoneMode
                      ? 'rounded-t-3xl'
                      : 'sm:max-w-[560px] rounded-t-3xl sm:rounded-3xl'
                  )}
                >
                  <MethodChooser phoneMode={phoneMode} onPick={handlePickMethod} onClose={closeHomeMealModal} />
                </motion.div>
              ) : (
                <motion.div
                  key={`flow-${mode}`}
                  initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 10 }}
                  animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
                  exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 8 }}
                  transition={phoneMode
                    ? { type: 'spring', damping: 30, stiffness: 300 }
                    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  className={cn('bg-surface w-full overflow-hidden flex flex-col',
                    phoneMode
                      ? 'h-full rounded-none'
                      : 'h-full sm:max-w-[760px] sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl'
                  )}
                >
                  {mode === 'advanced' ? (
                    <AdvancedRecipeBuilder
                      key={seed ? seed.id : 'fresh'}
                      existing={existing}
                      seed={seed}
                      seedKind={seedKind}
                      initialStep={seed ? 4 : undefined}
                      onClose={closeHomeMealModal}
                      onBackToDraft={backToDraft}
                      tabSlot={methodChip}
                    />
                  ) : mode === 'ai' ? (
                    <AiRecipeGenerator
                      onGenerated={handleAiGenerated}
                      onClose={closeHomeMealModal}
                      phoneMode={phoneMode}
                      tabSlot={methodChip}
                      initialView={aiView ?? undefined}
                    />
                  ) : (
                    <ImportRecipePanel
                      key={importTab}
                      onImported={handleImported}
                      onClose={closeHomeMealModal}
                      phoneMode={phoneMode}
                      tabSlot={methodChip}
                      initialTab={importTab}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI recipe preview — the SAME sheet the main chat uses. Layered
          above the modal (z-[210]) so Publish / Edit / cover-photo all
          work in place. Publish saves + closes; Edit hands off to the
          Advanced builder seeded with the draft. */}
      <RecipeDraftSheet
        open={aiDraft !== null}
        draft={aiDraft}
        publishedMealId={null}
        onClose={() => setAiDraft(null)}
        onPublish={handleAiPublish}
        onEdit={handleAiEdit}
        onDelete={() => setAiDraft(null)}
        onCoverPhotoChange={handleAiCoverChange}
        onRefine={handleAiRefine}
        onGenerateImage={handleAiGenerateImage}
        onIngredientEdit={handleAiIngredientEdit}
        zClass="z-[210]"
        publishLabel="Publish recipe"
      />
    </>
  );
};
