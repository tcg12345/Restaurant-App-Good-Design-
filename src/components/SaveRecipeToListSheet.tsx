import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, BookmarkPlus, BookOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type HomeMeal } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useBottomSheet } from '../lib/useBottomSheet';

const EMOJI_OPTIONS = ['🍳', '📋', '🍝', '🥗', '🍰', '🍜', '🌮', '🔥', '🥘', '🍲', '☕', '🌿', '👨‍🍳', '🎉', '🥩', '🍞'];

interface SaveRecipeToListSheetProps {
  open: boolean;
  onClose: () => void;
  /** The recipe to save. Null while the sheet is closed. */
  meal: HomeMeal | null;
  /** When true, show an "All Recipes" target that saves the recipe into
   *  the cookbook pool directly. Set when saving ANOTHER user's recipe;
   *  omitted for the user's own recipes (which are implicitly already
   *  in their cookbook). */
  allowCookbook?: boolean;
}

/** Bottom-sheet / centered modal that lets the user save a recipe into
 *  any of their home-cooking lists. Mirrors the restaurant AddToListModal
 *  UX: a toggle row per list plus an inline "create new list" affordance.
 *  Membership is keyed by recipe id, so the checkmarks reflect the live
 *  state and toggling is idempotent. */
export const SaveRecipeToListSheet: React.FC<SaveRecipeToListSheetProps> = ({ open, onClose, meal, allowCookbook }) => {
  const { lists, homeMeals, addRecipeToList, removeRecipeFromList, createList, addRecipeToCookbook, removeRecipeFromCookbook } = useLists();
  const { showToast } = useToast();
  const { dragProps } = useBottomSheet(open, onClose);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🍳');

  // Only home-cooking lists can hold recipes.
  const recipeLists = lists.filter((l) => l.type === 'home-cooking');
  const inCookbook = meal ? homeMeals.some((m) => m.id === meal.id) : false;

  const handleToggle = (listId: string, isIn: boolean) => {
    if (!meal) return;
    if (isIn) {
      removeRecipeFromList(listId, meal.id);
      showToast('Removed from list');
    } else {
      addRecipeToList(listId, meal);
      showToast('Saved to list');
    }
  };

  const handleToggleCookbook = () => {
    if (!meal) return;
    if (inCookbook) {
      removeRecipeFromCookbook(meal.id);
      showToast('Removed from All Recipes');
    } else {
      addRecipeToCookbook(meal);
      showToast('Saved to All Recipes');
    }
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || !meal) return;
    const list = createList(name, newEmoji, 'home-cooking');
    addRecipeToList(list.id, meal);
    showToast(`Saved to ${name}`);
    setNewName('');
    setNewEmoji('🍳');
    setCreating(false);
  };

  const handleClose = () => {
    setCreating(false);
    setNewName('');
    onClose();
  };

  return (
    <AnimatePresence>
      {open && meal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[120] flex items-end sm:items-center justify-center"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full sm:max-w-[440px] sm:rounded-[28px] rounded-t-[28px] max-h-[82vh] overflow-y-auto shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]"
          >
            {/* Header */}
            <div className="sticky top-0 bg-surface/95 backdrop-blur-sm px-6 pt-safe-6 pt-6 pb-5 border-b border-on-surface/[0.06] z-10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BookmarkPlus size={20} className="text-primary flex-shrink-0" strokeWidth={2.2} />
                  <h2 className="font-serif font-bold text-[22px] leading-none">Save to list</h2>
                </div>
                <button
                  onClick={handleClose}
                  aria-label="Close"
                  className="w-9 h-9 -mr-1.5 -mt-1 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.1] transition-colors flex items-center justify-center text-on-surface/65 flex-shrink-0"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="text-[14px] text-on-surface/55 mt-2 line-clamp-1 pr-2">{meal.name}</p>
            </div>

            <div className="px-5 py-5 space-y-2.5">
              {/* All Recipes — saves another user's recipe straight into
                  the cookbook pool. Only offered when allowCookbook is
                  set (i.e. this isn't already the user's own recipe). */}
              {allowCookbook && (
                <button
                  onClick={handleToggleCookbook}
                  className={cn(
                    'w-full flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all text-left',
                    inCookbook
                      ? 'bg-primary/[0.06] border-primary/25'
                      : 'bg-white border-on-surface/[0.08] hover:border-on-surface/20 hover:shadow-[0_4px_14px_-8px_rgba(0,0,0,0.18)]',
                  )}
                >
                  <span className="w-11 h-11 rounded-xl bg-primary/[0.1] flex items-center justify-center text-primary flex-shrink-0">
                    <BookOpen size={19} strokeWidth={2.1} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-on-surface truncate">All Recipes</p>
                    <p className="text-[12px] text-on-surface/45 mt-0.5">Your full cookbook</p>
                  </div>
                  <div className={cn(
                    'w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all flex-shrink-0',
                    inCookbook
                      ? 'bg-primary text-white'
                      : 'border-2 border-on-surface/18',
                  )}>
                    {inCookbook && <Check size={14} strokeWidth={3} />}
                  </div>
                </button>
              )}

              {recipeLists.map((list) => {
                const isIn = (list.recipes || []).some((r) => r.id === meal.id);
                const count = list.recipes?.length ?? 0;
                return (
                  <button
                    key={list.id}
                    onClick={() => handleToggle(list.id, isIn)}
                    className={cn(
                      'w-full flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all text-left',
                      isIn
                        ? 'bg-primary/[0.06] border-primary/25'
                        : 'bg-white border-on-surface/[0.08] hover:border-on-surface/20 hover:shadow-[0_4px_14px_-8px_rgba(0,0,0,0.18)]',
                    )}
                  >
                    <span className="w-11 h-11 rounded-xl bg-on-surface/[0.04] flex items-center justify-center text-[22px] leading-none flex-shrink-0">
                      {list.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-on-surface truncate">{list.name}</p>
                      <p className="text-[12px] text-on-surface/45 mt-0.5">{count} recipe{count !== 1 ? 's' : ''}</p>
                    </div>
                    <div className={cn(
                      'w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all flex-shrink-0',
                      isIn
                        ? 'bg-primary text-white'
                        : 'border-2 border-on-surface/18',
                    )}>
                      {isIn && <Check size={14} strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}

              {/* Create new list */}
              {creating ? (
                <div className="p-4 rounded-2xl border border-primary/20 bg-primary/[0.04] space-y-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/50">
                    Pick an emoji
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_OPTIONS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setNewEmoji(e)}
                        className={cn(
                          'w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all',
                          newEmoji === e
                            ? 'bg-primary/10 ring-2 ring-primary/30'
                            : 'hover:bg-on-surface/[0.05]',
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="List name…"
                    autoFocus
                    className="w-full bg-white border border-on-surface/10 rounded-xl px-3.5 py-3 text-[14px] font-medium focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/30"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCreating(false); setNewName(''); }}
                      className="flex-1 py-2.5 rounded-xl bg-on-surface/[0.06] text-on-surface/65 text-[13px] font-semibold hover:bg-on-surface/[0.1] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim()}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                      Create & save
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl border border-dashed border-on-surface/15 text-on-surface/45 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.02] transition-all"
                >
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-on-surface/[0.04]">
                    <Plus size={18} strokeWidth={2.2} />
                  </div>
                  <span className="text-[15px] font-semibold">Create New List</span>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
