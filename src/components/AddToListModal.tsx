import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';

const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

export const AddToListModal: React.FC = () => {
  const { addToListModalOpen, addToListRestaurantId, closeAddToListModal, lists, addToList, removeFromList, createList } = useLists();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const handleToggle = (listId: string, isIn: boolean) => {
    if (!addToListRestaurantId) return;
    if (isIn) {
      removeFromList(listId, addToListRestaurantId);
    } else {
      addToList(listId, addToListRestaurantId);
    }
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName('');
    setNewEmoji('📋');
    setCreating(false);
  };

  const handleClose = () => {
    setCreating(false);
    setNewName('');
    closeAddToListModal();
  };

  return (
    <AnimatePresence>
      {addToListModalOpen && addToListRestaurantId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl max-h-[70vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-surface/95 backdrop-blur-sm px-5 pt-safe-5 pb-3 border-b border-on-surface/8 z-10">
              <div className="flex items-center justify-between">
                <h2 className="font-serif font-bold text-lg">Add to List</h2>
                <button onClick={handleClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 space-y-2">
              {lists.map((list) => {
                const isIn = list.restaurantIds.includes(addToListRestaurantId);
                return (
                  <button
                    key={list.id}
                    onClick={() => handleToggle(list.id, isIn)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                      isIn
                        ? "bg-primary/5 border-primary/20"
                        : "bg-white border-on-surface/8 hover:border-on-surface/15"
                    )}
                  >
                    <span className="text-xl">{list.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{list.name}</p>
                      <p className="text-[11px] text-on-surface/40">{list.restaurantIds.length} restaurant{list.restaurantIds.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all",
                      isIn ? "bg-primary border-primary text-white" : "border-on-surface/15"
                    )}>
                      {isIn && <Check size={14} strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}

              {/* Create new list */}
              {creating ? (
                <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
                  <div className="flex gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {EMOJI_OPTIONS.map((e) => (
                        <button
                          key={e}
                          onClick={() => setNewEmoji(e)}
                          className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all",
                            newEmoji === e ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-on-surface/5"
                          )}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
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
                      Create
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
