import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Heart, Search, Edit3, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';

const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃', '🍔', '🥩', '🍝', '🍰', '🌙', '👥', '💼', '✈️', '🏨', '🎂', '⭐', '👑', '🏙️', '🥗', '🪙', '👶'];

const PRESET_LISTS = [
  { name: 'Best Date Night Spots', emoji: '🕯️', cat: 'Occasion' },
  { name: 'Birthday & Celebrations', emoji: '🎂', cat: 'Occasion' },
  { name: 'Late Night Eats', emoji: '🌙', cat: 'Occasion' },
  { name: 'Solo Dining Friendly', emoji: '🧘', cat: 'Occasion' },
  { name: 'Group Dinner & Big Tables', emoji: '👥', cat: 'Occasion' },
  { name: 'Hidden Gems', emoji: '💎', cat: 'Insider' },
  { name: 'Worth the Hype', emoji: '🔥', cat: 'Insider' },
  { name: 'Best Burgers', emoji: '🍔', cat: 'Food' },
  { name: 'Best Pizza', emoji: '🍕', cat: 'Food' },
  { name: 'Best Sushi & Omakase', emoji: '🍣', cat: 'Food' },
  { name: 'Best Brunch', emoji: '🥞', cat: 'Food' },
  { name: 'Best Cocktails', emoji: '🍸', cat: 'Food' },
  { name: 'Michelin Star Experiences', emoji: '⭐', cat: 'Luxury' },
  { name: 'Best Tasting Menus', emoji: '🍽️', cat: 'Luxury' },
  { name: 'Quick Bites', emoji: '⚡', cat: 'Daily' },
  { name: 'Healthy Options', emoji: '🥗', cat: 'Daily' },
  { name: 'Vacation Eats', emoji: '🏖️', cat: 'Travel' },
  { name: 'Hotel Restaurants', emoji: '🏨', cat: 'Travel' },
];

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

  // New list sheet
  const [newListSheetOpen, setNewListSheetOpen] = useState(false);
  const [newListMode, setNewListMode] = useState<'browse' | 'custom'>('browse');
  const [newListSearch, setNewListSearch] = useState('');
  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('📋');

  useEffect(() => {
    if (wishlistModalOpen && restaurant) {
      setNotes(existingItem?.notes ?? '');
      setSelectedListIds(existingItem?.listIds ?? []);
      setSaved(false);
      setNewListSheetOpen(false);
      setNewListMode('browse');
      setNewListSearch('');
      setCustomName('');
      setCustomEmoji('📋');
    }
  }, [wishlistModalOpen, restaurant]);

  const toggleList = (listId: string) => {
    setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);
  };

  const handleCreateFromPreset = (name: string, emoji: string) => {
    createList(name, emoji);
    setNewListSheetOpen(false);
    setNewListMode('browse');
    setNewListSearch('');
  };

  const handleCreateCustom = () => {
    if (!customName.trim()) return;
    createList(customName.trim(), customEmoji);
    setNewListSheetOpen(false);
    setNewListMode('browse');
    setCustomName('');
    setCustomEmoji('📋');
  };

  const existingNames = new Set(lists.map((l) => l.name.toLowerCase()));
  const filteredPresets = newListSearch.trim()
    ? PRESET_LISTS.filter((p) => p.name.toLowerCase().includes(newListSearch.toLowerCase()))
    : PRESET_LISTS;

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
    <>
    <AnimatePresence>
      {wishlistModalOpen && restaurant && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeWishlistModal}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-full rounded-none"
                : "h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl"
            )}
          >
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
                <div className="px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                  <div className="min-w-0">
                    <h2 className="font-serif font-bold text-lg truncate">
                      {alreadyWishlisted ? 'Edit Wishlist' : 'Add to Wishlist'}
                    </h2>
                    <p className="text-xs text-on-surface/40 truncate">{restaurant.name}</p>
                  </div>
                  <button onClick={closeWishlistModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4 space-y-4">
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

                      <button onClick={() => setNewListSheetOpen(true)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-dashed border-on-surface/15 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
                        <Plus size={14} />
                        <span className="text-xs font-semibold">New List</span>
                      </button>
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
                </div>

                {/* Sticky footer */}
                <div className="flex-shrink-0 border-t border-on-surface/8 px-5 py-4 space-y-2">
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

    {/* New List Sheet */}
    <AnimatePresence>
      {newListSheetOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110]" onClick={() => setNewListSheetOpen(false)} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={cn("fixed bottom-0 left-0 right-0 z-[110] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
              phoneMode ? "h-[92vh]" : "max-h-[75vh]")}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">{newListMode === 'browse' ? 'New List' : 'Create Custom List'}</h3>
              <button onClick={() => { setNewListSheetOpen(false); setNewListMode('browse'); }} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            {newListMode === 'browse' ? (
              <>
                <div className="px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={newListSearch} onChange={(e) => setNewListSearch(e.target.value)} placeholder="Search lists..."
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
                <div className="px-5 pb-2 flex-shrink-0">
                  <button onClick={() => setNewListMode('custom')}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/20 text-primary hover:bg-primary/5 transition-all">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Edit3 size={16} /></div>
                    <div className="text-left"><p className="text-sm font-semibold">Create Custom List</p><p className="text-[11px] text-primary/60">Choose your own name & emoji</p></div>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
                  {filteredPresets.map((preset) => {
                    const exists = existingNames.has(preset.name.toLowerCase());
                    return (
                      <button key={preset.name} onClick={() => !exists && handleCreateFromPreset(preset.name, preset.emoji)} disabled={exists}
                        className={cn("w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left",
                          exists ? "bg-on-surface/3 border-on-surface/5 opacity-50" : "bg-white border-on-surface/8 hover:border-primary/30 active:bg-primary/5")}>
                        <span className="text-xl">{preset.emoji}</span>
                        <span className="text-sm font-medium flex-1 truncate">{preset.name}</span>
                        {exists ? <span className="text-[10px] text-on-surface/30">Added</span> : <Plus size={16} className="text-on-surface/20" />}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-5 py-4 space-y-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">Choose an emoji</p>
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_OPTIONS.map((e) => (
                      <button key={e} onClick={() => setCustomEmoji(e)}
                        className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all", customEmoji === e ? "bg-primary/10 ring-2 ring-primary/30 scale-110" : "hover:bg-on-surface/5")}>{e}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">List name</p>
                  <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Enter list name..." autoFocus
                    className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCustom()} />
                </div>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setNewListMode('browse'); setCustomName(''); }} className="flex-1 py-3 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50">Back</button>
                  <button onClick={handleCreateCustom} disabled={!customName.trim()} className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40">Create</button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </>
  );
};
