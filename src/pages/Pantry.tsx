import React, { useState, useRef, useMemo, useEffect } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Star, ChevronRight, Plus, Trash2, ArrowLeft, ListPlus, MapPin, SlidersHorizontal, X, ChevronDown, Heart, Upload, Search, Check, Edit3, LayoutGrid, List, ArrowUpDown, MoreHorizontal, Download, Plane } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type CustomList, type PhotoItem, type Trip, type TripRestaurant, type TripHotel, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { Link, useNavigate } from 'react-router-dom';
import { searchHotels, type PlaceResult } from '../lib/places';
import { useAuth } from '../contexts/AuthContext';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, Calendar } from '../components/RatingShared';

/* ── Preset list suggestions ── */
interface PresetList { name: string; emoji: string; category: string; type?: 'hotel-breakfast'; }

const PRESET_LISTS: PresetList[] = [
  { name: 'Best Date Night Spots', emoji: '🕯️', category: 'Occasion & Vibe' },
  { name: 'Birthday & Celebrations', emoji: '🎂', category: 'Occasion & Vibe' },
  { name: 'Late Night Eats', emoji: '🌙', category: 'Occasion & Vibe' },
  { name: 'Solo Dining Friendly', emoji: '🧘', category: 'Occasion & Vibe' },
  { name: 'Group Dinner & Big Tables', emoji: '👥', category: 'Occasion & Vibe' },
  { name: 'Business Dinners', emoji: '💼', category: 'Occasion & Vibe' },
  { name: 'Outdoor Dining & Patios', emoji: '🌳', category: 'Occasion & Vibe' },
  { name: 'Cozy & Intimate', emoji: '🪵', category: 'Occasion & Vibe' },
  { name: 'Live Music & Dining', emoji: '🎵', category: 'Occasion & Vibe' },
  { name: 'Airport Food', emoji: '✈️', category: 'Travel & Location' },
  { name: 'Hotel Restaurants', emoji: '🏨', category: 'Travel & Location' },
  { name: 'Hotel Breakfasts', emoji: '🛏️', category: 'Travel & Location', type: 'hotel-breakfast' },
  { name: 'Vacation Eats', emoji: '🏖️', category: 'Travel & Location' },
  { name: 'Road Trip Stops', emoji: '🚗', category: 'Travel & Location' },
  { name: 'Ski Resort Dining', emoji: '⛷️', category: 'Travel & Location' },
  { name: 'Beach Town Eats', emoji: '🏝️', category: 'Travel & Location' },
  { name: 'College Town Favorites', emoji: '🎓', category: 'Travel & Location' },
  { name: 'Hidden Gems', emoji: '💎', category: 'Insider & Opinion' },
  { name: 'Overrated Places', emoji: '👎', category: 'Insider & Opinion' },
  { name: 'Best Bang for Your Buck', emoji: '💰', category: 'Insider & Opinion' },
  { name: 'Worth the Hype', emoji: '🔥', category: 'Insider & Opinion' },
  { name: 'Tourist Traps vs Local Faves', emoji: '🗺️', category: 'Insider & Opinion' },
  { name: "Places I'd Never Go Back To", emoji: '🚫', category: 'Insider & Opinion' },
  { name: 'Underrated Spots', emoji: '🤫', category: 'Insider & Opinion' },
  { name: 'Best Burgers', emoji: '🍔', category: 'Food-Specific' },
  { name: 'Best Pizza', emoji: '🍕', category: 'Food-Specific' },
  { name: 'Best Pasta', emoji: '🍝', category: 'Food-Specific' },
  { name: 'Best Coffee Shops', emoji: '☕', category: 'Food-Specific' },
  { name: 'Best Desserts', emoji: '🍰', category: 'Food-Specific' },
  { name: 'Best Brunch', emoji: '🥞', category: 'Food-Specific' },
  { name: 'Best Steak', emoji: '🥩', category: 'Food-Specific' },
  { name: 'Best Sushi & Omakase', emoji: '🍣', category: 'Food-Specific' },
  { name: 'Best Cocktails', emoji: '🍸', category: 'Food-Specific' },
  { name: 'Best Tacos', emoji: '🌮', category: 'Food-Specific' },
  { name: 'Best Ramen & Noodles', emoji: '🍜', category: 'Food-Specific' },
  { name: 'Best Seafood', emoji: '🦞', category: 'Food-Specific' },
  { name: 'Michelin Star Experiences', emoji: '⭐', category: 'Luxury & Lifestyle' },
  { name: 'Best Tasting Menus', emoji: '🍽️', category: 'Luxury & Lifestyle' },
  { name: 'Luxury Dining', emoji: '👑', category: 'Luxury & Lifestyle' },
  { name: 'Best Rooftop Restaurants', emoji: '🏙️', category: 'Luxury & Lifestyle' },
  { name: 'Best Views', emoji: '🌅', category: 'Luxury & Lifestyle' },
  { name: "Chef's Table Experiences", emoji: '👨‍🍳', category: 'Luxury & Lifestyle' },
  { name: 'Quick Bites', emoji: '⚡', category: 'Functional & Daily' },
  { name: 'Best Takeout', emoji: '📦', category: 'Functional & Daily' },
  { name: 'Delivery Favorites', emoji: '🚲', category: 'Functional & Daily' },
  { name: 'Healthy Options', emoji: '🥗', category: 'Functional & Daily' },
  { name: 'Vegetarian & Vegan', emoji: '🌿', category: 'Functional & Daily' },
  { name: 'Gluten-Free Friendly', emoji: '🌾', category: 'Functional & Daily' },
  { name: 'Kid-Friendly', emoji: '👶', category: 'Functional & Daily' },
  { name: 'Budget Eats', emoji: '🪙', category: 'Functional & Daily' },
  { name: "Friends' Favorites", emoji: '👯', category: 'Social' },
  { name: "Places We've Been Together", emoji: '🤝', category: 'Social' },
  { name: 'Friend Recommendations', emoji: '💬', category: 'Social' },
  { name: 'Want to Try Together', emoji: '📌', category: 'Social' },
];

const PRESET_CATEGORIES = [...new Set(PRESET_LISTS.map((p) => p.category))];
const CUSTOM_EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃', '🍔', '🥩', '🍝', '🍰', '🌙', '👥', '💼', '✈️', '🏨', '🎂', '⭐', '👑', '🏙️', '🥗', '🪙', '👶'];

/* ── Create New List Bottom Sheet ── */
const CreateListSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, emoji: string, type?: PresetList['type']) => void;
  existingListNames: string[];
}> = ({ open, onClose, onCreate, existingListNames }) => {
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'browse' | 'custom'>('browse');
  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('📋');

  const existingNamesLower = useMemo(() => new Set(existingListNames.map((n) => n.toLowerCase())), [existingListNames]);

  const filteredPresets = useMemo(() => {
    if (!search.trim()) return PRESET_LISTS;
    const q = search.toLowerCase();
    return PRESET_LISTS.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [search]);

  const groupedPresets = useMemo(() => {
    const groups: Record<string, PresetList[]> = {};
    for (const preset of filteredPresets) {
      if (!groups[preset.category]) groups[preset.category] = [];
      groups[preset.category].push(preset);
    }
    return groups;
  }, [filteredPresets]);

  const handleSelectPreset = (preset: PresetList) => { onCreate(preset.name, preset.emoji, preset.type); handleClose(); };
  const handleCreateCustom = () => { if (!customName.trim()) return; onCreate(customName.trim(), customEmoji); handleClose(); };
  const handleClose = () => { setSearch(''); setMode('browse'); setCustomName(''); setCustomEmoji('📋'); onClose(); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex justify-center", phoneMode ? "items-end" : "items-end sm:items-center")} onClick={handleClose}>
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col", phoneMode ? "h-full rounded-none" : "h-full sm:h-auto sm:max-w-md sm:max-h-[75vh] rounded-none sm:rounded-3xl")}
          >
            <div className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-3 flex-shrink-0">
              <h2 className="font-serif font-bold text-lg">{mode === 'browse' ? 'New List' : 'Create Custom List'}</h2>
              <button onClick={handleClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
            </div>

            {mode === 'browse' ? (
              <>
                <div className="px-5 pb-3">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lists..."
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                  </div>
                </div>
                <div className="px-5 pb-3">
                  <button onClick={() => setMode('custom')} className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/20 text-primary hover:bg-primary/5 transition-all">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Edit3 size={16} /></div>
                    <div className="text-left">
                      <p className="text-sm font-semibold">Create Custom List</p>
                      <p className="text-[11px] text-primary/60">Choose your own name & emoji</p>
                    </div>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-5">
                  {Object.keys(groupedPresets).length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-sm text-on-surface/40">No matching lists found</p>
                      <button onClick={() => { setMode('custom'); setCustomName(search); }} className="mt-3 text-sm font-semibold text-primary">Create "{search}" as custom list</button>
                    </div>
                  ) : (
                    PRESET_CATEGORIES.filter((cat) => groupedPresets[cat]).map((category) => (
                      <div key={category} className="mb-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mb-2 px-1">{category}</p>
                        <div className="space-y-1.5">
                          {groupedPresets[category].map((preset) => {
                            const alreadyExists = existingNamesLower.has(preset.name.toLowerCase());
                            return (
                              <button key={preset.name} onClick={() => !alreadyExists && handleSelectPreset(preset)} disabled={alreadyExists}
                                className={cn("w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left",
                                  alreadyExists ? "bg-on-surface/3 border-on-surface/5 opacity-50 cursor-not-allowed" : "bg-white border-on-surface/8 hover:border-primary/30 hover:bg-primary/3 active:bg-primary/5")}>
                                <span className="text-xl flex-shrink-0">{preset.emoji}</span>
                                <span className="text-sm font-medium flex-1 truncate">{preset.name}</span>
                                {alreadyExists ? <span className="text-[10px] text-on-surface/30 font-medium flex-shrink-0">Added</span> : <Plus size={16} className="text-on-surface/20 flex-shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="px-5 pb-5 space-y-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">Choose an emoji</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CUSTOM_EMOJI_OPTIONS.map((e) => (
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
                {customName.trim() && (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl border border-primary/10">
                    <span className="text-2xl">{customEmoji}</span>
                    <span className="text-sm font-semibold">{customName.trim()}</span>
                  </div>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setMode('browse'); setCustomName(''); setCustomEmoji('📋'); }} className="flex-1 py-3 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50">Back</button>
                  <button onClick={handleCreateCustom} disabled={!customName.trim()} className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40 transition-colors">Create List</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Add From Rated Bottom Sheet ── */
const AddFromRatedSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  listId: string;
  listRestaurantIds: string[];
}> = ({ open, onClose, listId, listRestaurantIds }) => {
  const { ratings, addToList, removeFromList } = useLists();
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return ratings;
    const q = search.toLowerCase();
    return ratings.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
  }, [ratings, search]);

  const handleToggle = (restaurantId: string) => {
    if (listRestaurantIds.includes(restaurantId)) removeFromList(listId, restaurantId);
    else addToList(listId, restaurantId);
  };

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex justify-center", phoneMode ? "items-end" : "items-end sm:items-center")} onClick={onClose}>
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col", phoneMode ? "h-full rounded-none" : "h-full sm:h-auto sm:max-w-md sm:max-h-[70vh] rounded-none sm:rounded-3xl")}
          >
            <div className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-3 flex-shrink-0">
              <h2 className="font-serif font-bold text-lg">Add Rated Restaurants</h2>
              <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
            </div>
            <div className="px-5 pb-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, cuisine, or location..."
                  className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
              </div>
            </div>
            <div className="px-5 pb-2">
              <p className="text-[11px] text-on-surface/40 font-medium">{filtered.length} restaurant{filtered.length !== 1 ? 's' : ''}{listRestaurantIds.length > 0 && ` · ${listRestaurantIds.length} in list`}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
              {filtered.length === 0 ? (
                <div className="text-center py-12"><p className="text-sm text-on-surface/40">{ratings.length === 0 ? 'No rated restaurants yet' : 'No matches found'}</p></div>
              ) : filtered.map((r) => {
                const isInList = listRestaurantIds.includes(r.restaurantId);
                return (
                  <button key={r.restaurantId} onClick={() => handleToggle(r.restaurantId)}
                    className={cn("w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left", isInList ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                    <div className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-on-surface/5">
                      {r.image ? <img src={r.image} alt={r.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-on-surface/20 font-serif font-bold text-sm">{r.name.charAt(0)}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <p className="text-[11px] text-on-surface/40 truncate">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                    </div>
                    {r.score > 0 && <span className={cn("text-sm font-serif font-bold flex-shrink-0", scoreColor(r.score))}>{r.score.toFixed(1)}</span>}
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all flex-shrink-0", isInList ? "bg-primary border-primary text-white" : "border-on-surface/15")}>
                      {isInList && <Check size={14} strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Restaurant row card ── */
const RestaurantRow: React.FC<{
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  score?: number;
  tags?: string[];
  notes?: string;
  visitDate?: string;
  wouldReturn?: boolean;
  listBadges?: { emoji: string; name: string }[];
  onEdit?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}> = ({ restaurantId, name, image, cuisine, price, address, score, tags, notes, visitDate, wouldReturn, listBadges, onEdit, onRemove, removeLabel }) => {
  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
  const { phoneMode } = useSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swiped, setSwiped] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [isDragging, setIsDragging] = useState(false);

  // Extract city, state from address
  const location = (() => {
    if (!address) return '';
    const parts = address.split(',').map((s) => s.trim());
    if (parts.length >= 2) return parts.slice(-2).join(', ').replace(/\d{5}.*/, '').trim().replace(/,\s*$/, '');
    return parts[0] || '';
  })();

  const handleDelete = () => {
    if (onRemove) {
      setDismissed(true);
      setTimeout(() => onRemove(), 300);
    }
  };

  if (dismissed) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Swipe-to-delete red background */}
      {onRemove && (
        <div className="absolute inset-0 bg-red-500 flex items-center justify-end px-5 rounded-2xl">
          <Trash2 size={18} className="text-white" />
        </div>
      )}

      <motion.div
        drag={onRemove ? 'x' : false}
        dragConstraints={{ left: -150, right: 0 }}
        dragElastic={0.1}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(_: any, info: any) => {
          setTimeout(() => setIsDragging(false), 50);
          if (info.offset.x < -120) handleDelete();
          else if (info.offset.x < -50) setSwiped(true);
          else setSwiped(false);
        }}
        animate={{ x: swiped ? -80 : 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        style={{ touchAction: 'pan-y' }}
        className="relative z-10"
      >
        <Link to={`/restaurant/${restaurantId}`} className="block" onClick={(e) => { if (isDragging || swiped) e.preventDefault(); }}>
          <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden flex active:scale-[0.99] transition-transform">
            {!phoneMode && (
              <div className="w-24 sm:w-28 flex-shrink-0">
                {image ? (
                  <img src={image} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full min-h-[5rem] bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-2xl font-serif font-bold">
                    {name.charAt(0)}
                  </div>
                )}
              </div>
            )}
            <div className={cn("flex-1 min-w-0", phoneMode ? "px-3.5 py-2.5" : "p-3")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif font-bold text-sm leading-tight truncate">{name}</h3>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider">
                      {cuisine}{price ? ` · ${price}` : ''}
                    </span>
                    {location && (
                      <>
                        <span className="text-on-surface/20 text-[10px]">|</span>
                        <span className="text-[10px] text-on-surface/35 truncate">{location}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {score !== undefined && (
                    <span className={cn("text-lg font-serif font-bold leading-none", scoreColor(score))}>
                      {score.toFixed(1)}
                    </span>
                  )}
                  {onEdit && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                      className="p-1.5 text-on-surface/30 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                    >
                      <Edit3 size={13} />
                    </button>
                  )}
                  {onRemove && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); phoneMode ? handleDelete() : setConfirmDelete(true); }}
                      className="p-1.5 text-on-surface/20 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              {tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{tag}</span>
                  ))}
                  {tags.length > 3 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-on-surface/5 text-on-surface/30 font-medium">+{tags.length - 3}</span>
                  )}
                </div>
              )}
              {listBadges && listBadges.length > 0 && (
                <div className="flex gap-1 mt-1 overflow-hidden">
                  {listBadges.slice(0, 2).map((l, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/8 text-secondary/60 font-medium whitespace-nowrap">
                      {l.emoji} {l.name}
                    </span>
                  ))}
                  {listBadges.length > 2 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-on-surface/5 text-on-surface/30 font-medium">+{listBadges.length - 2}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Link>
      </motion.div>

      {/* Swipe action button */}
      {swiped && onRemove && (
        <button
          onClick={handleDelete}
          className="absolute right-0 top-0 bottom-0 w-20 bg-red-500 flex items-center justify-center rounded-r-2xl z-0"
        >
          <Trash2 size={18} className="text-white" />
        </button>
      )}

      {/* Desktop delete confirmation */}
      {confirmDelete && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm rounded-2xl flex items-center justify-center gap-3 border border-red-200">
          <p className="text-xs text-on-surface/60 font-medium">Delete this restaurant?</p>
          <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-on-surface/5">Cancel</button>
          <button onClick={handleDelete} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
        </div>
      )}
    </div>
  );
};

/* ── Wishlist row (simpler, no score) ── */
const WishlistRow: React.FC<{
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  notes?: string;
  onRemove?: () => void;
}> = ({ restaurantId, name, image, cuisine, price, notes, onRemove }) => {
  return (
    <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden flex">
      <Link to={`/restaurant/${restaurantId}`} className="w-20 sm:w-24 flex-shrink-0 block">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full min-h-[5rem] bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-2xl font-serif font-bold">
            {name.charAt(0)}
          </div>
        )}
      </Link>
      <div className="flex-1 p-3 min-w-0 flex flex-col justify-between">
        <div>
          <Link to={`/restaurant/${restaurantId}`}>
            <h3 className="font-serif font-bold text-sm leading-tight truncate">{name}</h3>
          </Link>
          <p className="text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
            {cuisine}{price ? ` · ${price}` : ''}
          </p>
          {notes && (
            <p className="text-xs text-on-surface/40 mt-1 line-clamp-2 italic">&ldquo;{notes}&rdquo;</p>
          )}
        </div>
        {onRemove && (
          <div className="flex justify-end mt-1.5 pt-1.5 border-t border-on-surface/5">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
              className="text-[10px] font-bold text-red-400 uppercase tracking-wider hover:text-red-500"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Grid card for desktop grid view ── */
const RestaurantGridCard: React.FC<{
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  score?: number;
  onEdit?: () => void;
  onRemove?: () => void;
}> = ({ restaurantId, name, image, cuisine, price, score, onEdit, onRemove }) => {
  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden relative">
      <Link to={`/restaurant/${restaurantId}`} className="block aspect-[4/3] overflow-hidden">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-3xl font-serif font-bold">
            {name.charAt(0)}
          </div>
        )}
      </Link>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/restaurant/${restaurantId}`} className="min-w-0 flex-1">
            <h3 className="font-serif font-bold text-sm leading-tight truncate">{name}</h3>
          </Link>
          <div className="flex items-center gap-1 flex-shrink-0">
            {score !== undefined && score > 0 && (
              <span className={cn("text-base font-serif font-bold", scoreColor(score))}>{score.toFixed(1)}</span>
            )}
            {onEdit && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                className="p-1 text-on-surface/30 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"><Edit3 size={12} /></button>
            )}
            {onRemove && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }}
                className="p-1 text-on-surface/20 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={12} /></button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
          {cuisine}{price ? ` · ${price}` : ''}
        </p>
      </div>
      {confirmDelete && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-2 border border-red-200 p-3">
          <p className="text-xs text-on-surface/60 font-medium text-center">Delete this restaurant?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-on-surface/5">Cancel</button>
            <button onClick={() => { if (onRemove) onRemove(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── View mode toggle (desktop only) ── */
const ViewModeToggle: React.FC<{ mode: 'list' | 'grid'; onChange: (m: 'list' | 'grid') => void }> = ({ mode, onChange }) => {
  const { phoneMode } = useSettings();
  if (phoneMode) return null;
  return (
    <div className="flex items-center gap-1 bg-on-surface/5 rounded-lg p-0.5">
      <button onClick={() => onChange('list')} className={cn("p-1.5 rounded-md transition-all", mode === 'list' ? "bg-white shadow-sm text-primary" : "text-on-surface/30 hover:text-on-surface/50")}>
        <List size={15} />
      </button>
      <button onClick={() => onChange('grid')} className={cn("p-1.5 rounded-md transition-all", mode === 'grid' ? "bg-white shadow-sm text-primary" : "text-on-surface/30 hover:text-on-surface/50")}>
        <LayoutGrid size={15} />
      </button>
    </div>
  );
};

/* ── Add Hotel Breakfast Modal ── */
const AddHotelBreakfastModal: React.FC<{
  open: boolean;
  onClose: () => void;
  listId: string;
}> = ({ open, onClose, listId }) => {
  const { rateRestaurant, getRating, addToList, cacheRestaurantMeta } = useLists();
  const { user } = useAuth();
  const [step, setStep] = useState<'search' | 'rate'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedHotel, setSelectedHotel] = useState<PlaceResult | null>(null);

  // Rating state
  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStep('search');
      setQuery('');
      setResults([]);
      setSelectedHotel(null);
      setScore(7);
      setNotes('');
      setVisitDate(new Date().toISOString().slice(0, 10));
      setWouldReturn(true);
      setSelectedTags([]);
      setPhotos([]);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      // Use user's location if available, fallback to NYC
      const lat = 40.735; const lng = -73.99;
      const res = await searchHotels(query, lat, lng);
      setResults(res);
    } catch (e) {
      console.error('Hotel search failed:', e);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectHotel = (hotel: PlaceResult) => {
    setSelectedHotel(hotel);
    const existing = getRating(hotel.id);
    if (existing) {
      setScore(existing.score);
      setNotes(existing.notes);
      setVisitDate(existing.visitDate || '');
      setWouldReturn(existing.wouldReturn);
      setSelectedTags(existing.tags || []);
      setPhotos(existing.photos || []);
    }
    setStep('rate');
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = document.createElement('img');
        img.onload = () => {
          const max = 800;
          let w = img.width, h = img.height;
          if (w > max || h > max) { const r = Math.min(max / w, max / h); w *= r; h *= r; }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.6));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newPhotos: PhotoItem[] = [];
    for (const file of files.slice(0, 8 - photos.length)) {
      try {
        const compressed = await compressImage(file);
        newPhotos.push({ url: compressed, caption: '', isFavorite: false });
      } catch {}
    }
    setPhotos((prev) => [...prev, ...newPhotos]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = () => {
    if (!selectedHotel) return;
    const rating = {
      restaurantId: selectedHotel.id,
      name: selectedHotel.name,
      image: selectedHotel.photoUrl || '',
      cuisine: 'Hotel Breakfast',
      price: '',
      address: selectedHotel.address || selectedHotel.fullAddress || '',
      score,
      notes,
      visitDate,
      wouldReturn,
      tags: selectedTags,
      photos,
      listIds: [listId],
      friendIds: [],
    };
    rateRestaurant(rating);
    addToList(listId, selectedHotel.id);
    cacheRestaurantMeta({ id: selectedHotel.id, name: selectedHotel.name, image: selectedHotel.photoUrl || '', cuisine: 'Hotel Breakfast', price: '', address: selectedHotel.address || '' });
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-surface flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-3 flex-shrink-0">
            {step === 'rate' && (
              <button onClick={() => setStep('search')} className="p-1.5 rounded-full hover:bg-on-surface/5">
                <ArrowLeft size={20} className="text-on-surface/60" />
              </button>
            )}
            <div className="flex-1">
              <h2 className="text-lg font-serif font-bold">{step === 'search' ? 'Find a Hotel' : selectedHotel?.name}</h2>
              <p className="text-[11px] text-on-surface/40">{step === 'search' ? 'Search for the hotel you stayed at' : 'Rate the breakfast'}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-on-surface/5">
              <X size={22} className="text-on-surface/50" />
            </button>
          </div>

          {step === 'search' ? (
            <div className="flex-1 overflow-y-auto px-5 pb-8">
              {/* Search input */}
              <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Hotel name or location..."
                    autoFocus
                    className="w-full pl-9 pr-4 py-3 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button type="submit" disabled={searching || !query.trim()}
                  className="px-4 py-3 bg-primary text-white rounded-xl text-sm font-bold disabled:opacity-40">
                  {searching ? '...' : 'Search'}
                </button>
              </form>

              {/* Results */}
              <div className="space-y-2">
                {results.map((hotel) => (
                  <button key={hotel.id} onClick={() => handleSelectHotel(hotel)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white border border-on-surface/5 shadow-sm hover:shadow-md transition-all text-left">
                    {hotel.photoUrl ? (
                      <img src={hotel.photoUrl} alt={hotel.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-on-surface/5 flex items-center justify-center flex-shrink-0 text-xl">🏨</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{hotel.name}</p>
                      <p className="text-[11px] text-on-surface/40 truncate">{hotel.address}</p>
                      {hotel.rating > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Star size={11} className="text-amber-500 fill-amber-500" />
                          <span className="text-[10px] text-on-surface/50">{hotel.rating}</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight size={16} className="text-on-surface/20 flex-shrink-0" />
                  </button>
                ))}
                {results.length === 0 && query && !searching && (
                  <p className="text-center text-sm text-on-surface/40 py-8">No hotels found. Try a different search.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-5 pb-8">
              {/* Hotel photo */}
              {selectedHotel?.photoUrl && (
                <div className="rounded-2xl overflow-hidden aspect-[16/9] mb-5">
                  <img src={selectedHotel.photoUrl} alt={selectedHotel.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
              )}

              {/* Score */}
              <div className="mb-6">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-3 block">Breakfast Rating</label>
                <div className="flex items-center gap-4">
                  <input type="range" min={0} max={10} step={0.5} value={score}
                    onChange={(e) => setScore(parseFloat(e.target.value))}
                    className="flex-1 accent-primary h-2" />
                  <span className="text-2xl font-serif font-bold text-primary w-12 text-center">{score}</span>
                </div>
              </div>

              {/* Visit date */}
              <div className="mb-5">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Visit Date</label>
                <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>

              {/* Would return */}
              <div className="mb-5">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Would you eat breakfast here again?</label>
                <div className="flex gap-2">
                  {[true, false].map((val) => (
                    <button key={String(val)} onClick={() => setWouldReturn(val)}
                      className={cn("flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors",
                        wouldReturn === val ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>
                      {val ? '👍 Yes' : '👎 No'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="mb-5">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="How was the breakfast? What did you have?"
                  rows={3}
                  className="w-full px-4 py-2.5 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
              </div>

              {/* Tags */}
              <div className="mb-5">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Tags</label>
                <div className="flex flex-wrap gap-1.5">
                  {['Buffet', 'Continental', 'Full English', 'Room Service', 'Restaurant', 'Rooftop', 'Pool Side', 'Included', 'Extra Charge', 'Fresh Juice', 'Coffee', 'Pastries', 'Made to Order', 'Vegan Options'].map((tag) => (
                    <button key={tag} onClick={() => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                        selectedTags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photos */}
              <div className="mb-6">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Photos</label>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAddPhotos} />
                <div className="flex gap-2 flex-wrap">
                  {photos.map((p, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden">
                      <img src={p.url} className="w-full h-full object-cover" />
                      <button onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center">
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 8 && (
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-20 h-20 rounded-xl border-2 border-dashed border-on-surface/15 flex items-center justify-center hover:border-primary/30 transition-colors">
                      <Plus size={20} className="text-on-surface/30" />
                    </button>
                  )}
                </div>
              </div>

              {/* Save button */}
              <button onClick={handleSave}
                className="w-full py-3.5 bg-primary text-white rounded-2xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity">
                Save Hotel Breakfast
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ── List Detail View ── */
const ListDetailView: React.FC<{
  list: CustomList;
  viewMode: 'list' | 'grid';
  onViewModeChange: (m: 'list' | 'grid') => void;
  onBack: () => void;
}> = ({ list, viewMode, onViewModeChange, onBack }) => {
  const { ratings, getRestaurantInfo, removeFromList, removeFromWishlistInList, openAddRestaurantModal, deleteList, wishlist, removeFromWishlist, rateRestaurant, addToList } = useLists();
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [hotelModalOpen, setHotelModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteList, setConfirmDeleteList] = useState(false);

  const isWishlistView = list.id === '__wishlist__';
  const isHotelBreakfast = list.type === 'hotel-breakfast';

  const ratedRestaurants = list.restaurantIds.map((id) => {
    const info = getRestaurantInfo(id);
    const rating = ratings.find((r) => r.restaurantId === id);
    return { id, info, rating };
  }).filter(({ info }) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return info?.name.toLowerCase().includes(q) || info?.cuisine.toLowerCase().includes(q) || info?.address.toLowerCase().includes(q);
  });

  const wishlistedRestaurants = (list.wishlistIds || []).map((id) => {
    const info = getRestaurantInfo(id);
    const wishItem = wishlist.find((w) => w.restaurantId === id);
    return { id, info, wishItem };
  }).filter(({ info }) => info); // only show if we have metadata

  const totalCount = list.restaurantIds.length + (list.wishlistIds?.length || 0);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
          <ArrowLeft size={20} />
        </button>
        <span className="text-2xl">{list.emoji}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif font-bold text-xl">{list.name}</h2>
          <p className="text-xs text-on-surface/40">
            {totalCount} restaurant{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setSearchOpen(!searchOpen)}
          className={cn("p-2 rounded-full transition-colors", searchOpen ? "text-primary bg-primary/10" : "text-on-surface/40 hover:text-on-surface")}>
          <Search size={18} />
        </button>
        {!isWishlistView && (
          <button onClick={() => isHotelBreakfast ? setHotelModalOpen(true) : setAddSheetOpen(true)}
            className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors" title={isHotelBreakfast ? "Add hotel" : "Add restaurants"}>
            <Plus size={20} />
          </button>
        )}
        {!isWishlistView && (
          <button onClick={() => setConfirmDeleteList(true)}
            className="p-2 text-red-400 hover:text-red-500 transition-colors">
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Search bar */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search restaurants..."
                autoFocus className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-9 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30"><X size={14} /></button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete list confirmation */}
      <AnimatePresence>
        {confirmDeleteList && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-600 font-medium">Delete "{list.name}" list?</p>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => setConfirmDeleteList(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                <button onClick={() => { deleteList(list.id); onBack(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* View mode toggle for desktop */}
      {totalCount > 0 && (
        <div className="flex justify-end mb-3">
          <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />
        </div>
      )}

      {totalCount === 0 ? (
        <div className="text-center py-16">
          <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">This list is empty</p>
          <p className="text-xs text-on-surface/30 mt-1">Add restaurants from your rated collection</p>
          <button onClick={() => setAddSheetOpen(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            <Plus size={14} />Add Restaurants
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Rated section */}
          {ratedRestaurants.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Star size={14} className="text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Rated ({ratedRestaurants.length})</h3>
              </div>
              <div className={viewMode === 'grid' ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "space-y-3"}>
                {ratedRestaurants.map(({ id, info, rating }) => viewMode === 'grid' ? (
                  <RestaurantGridCard
                    key={id}
                    restaurantId={id}
                    name={info?.name ?? id}
                    image={info?.image ?? ''}
                    cuisine={info?.cuisine ?? ''}
                    price={info?.price ?? ''}
                    score={rating?.score}
                    onEdit={info ? () => openAddRestaurantModal({ id, name: info.name, image: info.image, cuisine: info.cuisine, price: info.price, address: info.address }) : undefined}
                    onRemove={() => removeFromList(list.id, id)}
                  />
                ) : (
                  <RestaurantRow
                    key={id}
                    restaurantId={id}
                    name={info?.name ?? id}
                    image={info?.image ?? ''}
                    cuisine={info?.cuisine ?? ''}
                    price={info?.price ?? ''}
                    address={info?.address ?? ''}
                    score={rating?.score}
                    tags={rating?.tags}
                    notes={rating?.notes}
                    visitDate={rating?.visitDate}
                    wouldReturn={rating?.wouldReturn}
                    onEdit={info ? () => openAddRestaurantModal({ id, name: info.name, image: info.image, cuisine: info.cuisine, price: info.price, address: info.address }) : undefined}
                    onRemove={() => removeFromList(list.id, id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Wishlist section */}
          {wishlistedRestaurants.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Heart size={14} className="text-red-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Wishlist ({wishlistedRestaurants.length})</h3>
              </div>
              <div className="space-y-3">
                {wishlistedRestaurants.map(({ id, info, wishItem }) => (
                  <WishlistRow
                    key={id}
                    restaurantId={id}
                    name={info?.name ?? id}
                    image={info?.image ?? ''}
                    cuisine={info?.cuisine ?? ''}
                    price={info?.price ?? ''}
                    notes={wishItem?.notes}
                    onRemove={() => isWishlistView ? removeFromWishlist(id) : removeFromWishlistInList(list.id, id)}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Add more button */}
          <button onClick={() => setAddSheetOpen(true)}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
            <Plus size={16} /><span className="text-sm font-semibold">Add Restaurants</span>
          </button>
        </div>
      )}

      <AddFromRatedSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} listId={list.id} listRestaurantIds={list.restaurantIds} />
      <AddHotelBreakfastModal open={hotelModalOpen} onClose={() => setHotelModalOpen(false)} listId={list.id} />
    </div>
  );
};

/* ── Full Filter Sheet ── */
const FilterSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  sortBy: string;
  onSortBy: (v: any) => void;
  scoreRange: [number, number];
  onScoreRange: (r: [number, number]) => void;
  cityFilter: string[];
  onCityFilter: (v: string[]) => void;
  cuisineFilter: string[];
  onCuisineFilter: (v: string[]) => void;
  priceFilter: string | null;
  onPriceFilter: (v: string | null) => void;
  allCities: string[];
  allCuisines: string[];
  onReset: () => void;
}> = ({ open, onClose, sortBy, onSortBy, scoreRange, onScoreRange, cityFilter, onCityFilter, cuisineFilter, onCuisineFilter, priceFilter, onPriceFilter, allCities, allCuisines, onReset }) => {
  const { phoneMode } = useSettings();
  const [citySearch, setCitySearch] = useState('');
  const [cuisineSearch, setCuisineSearch] = useState('');
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);

  const filteredCities = citySearch.trim() ? allCities.filter((c) => c.toLowerCase().includes(citySearch.toLowerCase())) : allCities;
  const filteredCuisines = cuisineSearch.trim() ? allCuisines.filter((c) => c.toLowerCase().includes(cuisineSearch.toLowerCase())) : allCuisines;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag={phoneMode ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_: any, info: any) => { if (info.offset.y > 80 || info.velocity.y > 300) onClose(); }}
            className={cn("fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl flex flex-col overflow-hidden",
              phoneMode ? "h-[92vh]" : "max-h-[75vh]")}
          >
            {/* Drag handle */}
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">Filters</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Sort */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Sort by</p>
                <div className="flex flex-wrap gap-2">
                  {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['added', 'Date Added']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => onSortBy(key)}
                      className={cn("px-3.5 py-2 rounded-full text-xs font-semibold transition-all",
                        sortBy === key ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/50 hover:bg-on-surface/10")}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Score range — single track with two thumbs via stacked inputs */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">
                  Score: {scoreRange[0]} – {scoreRange[1]}
                </p>
                <div className="relative h-6 flex items-center">
                  <div className="absolute inset-x-0 h-1 bg-on-surface/10 rounded-full" />
                  <div className="absolute h-1 bg-primary rounded-full" style={{ left: `${scoreRange[0] * 10}%`, right: `${100 - scoreRange[1] * 10}%` }} />
                  <input type="range" min={0} max={10} step={1} value={scoreRange[0]}
                    onChange={(e) => onScoreRange([Math.min(+e.target.value, scoreRange[1]), scoreRange[1]])}
                    className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer" />
                  <input type="range" min={0} max={10} step={1} value={scoreRange[1]}
                    onChange={(e) => onScoreRange([scoreRange[0], Math.max(+e.target.value, scoreRange[0])])}
                    className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer" />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-on-surface/30">0</span>
                  <span className="text-[10px] text-on-surface/30">10</span>
                </div>
              </div>

              {/* Price */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Price</p>
                <div className="flex gap-2">
                  {['$', '$$', '$$$', '$$$$'].map((p) => (
                    <button key={p} onClick={() => onPriceFilter(priceFilter === p ? null : p)}
                      className={cn("flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2",
                        priceFilter === p ? "border-primary bg-primary/5 text-primary" : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20")}>{p}</button>
                  ))}
                </div>
              </div>

              {/* Cuisine — collapsible dropdown */}
              <div>
                <button onClick={() => setCuisineOpen(!cuisineOpen)}
                  className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Cuisine</p>
                    {cuisineFilter.length > 0 && <span className="text-[10px] font-semibold text-primary">{cuisineFilter.join(", ")}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {cuisineFilter.length > 0 && <button onClick={(e) => { e.stopPropagation(); onCuisineFilter([]); }} className="text-[10px] text-primary font-semibold">Clear</button>}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", cuisineOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence>
                  {cuisineOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input type="text" value={cuisineSearch} onChange={(e) => setCuisineSearch(e.target.value)} placeholder="Search cuisines..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filteredCuisines.map((c) => (
                          <button key={c} onClick={() => onCuisineFilter(cuisineFilter.includes(c) ? cuisineFilter.filter((x) => x !== c) : [...cuisineFilter, c])}
                            className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                              cuisineFilter.includes(c) ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20")}>{c}</button>
                        ))}
                        {filteredCuisines.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No cuisines match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* City — collapsible dropdown */}
              <div>
                <button onClick={() => setCityOpen(!cityOpen)}
                  className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">City / Location</p>
                    {cityFilter.length > 0 && <span className="text-[10px] font-semibold text-primary">{cityFilter.join(", ")}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {cityFilter.length > 0 && <button onClick={(e) => { e.stopPropagation(); onCityFilter([]); }} className="text-[10px] text-primary font-semibold">Clear</button>}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", cityOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence>
                  {cityOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input type="text" value={citySearch} onChange={(e) => setCitySearch(e.target.value)} placeholder="Search locations..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filteredCities.map((c) => (
                          <button key={c} onClick={() => onCityFilter(cityFilter.includes(c) ? cityFilter.filter((x) => x !== c) : [...cityFilter, c])}
                            className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                              cityFilter.includes(c) ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20")}>{c}</button>
                        ))}
                        {filteredCities.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No locations match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-on-surface/6 px-5 py-4 flex gap-3">
              <button onClick={onReset}
                className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-muted transition-colors">Reset</button>
              <button onClick={onClose}
                className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-lg shadow-primary/25">Apply</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── Main Page ── */
type PantryTab = 'lists' | 'trips' | 'wishlist';

/* ── Helper: format date range ── */
function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (s.getFullYear() !== e.getFullYear()) return `${s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}, ${s.getFullYear()}`;
}

function getNightCount(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000));
}

function getNightDate(startDate: string, nightIndex: number): string {
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + nightIndex);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

const MEAL_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, drinks: 2, dinner: 3, snack: 4 };
const MEAL_COLORS: Record<string, string> = {
  breakfast: 'bg-amber-100 text-amber-700', lunch: 'bg-blue-100 text-blue-700',
  dinner: 'bg-purple-100 text-purple-700', drinks: 'bg-pink-100 text-pink-700', snack: 'bg-green-100 text-green-700',
};

/* ── Trips Tab ── */
const TripsTab: React.FC<{
  trips: Trip[];
  createTrip: (trip: Omit<Trip, 'id' | 'createdAt'>) => Trip;
  updateTrip: (id: string, updates: Partial<Trip>) => void;
  deleteTrip: (id: string) => void;
  addRestaurantToTrip: (tripId: string, restaurant: TripRestaurant) => void;
  updateTripRestaurant: (tripId: string, restaurantId: string, night: number, updates: Partial<TripRestaurant>) => void;
  removeRestaurantFromTrip: (tripId: string, restaurantId: string, night: number) => void;
  addHotelToTrip: (tripId: string, hotel: TripHotel) => void;
  updateHotel: (tripId: string, hotelId: string, updates: Partial<TripHotel>) => void;
  removeHotelFromTrip: (tripId: string, hotelId: string) => void;
  rateRestaurant: (rating: RestaurantRating) => void;
  openAddRestaurantModal: (restaurant: RestaurantMeta, initialPage?: string) => void;
  cacheRestaurantMeta: (meta: RestaurantMeta) => void;
  ratings: RestaurantRating[];
  onBack: () => void;
}> = ({ trips, createTrip, updateTrip, deleteTrip, addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip, addHotelToTrip, updateHotel, removeHotelFromTrip, rateRestaurant, openAddRestaurantModal, cacheRestaurantMeta, ratings, onBack }) => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);

  const selectedTrip = trips.find((t) => t.id === selectedTripId) || null;

  // Sort: active first, then upcoming by start date, then completed most-recent-first
  const sortedTrips = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    return [...trips].sort((a, b) => {
      const aActive = a.status === 'active' ? 0 : a.startDate > now ? 1 : 2;
      const bActive = b.status === 'active' ? 0 : b.startDate > now ? 1 : 2;
      if (aActive !== bActive) return aActive - bActive;
      if (aActive === 2) return b.startDate.localeCompare(a.startDate); // completed: most recent first
      return a.startDate.localeCompare(b.startDate); // upcoming: soonest first
    });
  }, [trips]);

  if (selectedTrip) {
    const nights = getNightCount(selectedTrip.startDate, selectedTrip.endDate);
    const completedCount = selectedTrip.restaurants.filter((r) => r.status === 'completed').length;
    const avgRating = completedCount > 0
      ? (selectedTrip.restaurants.filter((r) => r.status === 'completed' && r.rating).reduce((sum, r) => sum + (r.rating?.score || 0), 0) / completedCount).toFixed(1)
      : '—';

    // Check for tonight's reminder
    const today = new Date();
    const tripStart = new Date(selectedTrip.startDate + 'T00:00:00');
    const currentNight = Math.floor((today.getTime() - tripStart.getTime()) / 86400000);
    const tonightDinner = selectedTrip.restaurants.find((r) => r.night === currentNight && r.mealType === 'dinner' && r.status === 'planned');

    return (
      <div>
        {/* Header with cover */}
        <div className="relative -mx-3 mb-4">
          {selectedTrip.coverImage ? (
            <div className="relative aspect-[16/9] rounded-2xl overflow-hidden mx-3">
              <img src={selectedTrip.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h2 className="font-serif font-bold text-xl text-white">{selectedTrip.name}</h2>
                <p className="text-white/70 text-xs">{selectedTrip.destination} · {formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}</p>
              </div>
              <div className="absolute top-3 left-3">
                <button onClick={() => setSelectedTripId(null)} className="p-2 bg-black/30 backdrop-blur-sm rounded-full text-white">
                  <ArrowLeft size={18} />
                </button>
              </div>
              <div className="absolute top-3 right-3 flex gap-2">
                <button onClick={() => setEditingTrip(selectedTrip)} className="p-2 bg-black/30 backdrop-blur-sm rounded-full text-white">
                  <Edit3 size={15} />
                </button>
                <button onClick={() => { if (confirm('Delete this trip?')) { deleteTrip(selectedTrip.id); setSelectedTripId(null); } }}
                  className="p-2 bg-black/30 backdrop-blur-sm rounded-full text-white">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3 mb-2">
              <button onClick={() => setSelectedTripId(null)} className="p-1.5 rounded-full hover:bg-on-surface/5">
                <ArrowLeft size={20} />
              </button>
              <div className="flex-1">
                <h2 className="font-serif font-bold text-xl">{selectedTrip.name}</h2>
                <p className="text-xs text-on-surface/40">{selectedTrip.destination} · {formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}</p>
              </div>
              <button onClick={() => setEditingTrip(selectedTrip)} className="p-2 hover:bg-on-surface/5 rounded-full">
                <Edit3 size={16} className="text-on-surface/40" />
              </button>
              <button onClick={() => { if (confirm('Delete this trip?')) { deleteTrip(selectedTrip.id); setSelectedTripId(null); } }}
                className="p-2 hover:bg-on-surface/5 rounded-full text-red-400">
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 mb-4">
          <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
            selectedTrip.status === 'active' ? "bg-green-100 text-green-700" :
            selectedTrip.status === 'completed' ? "bg-on-surface/5 text-on-surface/40" :
            "bg-primary/10 text-primary"
          )}>{selectedTrip.status}</span>
          <span className="text-[11px] text-on-surface/40">{nights} night{nights !== 1 ? 's' : ''} · {selectedTrip.restaurants.length} restaurant{selectedTrip.restaurants.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Tonight reminder */}
        {tonightDinner && selectedTrip.status === 'active' && (
          <div className="bg-primary/5 border border-primary/15 rounded-2xl p-3 mb-4 flex items-center gap-3">
            <span className="text-lg">🍽️</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-primary">Tonight's Dinner</p>
              <p className="text-sm font-semibold text-on-surface truncate">{tonightDinner.name}</p>
              {tonightDinner.reservationTime && <p className="text-[11px] text-on-surface/50">Reservation at {tonightDinner.reservationTime}</p>}
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {[
            { label: 'Planned', value: selectedTrip.restaurants.filter((r) => r.status === 'planned').length },
            { label: 'Completed', value: completedCount },
            { label: 'Avg Rating', value: avgRating },
            { label: 'Nights', value: nights },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-on-surface/5 p-2.5 text-center">
              <p className="text-lg font-serif font-bold text-on-surface">{s.value}</p>
              <p className="text-[9px] text-on-surface/40 font-medium uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Hotels */}
        {selectedTrip.hotels.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2">Hotels</h3>
            {selectedTrip.hotels.map((hotel) => (
              <div key={hotel.id} className="bg-white rounded-2xl border border-on-surface/5 p-3 mb-2 flex items-center gap-3">
                {hotel.image ? (
                  <img src={hotel.image} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0 text-lg">🏨</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{hotel.name}</p>
                  <p className="text-[10px] text-on-surface/40">{hotel.checkIn} → {hotel.checkOut}</p>
                  {hotel.confirmationNumber && <p className="text-[10px] text-on-surface/30">#{hotel.confirmationNumber}</p>}
                </div>
                {hotel.starRating && (
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: hotel.starRating }).map((_, i) => (
                      <Star key={i} size={10} className="text-amber-500 fill-amber-500" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Night-by-night itinerary */}
        <div className="space-y-4 mb-6">
          {Array.from({ length: nights }).map((_, nightIdx) => {
            const nightRestaurants = selectedTrip.restaurants
              .filter((r) => r.night === nightIdx)
              .sort((a, b) => (MEAL_ORDER[a.mealType] || 0) - (MEAL_ORDER[b.mealType] || 0));

            return (
              <div key={nightIdx}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="text-sm font-serif font-bold">Night {nightIdx + 1}</h4>
                    <p className="text-[10px] text-on-surface/40">{getNightDate(selectedTrip.startDate, nightIdx)}</p>
                  </div>
                  <button
                    onClick={() => {
                      // Quick add: open a prompt for restaurant search
                      const name = prompt('Restaurant name to add:');
                      if (name) {
                        const mealType = prompt('Meal type (breakfast/lunch/dinner/drinks/snack):') as TripRestaurant['mealType'] || 'dinner';
                        addRestaurantToTrip(selectedTrip.id, {
                          restaurantId: `manual-${Date.now()}`,
                          name,
                          image: '',
                          cuisine: '',
                          price: '',
                          address: '',
                          night: nightIdx,
                          mealType,
                          status: 'planned',
                        });
                      }
                    }}
                    className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {nightRestaurants.length === 0 ? (
                  <p className="text-xs text-on-surface/25 italic pl-2">No restaurants planned</p>
                ) : (
                  <div className="space-y-2">
                    {nightRestaurants.map((r) => (
                      <div key={`${r.restaurantId}-${r.night}`}
                        className={cn("flex items-center gap-3 p-2.5 rounded-2xl bg-white border border-on-surface/5 shadow-sm transition-all",
                          r.status === 'skipped' && "opacity-50")}
                      >
                        {r.image ? (
                          <img src={r.image} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-on-surface/5 flex items-center justify-center flex-shrink-0 text-lg">🍽️</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={cn("font-semibold text-sm truncate", r.status === 'skipped' && "line-through")}>{r.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase", MEAL_COLORS[r.mealType] || 'bg-gray-100 text-gray-600')}>{r.mealType}</span>
                            {r.reservationTime && <span className="text-[10px] text-on-surface/40">{r.reservationTime}</span>}
                          </div>
                          {r.cuisine && <p className="text-[10px] text-on-surface/30 mt-0.5">{r.cuisine} {r.price && `· ${r.price}`}</p>}
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          {r.status === 'planned' && (
                            <button onClick={() => updateTripRestaurant(selectedTrip.id, r.restaurantId, r.night, { status: 'completed' })}
                              className="w-7 h-7 rounded-full bg-green-50 flex items-center justify-center text-green-600 hover:bg-green-100">
                              <Check size={13} />
                            </button>
                          )}
                          {r.status === 'completed' && (
                            <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                              <Check size={13} className="text-green-600" />
                            </div>
                          )}
                          <button onClick={() => removeRestaurantFromTrip(selectedTrip.id, r.restaurantId, r.night)}
                            className="w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center text-on-surface/20 hover:text-red-400">
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Share itinerary */}
        <button
          onClick={() => {
            const nights = getNightCount(selectedTrip.startDate, selectedTrip.endDate);
            let text = `🗺️ ${selectedTrip.name} — ${selectedTrip.destination}\n${formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}\n\n`;
            for (let i = 0; i < nights; i++) {
              const nightRests = selectedTrip.restaurants.filter((r) => r.night === i).sort((a, b) => (MEAL_ORDER[a.mealType] || 0) - (MEAL_ORDER[b.mealType] || 0));
              if (nightRests.length === 0) continue;
              text += `Night ${i + 1} — ${getNightDate(selectedTrip.startDate, i)}\n`;
              nightRests.forEach((r) => {
                text += `  ${r.mealType}: ${r.name}${r.reservationTime ? ` (${r.reservationTime})` : ''}\n`;
              });
              text += '\n';
            }
            if (navigator.share) navigator.share({ text });
            else { navigator.clipboard.writeText(text); alert('Itinerary copied to clipboard!'); }
          }}
          className="w-full py-3 bg-on-surface/5 rounded-2xl text-sm font-semibold text-on-surface/50 hover:bg-on-surface/10 transition-colors mb-4"
        >
          📋 Share Itinerary
        </button>
      </div>
    );
  }

  // ── Index view ──
  return (
    <div className="relative">
      {/* Back to lists */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 rounded-full hover:bg-on-surface/5">
          <ArrowLeft size={20} />
        </button>
        <h2 className="font-serif font-bold text-xl">Trips</h2>
      </div>

      {sortedTrips.length === 0 ? (
        <div className="text-center py-16">
          <Plane size={48} className="text-on-surface/10 mx-auto mb-4" />
          <h3 className="font-serif font-bold text-lg text-on-surface/60 mb-1">Plan Your First Trip</h3>
          <p className="text-sm text-on-surface/30 mb-6 max-w-[240px] mx-auto">Organize restaurants by night, track hotels, and share your itinerary</p>
          <button onClick={() => setCreateOpen(true)}
            className="px-6 py-3 bg-primary text-white rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity">
            <Plus size={16} className="inline mr-2 -mt-0.5" />Create Trip
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedTrips.map((trip) => {
            const nights = getNightCount(trip.startDate, trip.endDate);
            return (
              <button key={trip.id} onClick={() => setSelectedTripId(trip.id)}
                className="w-full text-left rounded-2xl overflow-hidden shadow-sm border border-on-surface/5 hover:shadow-md transition-all bg-white">
                <div className="relative aspect-[16/9]">
                  {trip.coverImage ? (
                    <img src={trip.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
                      <Plane size={32} className="text-primary/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="font-serif font-bold text-lg text-white leading-tight">{trip.name}</h3>
                    <p className="text-white/70 text-xs">{trip.destination}</p>
                  </div>
                  <div className="absolute top-3 right-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase backdrop-blur-sm",
                      trip.status === 'active' ? "bg-green-500/80 text-white" :
                      trip.status === 'completed' ? "bg-white/30 text-white" :
                      "bg-primary/80 text-white"
                    )}>{trip.status}</span>
                  </div>
                </div>
                <div className="px-4 py-2.5 flex items-center gap-3 text-[11px] text-on-surface/40">
                  <span>{formatDateRange(trip.startDate, trip.endDate)}</span>
                  <span>·</span>
                  <span>{nights} night{nights !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{trip.restaurants.length} restaurant{trip.restaurants.length !== 1 ? 's' : ''}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* FAB */}
      {sortedTrips.length > 0 && (
        <button onClick={() => setCreateOpen(true)}
          className="fixed bottom-24 right-6 z-40 w-14 h-14 bg-primary text-white rounded-full shadow-xl shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform">
          <Plane size={22} />
        </button>
      )}

      {/* Create Trip Sheet */}
      <CreateTripSheet
        open={createOpen || !!editingTrip}
        trip={editingTrip}
        onClose={() => { setCreateOpen(false); setEditingTrip(null); }}
        onSave={(data) => {
          if (editingTrip) {
            updateTrip(editingTrip.id, data);
          } else {
            const created = createTrip(data);
            setSelectedTripId(created.id);
          }
          setCreateOpen(false);
          setEditingTrip(null);
        }}
      />
    </div>
  );
};

/* ── Create / Edit Trip Sheet ── */
const CreateTripSheet: React.FC<{
  open: boolean;
  trip: Trip | null;
  onClose: () => void;
  onSave: (data: Omit<Trip, 'id' | 'createdAt'>) => void;
}> = ({ open, trip, onClose, onSave }) => {
  const { phoneMode } = useSettings();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [destLat, setDestLat] = useState(0);
  const [destLng, setDestLng] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [status, setStatus] = useState<Trip['status']>('planning');

  // Location search
  const [locQuery, setLocQuery] = useState('');
  const [locResults, setLocResults] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const locDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ['pk.eyJ1IjoidGcxMjM0N', 'TYiLCJhIjoiY21kN3g1Z', 'mJ4MG9iaTJpcHY5ajlld', 'XJ4OCJ9.MotLpY7BXT31', '0zCzDNJWwA'].join('');

  useEffect(() => {
    if (open) {
      setName(trip?.name || '');
      setDestination(trip?.destination || '');
      setDestLat(trip?.destinationLat || 0);
      setDestLng(trip?.destinationLng || 0);
      setStartDate(trip?.startDate || '');
      setEndDate(trip?.endDate || '');
      setNotes(trip?.notes || '');
      setCoverImage(trip?.coverImage || '');
      setStatus(trip?.status || 'planning');
      setLocQuery('');
      setLocResults([]);
    }
  }, [open, trip]);

  // Mapbox geocoding with debounce
  useEffect(() => {
    if (locDebounceRef.current) clearTimeout(locDebounceRef.current);
    if (!locQuery.trim()) { setLocResults([]); return; }
    setLocLoading(true);
    locDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locQuery)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality&limit=5`);
        const data = await res.json();
        setLocResults((data.features || []).map((f: any) => ({ id: f.id, name: f.place_name, lat: f.center[1], lng: f.center[0] })));
      } catch { setLocResults([]); }
      finally { setLocLoading(false); }
    }, 300);
    return () => { if (locDebounceRef.current) clearTimeout(locDebounceRef.current); };
  }, [locQuery]);

  // Auto-fetch cover image when destination is set
  useEffect(() => {
    if (!destination || coverImage || !destLat) return;
    (async () => {
      try {
        const { searchPlacesByText } = await import('../lib/places');
        const results = await searchPlacesByText(destination, destLat, destLng);
        if (results[0]?.photoUrl) setCoverImage(results[0].photoUrl);
      } catch {}
    })();
  }, [destination, destLat]);

  const handleSave = () => {
    if (!name.trim() || !startDate || !endDate) return;
    onSave({
      name: name.trim(),
      destination: destination || name,
      destinationLat: destLat,
      destinationLng: destLng,
      startDate,
      endDate,
      coverImage: coverImage || undefined,
      hotels: trip?.hotels || [],
      restaurants: trip?.restaurants || [],
      notes: notes || undefined,
      status,
    });
  };

  const nightCount = startDate && endDate ? getNightCount(startDate, endDate) : 0;

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center", phoneMode ? "items-end" : "items-end sm:items-center")}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className={cn("bg-surface w-full overflow-hidden flex flex-col",
            phoneMode ? "h-full rounded-none" : "h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl")}
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-shrink-0">
            <h2 className="font-serif font-bold text-lg">{trip ? 'Edit Trip' : 'New Trip'}</h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-on-surface/5">
              <X size={20} className="text-on-surface/50" />
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto px-5 pb-8 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
            {/* Name */}
            <div className="mb-4">
              <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Trip Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer in Italy"
                className="w-full px-4 py-3 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>

            {/* Destination */}
            <div className="mb-4 relative">
              <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Destination</label>
              {destination && !locQuery ? (
                <div className="flex items-center gap-2 px-4 py-3 bg-primary/5 border border-primary/15 rounded-xl">
                  <MapPin size={14} className="text-primary flex-shrink-0" />
                  <span className="text-sm font-medium text-on-surface flex-1 truncate">{destination}</span>
                  <button onClick={() => { setDestination(''); setDestLat(0); setDestLng(0); setCoverImage(''); }}
                    className="text-on-surface/30 hover:text-on-surface/50"><X size={14} /></button>
                </div>
              ) : (
                <input type="text" value={locQuery} onChange={(e) => setLocQuery(e.target.value)} placeholder="Search city or place..."
                  className="w-full px-4 py-3 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              )}
              {locResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-on-surface/8 z-20 max-h-48 overflow-y-auto">
                  {locResults.map((loc) => (
                    <button key={loc.id} onClick={() => { setDestination(loc.name); setDestLat(loc.lat); setDestLng(loc.lng); setLocQuery(''); setLocResults([]); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-on-surface/3 border-b border-on-surface/5 last:border-0">
                      <MapPin size={14} className="text-on-surface/25 flex-shrink-0" />
                      <span className="text-sm font-medium text-on-surface truncate">{loc.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-3 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">End Date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate}
                  className="w-full px-3 py-3 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            {nightCount > 0 && (
              <p className="text-xs text-primary font-semibold mb-4">{nightCount} night{nightCount !== 1 ? 's' : ''}</p>
            )}

            {/* Cover image preview */}
            {coverImage && (
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Cover Image</label>
                <div className="relative rounded-xl overflow-hidden aspect-[16/9]">
                  <img src={coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <button onClick={() => setCoverImage('')}
                    className="absolute top-2 right-2 p-1.5 bg-black/40 rounded-full text-white hover:bg-black/60">
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* Status */}
            {trip && (
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Status</label>
                <div className="flex gap-2">
                  {(['planning', 'active', 'completed'] as Trip['status'][]).map((s) => (
                    <button key={s} onClick={() => setStatus(s)}
                      className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-colors capitalize",
                        status === s ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="mb-6">
              <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Trip notes..."
                rows={3} className="w-full px-4 py-3 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={!name.trim() || !startDate || !endDate}
              className="w-full py-3.5 bg-primary text-white rounded-2xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity disabled:opacity-40">
              {trip ? 'Save Changes' : 'Create Trip'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export const Pantry: React.FC = () => {
  const [selectedList, setSelectedList] = useState<CustomList | null>(null);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [activeTab, setActiveTab] = useState<PantryTab>('lists');
  const [showTrips, setShowTrips] = useState(false);
  const navigate = useNavigate();
  const { phoneMode, setHideBottomNav } = useSettings();

  // On phone, always use list view
  const effectiveViewMode = phoneMode ? 'list' : viewMode;

  // Filters
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [cuisineFilter, setCuisineFilter] = useState<string[]>([]);
  const [priceFilter, setPriceFilter] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'added'>('recent');

  // Quick filter dropdowns
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cuisineDropdownOpen, setCuisineDropdownOpen] = useState(false);
  const [priceDropdownOpen, setPriceDropdownOpen] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  const closeAllDropdowns = () => { setCityDropdownOpen(false); setCuisineDropdownOpen(false); setPriceDropdownOpen(false); setSortDropdownOpen(false); };

  const sortLabels: Record<string, string> = { recent: 'Recent', highest: 'Highest', lowest: 'Lowest', added: 'Date Added' };

  // Main search
  const [mainSearchOpen, setMainSearchOpen] = useState(false);
  const [mainSearchQuery, setMainSearchQuery] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close more menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    };
    if (moreMenuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreMenuOpen]);

  const handleExport = (format: 'csv' | 'json') => {
    const items = filteredRatings.map((r) => ({
      name: r.name, address: r.address, city: (() => { const p = r.address.split(',').map(s => s.trim()); return p.length >= 2 ? p[p.length - 1] : ''; })(),
      cuisine: r.cuisine, rating: r.score, notes: r.notes,
      date_visited: r.visitDate, is_wishlist: false, price_range: r.price.length,
    }));
    // Also add wishlist items
    wishlist.forEach((w) => {
      items.push({
        name: w.name, address: w.address, city: (() => { const p = w.address.split(',').map(s => s.trim()); return p.length >= 2 ? p[p.length - 1] : ''; })(),
        cuisine: w.cuisine, rating: 0, notes: w.notes,
        date_visited: '', is_wishlist: true, price_range: w.price.length,
      });
    });

    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === 'csv') {
      const header = 'name,address,city,cuisine,rating,notes,date_visited,is_wishlist,price_range';
      const rows = items.map((i) => [i.name, i.address, i.city, i.cuisine, i.rating || '', i.notes, i.date_visited, i.is_wishlist, i.price_range].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
      content = [header, ...rows].join('\n');
      mimeType = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(items, null, 2);
      mimeType = 'application/json';
      ext = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-restaurants.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setMoreMenuOpen(false);
  };

  // Hide bottom nav when filter/city/cuisine sheets are open
  useEffect(() => {
    const anyOpen = filtersOpen || cityDropdownOpen || cuisineDropdownOpen || priceDropdownOpen || sortDropdownOpen;
    setHideBottomNav(anyOpen);
    return () => setHideBottomNav(false);
  }, [filtersOpen, cityDropdownOpen, cuisineDropdownOpen, priceDropdownOpen, sortDropdownOpen, setHideBottomNav]);

  const {
    lists, createList,
    ratings, openAddRestaurantModal, removeRating,
    wishlist,
    getListsForRestaurant,
    trips, createTrip, updateTrip, deleteTrip,
    addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip,
    addHotelToTrip, updateHotel, removeHotelFromTrip,
    rateRestaurant, cacheRestaurantMeta, addToList,
  } = useLists();

  const listScrollRef = useRef<HTMLDivElement>(null);

  // Extract unique cities from addresses
  const allCities = useMemo(() => {
    const cities = new Set<string>();
    ratings.forEach((r) => {
      if (r.address) {
        const parts = r.address.split(',').map((s) => s.trim());
        if (parts.length >= 2) cities.add(parts[parts.length - 1]);
        else if (parts.length === 1 && parts[0]) cities.add(parts[0]);
      }
    });
    return Array.from(cities).sort();
  }, [ratings]);

  const allCuisines = useMemo(() => {
    const cuisines = new Set<string>();
    ratings.forEach((r) => { if (r.cuisine) cuisines.add(r.cuisine); });
    return Array.from(cuisines).sort();
  }, [ratings]);

  const allPrices = ['$', '$$', '$$$', '$$$$'];

  // Filter and sort rated restaurants
  const filteredRatings = useMemo(() => {
    let result = [...ratings];

    if (mainSearchQuery.trim()) {
      const q = mainSearchQuery.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
    }
    if (cityFilter.length > 0) {
      result = result.filter((r) => {
        const parts = r.address?.split(',').map((s) => s.trim()) || [];
        return parts.some((p) => cityFilter.includes(p));
      });
    }
    if (cuisineFilter.length > 0) result = result.filter((r) => cuisineFilter.includes(r.cuisine));
    if (priceFilter) result = result.filter((r) => r.price === priceFilter);
    result = result.filter((r) => r.score >= scoreRange[0] && r.score <= scoreRange[1]);

    if (sortBy === 'highest') result.sort((a, b) => b.score - a.score);
    else if (sortBy === 'lowest') result.sort((a, b) => a.score - b.score);
    else if (sortBy === 'added') result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return result;
  }, [ratings, mainSearchQuery, cityFilter, cuisineFilter, priceFilter, scoreRange, sortBy]);

  const activeFilterCount = (cityFilter.length > 0 ? 1 : 0) + (cuisineFilter.length > 0 ? 1 : 0) + (priceFilter ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (sortBy !== 'recent' ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const handleResetFilters = () => {
    setCityFilter([]); setCuisineFilter([]); setPriceFilter(null);
    setScoreRange([0, 10]); setSortBy('recent');
  };

  const toggleCityFilter = (city: string) => setCityFilter((prev) => prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]);
  const toggleCuisineFilter = (cuisine: string) => setCuisineFilter((prev) => prev.includes(cuisine) ? prev.filter((c) => c !== cuisine) : [...prev, cuisine]);

  // Keep selectedList in sync
  const currentList = selectedList
    ? selectedList.id === '__wishlist__'
      ? { ...selectedList, wishlistIds: wishlist.map((w) => w.restaurantId) } as CustomList
      : lists.find((l) => l.id === selectedList.id) ?? null
    : null;

  return (
    <div className="pb-32">
      <TopBar title="My Lists" rightAction={!currentList ? (
        <div className="relative" ref={moreMenuRef}>
          <button onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className="p-2 hover:bg-muted rounded-full transition-colors">
            <MoreHorizontal size={20} />
          </button>
          <AnimatePresence>
            {moreMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                transition={{ type: 'spring', damping: 24, stiffness: 400, mass: 0.5 }}
                className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-on-surface/8 overflow-hidden z-50"
              >
                <button onClick={() => { setMoreMenuOpen(false); navigate('/import'); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/3 transition-colors text-left">
                  <Upload size={16} className="text-on-surface/40" />
                  <span className="text-sm font-medium text-on-surface/70">Import</span>
                </button>
                <button onClick={() => handleExport('csv')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/3 transition-colors text-left border-t border-on-surface/5">
                  <Download size={16} className="text-on-surface/40" />
                  <span className="text-sm font-medium text-on-surface/70">Export CSV</span>
                </button>
                <button onClick={() => handleExport('json')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/3 transition-colors text-left border-t border-on-surface/5">
                  <Download size={16} className="text-on-surface/40" />
                  <span className="text-sm font-medium text-on-surface/70">Export JSON</span>
                </button>
                <button onClick={() => { setMoreMenuOpen(false); setMainSearchOpen(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/3 transition-colors text-left border-t border-on-surface/5">
                  <Search size={16} className="text-on-surface/40" />
                  <span className="text-sm font-medium text-on-surface/70">Search</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : undefined} />

      <main className="px-3">
        {currentList ? (
          <ListDetailView list={currentList} viewMode={effectiveViewMode} onViewModeChange={setViewMode} onBack={() => setSelectedList(null)} />
        ) : showTrips ? (
          <TripsTab
            trips={trips}
            createTrip={createTrip}
            updateTrip={updateTrip}
            deleteTrip={deleteTrip}
            addRestaurantToTrip={addRestaurantToTrip}
            updateTripRestaurant={updateTripRestaurant}
            removeRestaurantFromTrip={removeRestaurantFromTrip}
            addHotelToTrip={addHotelToTrip}
            updateHotel={updateHotel}
            removeHotelFromTrip={removeHotelFromTrip}
            rateRestaurant={rateRestaurant}
            openAddRestaurantModal={openAddRestaurantModal}
            cacheRestaurantMeta={cacheRestaurantMeta}
            ratings={ratings}
            onBack={() => setShowTrips(false)}
          />
        ) : (
          <>
            {/* ── Horizontal list row ── */}
            <div className="mb-4">
              <div
                ref={listScrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-3 px-3"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {/* Wishlist pill — always first, not deletable */}
                <button
                  onClick={() => setSelectedList({ id: '__wishlist__', name: 'Wishlist', emoji: '❤️', restaurantIds: [], wishlistIds: wishlist.map((w) => w.restaurantId), createdAt: 0 } as CustomList)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 rounded-full border border-red-200 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                >
                  <span className="text-sm">❤️</span>
                  <span className="text-xs font-semibold text-red-500 whitespace-nowrap">Wishlist</span>
                  <span className="text-[10px] text-red-400 font-medium">{wishlist.length}</span>
                </button>

                {/* Trips pill */}
                <button
                  onClick={() => setShowTrips(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-primary/5 rounded-full border border-primary/20 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                >
                  <Plane size={13} className="text-primary" />
                  <span className="text-xs font-semibold text-primary whitespace-nowrap">Trips</span>
                  {trips.length > 0 && <span className="text-[10px] text-primary/60 font-medium">{trips.length}</span>}
                </button>

                {lists.map((list) => {
                  const total = list.restaurantIds.length + (list.wishlistIds?.length || 0);
                  return (
                    <button
                      key={list.id}
                      onClick={() => setSelectedList(list)}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-white rounded-full border border-on-surface/10 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                    >
                      <span className="text-sm">{list.emoji}</span>
                      <span className="text-xs font-semibold text-on-surface/70 whitespace-nowrap">{list.name}</span>
                      <span className="text-[10px] text-on-surface/30 font-medium">{total}</span>
                    </button>
                  );
                })}

                {/* Create new list pill */}
                <button
                  onClick={() => setCreateSheetOpen(true)}
                  className="flex items-center gap-1 px-3 py-2 rounded-full border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all flex-shrink-0"
                >
                  <Plus size={14} />
                  <span className="text-xs font-semibold whitespace-nowrap">New List</span>
                </button>
              </div>
            </div>

            {/* ── Filter bar ── */}
            <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              {/* Filters button — always first */}
              <button
                onClick={() => { setFiltersOpen(true); closeAllDropdowns(); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  activeFilterCount > 0
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-on-surface/5 text-on-surface/50 border-transparent"
                )}
              >
                <SlidersHorizontal size={12} />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{activeFilterCount}</span>
                )}
              </button>

              {/* Quick: City → opens full page sheet */}
              <button
                onClick={() => setCityDropdownOpen(true)}
                className={cn("flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  cityFilter.length > 0 ? "bg-primary/10 text-primary border-primary/20" : "bg-on-surface/5 text-on-surface/50 border-transparent")}
              >
                <MapPin size={11} />
                <span>{cityFilter.length > 0 ? `City (${cityFilter.length})` : 'City'}</span>
                {cityFilter.length > 0 ? <span onClick={(e) => { e.stopPropagation(); setCityFilter([]); }} className="ml-0.5"><X size={10} /></span> : <ChevronDown size={10} />}
              </button>

              {/* Quick: Cuisine → opens full page sheet */}
              <button
                onClick={() => setCuisineDropdownOpen(true)}
                className={cn("flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  cuisineFilter.length > 0 ? "bg-primary/10 text-primary border-primary/20" : "bg-on-surface/5 text-on-surface/50 border-transparent")}
              >
                <span>{cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine'}</span>
                {cuisineFilter.length > 0 ? <span onClick={(e) => { e.stopPropagation(); setCuisineFilter([]); }} className="ml-0.5"><X size={10} /></span> : <ChevronDown size={10} />}
              </button>

              {/* Quick: Price → opens small bottom sheet */}
              <button
                onClick={() => setPriceDropdownOpen(true)}
                className={cn("flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  priceFilter ? "bg-primary/10 text-primary border-primary/20" : "bg-on-surface/5 text-on-surface/50 border-transparent")}
              >
                <span>{priceFilter || 'Price'}</span>
                {priceFilter ? <span onClick={(e) => { e.stopPropagation(); setPriceFilter(null); }} className="ml-0.5"><X size={10} /></span> : <ChevronDown size={10} />}
              </button>

              {/* Quick: Sort → opens small bottom sheet */}
              <button
                onClick={() => setSortDropdownOpen(true)}
                className={cn("flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  sortBy !== 'recent' ? "bg-primary/10 text-primary border-primary/20" : "bg-on-surface/5 text-on-surface/50 border-transparent")}
              >
                <ArrowUpDown size={11} />
                <span>{sortBy !== 'recent' ? sortLabels[sortBy] : 'Sort'}</span>
                {sortBy !== 'recent' ? <span onClick={(e) => { e.stopPropagation(); setSortBy('recent'); }} className="ml-0.5"><X size={10} /></span> : <ChevronDown size={10} />}
              </button>

              {/* Clear all */}
              {hasActiveFilters && (
                <button onClick={handleResetFilters}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0">
                  <X size={10} /><span>Clear</span>
                </button>
              )}
            </div>

            {/* ── Summary bar ── */}
            {ratings.length > 0 && (
              <div className="flex items-center gap-4 px-1 mb-3">
                <p className="text-xs text-on-surface/40">
                  <span className="font-bold text-on-surface">{filteredRatings.length}</span>
                  {filteredRatings.length !== ratings.length && ` of ${ratings.length}`} rated
                </p>
                {filteredRatings.length > 0 && (
                  <p className="text-xs text-on-surface/40">
                    Avg: <span className="font-bold text-on-surface">{(filteredRatings.reduce((sum, r) => sum + r.score, 0) / filteredRatings.length).toFixed(1)}</span>/10
                  </p>
                )}
                {wishlist.length > 0 && (
                  <p className="text-xs text-on-surface/40">
                    <Heart size={10} className="inline text-red-400 fill-red-400 mr-0.5" />
                    <span className="font-bold text-on-surface">{wishlist.length}</span> wishlisted
                  </p>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => setMainSearchOpen(!mainSearchOpen)}
                    className={cn("p-1.5 rounded-lg transition-colors", mainSearchOpen ? "text-primary bg-primary/10" : "text-on-surface/30 hover:text-on-surface/50")}>
                    <Search size={15} />
                  </button>
                  <ViewModeToggle mode={effectiveViewMode} onChange={setViewMode} />
                </div>
              </div>
            )}

            {/* Main search bar */}
            <AnimatePresence>
              {mainSearchOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={mainSearchQuery} onChange={(e) => setMainSearchQuery(e.target.value)} placeholder="Search by name, cuisine, location..."
                      autoFocus className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-9 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    {mainSearchQuery && (
                      <button onClick={() => setMainSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30"><X size={14} /></button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Restaurant list ── */}
            {ratings.length === 0 && wishlist.length === 0 ? (
              <div className="text-center py-16">
                <Star size={32} className="mx-auto text-on-surface/15 mb-3" />
                <p className="text-sm font-medium text-on-surface/40">No restaurants yet</p>
                <p className="text-xs text-on-surface/30 mt-1">Use the + button to rate or heart to wishlist</p>
                <button onClick={() => navigate('/import')}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
                  <Upload size={14} />Import from File
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Rated section */}
                {filteredRatings.length > 0 ? (
                  <div className={effectiveViewMode === 'grid' ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "space-y-3"}>
                    {filteredRatings.map((r) => {
                      const inLists = getListsForRestaurant(r.restaurantId);
                      return effectiveViewMode === 'grid' ? (
                        <RestaurantGridCard
                          key={r.restaurantId}
                          restaurantId={r.restaurantId}
                          name={r.name}
                          image={r.image}
                          cuisine={r.cuisine}
                          price={r.price}
                          score={r.score}
                          onEdit={() => openAddRestaurantModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                          onRemove={() => removeRating(r.restaurantId)}
                        />
                      ) : (
                        <RestaurantRow
                          key={r.restaurantId}
                          restaurantId={r.restaurantId}
                          name={r.name}
                          image={r.image}
                          cuisine={r.cuisine}
                          price={r.price}
                          address={r.address}
                          score={r.score}
                          tags={r.tags}
                          notes={r.notes}
                          visitDate={r.visitDate}
                          wouldReturn={r.wouldReturn}
                          listBadges={inLists.map((l) => ({ emoji: l.emoji, name: l.name }))}
                          onEdit={() => openAddRestaurantModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                        />
                      );
                    })}
                  </div>
                ) : ratings.length > 0 ? (
                  <div className="text-center py-8">
                    <SlidersHorizontal size={28} className="mx-auto text-on-surface/15 mb-3" />
                    <p className="text-sm font-medium text-on-surface/40">No matches</p>
                    <p className="text-xs text-on-surface/30 mt-1">Try adjusting your filters</p>
                  </div>
                ) : null}

                {/* Wishlist section (global) */}
                {wishlist.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 mt-2">
                      <Heart size={14} className="text-red-400 fill-red-400" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Wishlist ({wishlist.length})</h3>
                    </div>
                    <div className="space-y-3">
                      {wishlist.map((w) => (
                        <WishlistRow
                          key={w.restaurantId}
                          restaurantId={w.restaurantId}
                          name={w.name}
                          image={w.image}
                          cuisine={w.cuisine}
                          price={w.price}
                          notes={w.notes}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Filter sheet */}
      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        sortBy={sortBy}
        onSortBy={setSortBy}
        scoreRange={scoreRange}
        onScoreRange={setScoreRange}
        cityFilter={cityFilter}
        onCityFilter={setCityFilter}
        cuisineFilter={cuisineFilter}
        onCuisineFilter={setCuisineFilter}
        priceFilter={priceFilter}
        onPriceFilter={setPriceFilter}
        allCities={allCities}
        allCuisines={allCuisines}
        onReset={handleResetFilters}
      />

      {/* Create list bottom sheet */}
      <CreateListSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreate={(name, emoji, type) => createList(name, emoji, type)}
        existingListNames={lists.map((l) => l.name)}
      />

      {/* City picker — full page sheet */}
      <AnimatePresence>
        {cityDropdownOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setCityDropdownOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn("fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
                phoneMode ? "max-h-[92vh]" : "max-h-[70vh]")}
            >
              {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Select City</h3>
                <button onClick={() => setCityDropdownOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="px-5 pt-3 pb-2 flex-shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                  <input type="text" placeholder="Search cities..."
                    className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onChange={(e) => setCityDropdownOpen(true) /* keep open; filter inline */}
                    ref={(el) => { if (el) el.value = ''; }}
                    onInput={(e) => { (e.target as HTMLInputElement).dataset.q = (e.target as HTMLInputElement).value; setCityDropdownOpen(true); }}
                    id="city-picker-search"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                {allCities.filter((c) => {
                  const input = document.getElementById('city-picker-search') as HTMLInputElement | null;
                  const q = input?.value?.toLowerCase() || '';
                  return !q || c.toLowerCase().includes(q);
                }).map((city) => (
                  <button key={city} onClick={() => toggleCityFilter(city)}
                    className={cn("w-full flex items-center justify-between px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                      cityFilter.includes(city) ? "text-primary bg-primary/3" : "text-on-surface/70 hover:bg-on-surface/3")}>
                    <span className="text-sm font-medium">{city}</span>
                    {cityFilter.includes(city) && <Check size={16} className="text-primary" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cuisine picker — full page sheet */}
      <AnimatePresence>
        {cuisineDropdownOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => setCuisineDropdownOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn("fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
                phoneMode ? "max-h-[92vh]" : "max-h-[70vh]")}
            >
              {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Select Cuisine</h3>
                <button onClick={() => setCuisineDropdownOpen(false)} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="px-5 pt-3 pb-2 flex-shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                  <input type="text" placeholder="Search cuisines..."
                    className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    id="cuisine-picker-search"
                    onInput={() => setCuisineDropdownOpen(true)}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                {allCuisines.filter((c) => {
                  const input = document.getElementById('cuisine-picker-search') as HTMLInputElement | null;
                  const q = input?.value?.toLowerCase() || '';
                  return !q || c.toLowerCase().includes(q);
                }).map((cuisine) => (
                  <button key={cuisine} onClick={() => toggleCuisineFilter(cuisine)}
                    className={cn("w-full flex items-center justify-between px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                      cuisineFilter.includes(cuisine) ? "text-primary bg-primary/3" : "text-on-surface/70 hover:bg-on-surface/3")}>
                    <span className="text-sm font-medium">{cuisine}</span>
                    {cuisineFilter.includes(cuisine) && <Check size={16} className="text-primary" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Sort picker — small bottom sheet */}
      <AnimatePresence>
        {sortDropdownOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setSortDropdownOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl"
            >
              {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
              <div className="px-5 pt-3 pb-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-serif font-bold text-base">Sort By</h3>
                  <button onClick={() => setSortDropdownOpen(false)} className="w-7 h-7 rounded-full bg-on-surface/5 flex items-center justify-center">
                    <X size={14} className="text-on-surface/60" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['added', 'Date Added']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => { setSortBy(key); setSortDropdownOpen(false); }}
                      className={cn("w-full flex items-center justify-between px-3 py-3 rounded-xl transition-colors text-left",
                        sortBy === key ? "bg-primary/5 text-primary" : "text-on-surface/70 hover:bg-on-surface/3")}>
                      <span className="text-sm font-medium">{label}</span>
                      {sortBy === key && <Check size={16} className="text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Price picker — small bottom sheet */}
      <AnimatePresence>
        {priceDropdownOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-[60]" onClick={() => setPriceDropdownOpen(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl"
            >
              {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
              <div className="px-5 pt-3 pb-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-serif font-bold text-base">Price Range</h3>
                  <button onClick={() => setPriceDropdownOpen(false)} className="w-7 h-7 rounded-full bg-on-surface/5 flex items-center justify-center">
                    <X size={14} className="text-on-surface/60" />
                  </button>
                </div>
                <div className="flex gap-2">
                  {['$', '$$', '$$$', '$$$$'].map((p) => (
                    <button key={p} onClick={() => { setPriceFilter(priceFilter === p ? null : p); setPriceDropdownOpen(false); }}
                      className={cn("flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2",
                        priceFilter === p ? "border-primary bg-primary/5 text-primary" : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20")}>{p}</button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
