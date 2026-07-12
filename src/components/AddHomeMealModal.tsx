// Add / edit recipe modal — the shell around the three creation modes:
//
//   Import  — bring a recipe in from a link, photos, or pasted text
//             (AI-transcribed, lands on the builder's Review step).
//   Builder — the five-step Advanced builder (also used for ALL edits).
//   AI      — describe a dish, get a complete draft to review.
//
// The old "Basic" quick form is gone: the builder hydrates legacy basic
// recipes losslessly (flat ingredients/steps become a single section,
// and photos / dishes / dates pass through untouched on update), so
// editing any recipe now opens the builder directly, with no tab strip.

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type HomeMeal } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ImportRecipesModal } from './ImportRecipesModal';
import { ImportRecipePanel } from './ImportRecipePanel';
import { AdvancedRecipeBuilder } from './AdvancedRecipeBuilder';
import { AiRecipeGenerator } from './AiRecipeGenerator';
import { RecipeDraftSheet } from './chat/RecipeDraftSheet';
import { refineRecipe, editRecipeIngredient, type IngredientEdit, type IngredientEditResult } from '../lib/build-recipe-client';
import { generateRecipeImage } from '../lib/generate-recipe-image-client';
import { useAiChatHistory } from '../contexts/AiChatHistoryContext';
import { peekPendingResumeDraftId } from '../lib/recipe-drafts';

/* ── Tab-mode preference (sticky across sessions) ────────────── */

const MODE_KEY = 'gourmad-recipe-builder-mode';
type BuilderMode = 'import' | 'advanced' | 'ai';

// Legacy values ('basic' from before the Import tab existed) fall back
// to the builder.
const loadMode = (): BuilderMode => {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'import' ? 'import' : 'advanced';
  } catch { return 'advanced'; }
};
const saveMode = (m: 'import' | 'advanced') => {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* quota — skip */ }
};

interface TabToggleProps {
  mode: BuilderMode;
  onChange: (m: BuilderMode) => void;
}

const TabToggle: React.FC<TabToggleProps> = ({ mode, onChange }) => (
  <div className="arb-tab-toggle" role="tablist" aria-label="Recipe builder mode">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'import'}
      className={mode === 'import' ? 'is-active' : ''}
      onClick={() => onChange('import')}
    >
      Import
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'advanced'}
      className={mode === 'advanced' ? 'is-active' : ''}
      onClick={() => onChange('advanced')}
    >
      Builder
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'ai'}
      className={cn('arb-tab-ai', mode === 'ai' ? 'is-active' : '')}
      onClick={() => onChange('ai')}
    >
      <Sparkles size={13} />
      AI
    </button>
  </div>
);

export const AddHomeMealModal: React.FC = () => {
  const {
    homeMealModalOpen, homeMealModalData, homeMealModalBackToDraft, homeMealModalTargetListId, closeHomeMealModal,
    createHomeMeal, addRecipeToList,
  } = useLists();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();
  const { addGeneratedRecipeChat } = useAiChatHistory();
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth.user?.id || null;

  const existing = homeMealModalData;

  // Editing always opens the builder (no tab strip). New recipes default
  // to the user's last-used creation mode.
  const [mode, setMode] = useState<BuilderMode>(() => {
    if (existing || peekPendingResumeDraftId()) return 'advanced';
    return loadMode();
  });

  // ── Create-with-AI state ──
  // `aiDraft` — the generated recipe shown in the RecipeDraftSheet
  //             preview (reuses the exact sheet from the main chat).
  // `seed`    — pre-fills the Advanced builder as a NEW recipe, opened
  //             on the Review step. Two origins: tapping Edit on an AI
  //             draft ('ai'), or a completed import ('import').
  const [aiDraft, setAiDraft] = useState<HomeMeal | null>(null);
  const [seed, setSeed] = useState<HomeMeal | null>(null);
  const [seedKind, setSeedKind] = useState<'ai' | 'import'>('ai');

  // Re-evaluate when the modal opens with a different `existing` meal
  // or a new pending-resume flag.
  useEffect(() => {
    if (existing || peekPendingResumeDraftId()) setMode('advanced');
  }, [existing, homeMealModalOpen]);

  // Reset transient draft state whenever the modal closes so the next
  // open starts clean.
  useEffect(() => {
    if (!homeMealModalOpen) {
      setAiDraft(null);
      setSeed(null);
      setSeedKind('ai');
    }
  }, [homeMealModalOpen]);

  const handleModeChange = (m: BuilderMode) => {
    setMode(m);
    // The AI tab is transient — never persist it as the sticky default.
    if (m !== 'ai') saveMode(m);
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
  const handleAiRefine = async (instruction: string): Promise<{ ok: boolean; error?: string }> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to refine.' };
    const res = await refineRecipe(aiDraft, instruction);
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
  const handleAiGenerateImage = async (): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to picture yet.' };
    return generateRecipeImage(aiDraft);
  };

  const [importRecipesOpen, setImportRecipesOpen] = useState(false);

  const tabSlot = existing
    ? undefined
    : <TabToggle mode={mode} onChange={handleModeChange} />;

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
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
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
                  tabSlot={tabSlot}
                />
              ) : mode === 'ai' ? (
                <AiRecipeGenerator
                  onGenerated={handleAiGenerated}
                  onClose={closeHomeMealModal}
                  phoneMode={phoneMode}
                  tabSlot={tabSlot}
                />
              ) : (
                <ImportRecipePanel
                  onImported={handleImported}
                  onClose={closeHomeMealModal}
                  phoneMode={phoneMode}
                  tabSlot={tabSlot}
                  onOpenBulk={() => setImportRecipesOpen(true)}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ImportRecipesModal
        open={importRecipesOpen}
        onClose={() => setImportRecipesOpen(false)}
      />

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
