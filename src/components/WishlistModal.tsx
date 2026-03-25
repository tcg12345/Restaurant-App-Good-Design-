import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Heart } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';

const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

export const WishlistModal: React.FC = () => {
  const {
    wishlistModalOpen, wishlistModalMeta, closeWishlistModal,
    addToWishlist, isWishlisted, removeFromWishlist, getWishlistItem,
    lists, createList,
  } = useLists();
  const { phoneMode } = useSettings();

  const restaurant = wishlistModalMeta;
  const alreadyWishlisted = restaurant ? isWishlisted(restaurant.id) : false;
  const existingItem = restaurant ? getWishlistItem(restaurant.id) : undefined;

  const [notes, setNotes] = useState('');
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  // List creation
  const [creatingList, setCreatingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  useEffect(() => {
    if (wishlistModalOpen && restaurant) {
      setNotes(existingItem?.notes ?? '');
      setSelectedListIds(existingItem?.listIds ?? []);
      setSaved(false);
      setCreatingList(false);
      setNewName('');
    }
  }, [wishlistModalOpen, restaurant]);

  const toggleList = (listId: string) => {
    setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);
  };

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName('');
    setNewEmoji('📋');
    setCreatingList(false);
  };

  const handleSave = () => {
    if (!restaurant) return;
    addToWishlist({
      restaurantId: restaurant.id,
      name: restaurant.name,
      image: restaurant.image,
      cuisine: restaurant.cuisine,
      price: restaurant.price,
      address: restaurant.address,
      notes,
      listIds: selectedListIds,
      addedAt: Date.now(),
    });
    setSaved(true);
    setTimeout(() => closeWishlistModal(), 700);
  };

  const handleRemove = () => {
    if (!restaurant) return;
    removeFromWishlist(restaurant.id);
    closeWishlistModal();
  };

  return (
    <AnimatePresence>
      {wishlistModalOpen && restaurant && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          onClick={closeWishlistModal}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "bg-surface overflow-hidden flex flex-col",
              phoneMode
                ? "w-full rounded-t-3xl max-h-[85vh]"
                : "w-full max-w-md rounded-3xl max-h-[85vh] shadow-2xl"
            )}
          >
            {/* Drag handle (phone) */}
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            {/* Saved state */}
            {saved ? (
              <div className="text-center py-12">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}>
                  <Heart size={40} className="mx-auto text-red-400 fill-red-400 mb-3" />
                </motion.div>
                <p className="text-sm font-medium text-on-surface/60">Added to wishlist!</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="px-5 pt-2 sm:pt-5 pb-3 flex items-center justify-between flex-shrink-0">
                  <div className="min-w-0">
                    <h2 className="font-serif font-bold text-base sm:text-lg truncate">
                      {alreadyWishlisted ? 'Edit Wishlist' : 'Add to Wishlist'}
                    </h2>
                    <p className="text-xs text-on-surface/40 truncate">{restaurant.name}</p>
                  </div>
                  <button onClick={closeWishlistModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 space-y-4">
                  {/* Lists */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Add to Lists</label>
                    <p className="text-[11px] text-on-surface/30 mb-2">Optional — select lists or save to All Restaurants only</p>
                    <div className="space-y-1.5">
                      {lists.map((list) => {
                        const selected = selectedListIds.includes(list.id);
                        return (
                          <button
                            key={list.id}
                            onClick={() => toggleList(list.id)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-left",
                              selected ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8"
                            )}
                          >
                            <span className="text-base">{list.emoji}</span>
                            <span className="flex-1 text-xs font-semibold truncate">{list.name}</span>
                            <div className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all",
                              selected ? "bg-primary border-primary text-white" : "border-on-surface/15"
                            )}>
                              {selected && <Check size={11} strokeWidth={3} />}
                            </div>
                          </button>
                        );
                      })}

                      {creatingList ? (
                        <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {EMOJI_OPTIONS.map((e) => (
                              <button key={e} onClick={() => setNewEmoji(e)}
                                className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all", newEmoji === e ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-on-surface/5")}
                              >{e}</button>
                            ))}
                          </div>
                          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name..." autoFocus
                            className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateList()} />
                          <div className="flex gap-2">
                            <button onClick={() => { setCreatingList(false); setNewName(''); }} className="flex-1 py-1.5 rounded-xl border border-on-surface/10 text-xs font-medium text-on-surface/50">Cancel</button>
                            <button onClick={handleCreateList} disabled={!newName.trim()} className="flex-1 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold disabled:opacity-40">Create</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setCreatingList(true)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-dashed border-on-surface/15 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
                          <Plus size={14} />
                          <span className="text-xs font-semibold">New List</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Why do you want to try this place?"
                      rows={2}
                      className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                    />
                  </div>

                  {/* Actions */}
                  <button onClick={handleSave}
                    className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
                    <Heart size={16} />
                    {alreadyWishlisted ? 'Update Wishlist' : 'Save to Wishlist'}
                  </button>

                  {alreadyWishlisted && (
                    <button onClick={handleRemove}
                      className="w-full py-2.5 text-red-400 text-xs font-semibold hover:text-red-500 transition-colors">
                      Remove from Wishlist
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
