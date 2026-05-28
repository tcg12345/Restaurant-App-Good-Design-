import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, BookmarkPlus } from 'lucide-react';
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
}

/** Bottom-sheet / centered modal that lets the user save a recipe into
 *  any of their home-cooking lists. Mirrors the restaurant AddToListModal
 *  UX: a toggle row per list plus an inline "create new list" affordance.
 *  Membership is keyed by recipe id, so the checkmarks reflect the live
 *  state and toggling is idempotent. */
export const SaveRecipeToListSheet: React.FC<SaveRecipeToListSheetProps> = ({ open, onClose, meal }) => {
  const { lists, addRecipeToList, removeRecipeFromList, createList } = useLists();
  const { showToast } = useToast();
  const { dragProps } = useBottomSheet(open, onClose);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🍳');

  // Only home-cooking lists can hold recipes.
  const recipeLists = lists.filter((l) => l.type === 'home-cooking');

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
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[120] flex items-end sm:items-center justify-center"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl max-h-[75vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-surface/95 backdrop-blur-sm px-5 pt-safe-5 pb-3 border-b border-on-surface/8 z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <BookmarkPlus size={18} className="text-primary flex-shrink-0" />
                  <h2 className="font-serif font-bold text-lg truncate">Save to list</h2>
                </div>
                <button onClick={handleClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors" aria-label="Close">
                  <X size={20} />
                </button>
              </div>
              <p className="text-[12px] text-on-surface/45 truncate mt-0.5">{meal.name}</p>
            </div>

            <div className="px-5 py-4 space-y-2">
              {recipeLists.map((list) => {
                const isIn = (list.recipes || []).some((r) => r.id === meal.id);
                const count = list.recipes?.length ?? 0;
                return (
                  <button
                    key={list.id}
                    onClick={() => handleToggle(list.id, isIn)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                      isIn ? 'bg-primary/5 border-primary/20' : 'bg-white border-on-surface/8 hover:border-on-surface/15',
                    )}
                  >
                    <span className="text-xl">{list.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{list.name}</p>
                      <p className="text-[11px] text-on-surface/40">{count} recipe{count !== 1 ? 's' : ''}</p>
                    </div>
                    <div className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all',
                      isIn ? 'bg-primary border-primary text-white' : 'border-on-surface/15',
                    )}>
                      {isIn && <Check size={14} strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}

              {/* Create new list */}
              {creating ? (
                <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_OPTIONS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setNewEmoji(e)}
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all',
                          newEmoji === e ? 'bg-primary/10 ring-2 ring-primary/30' : 'hover:bg-on-surface/5',
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
                    placeholder="List name..."
                    autoFocus
                    className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCreating(false); setNewName(''); }}
                      className="flex-1 py-2 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim()}
                      className="flex-1 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40"
                    >
                      Create & save
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-on-surface/15 text-on-surface/40 hover:border-primary hover:text-primary transition-all"
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-on-surface/5">
                    <Plus size={16} />
                  </div>
                  <span className="text-sm font-semibold">Create New List</span>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
