import React, { useState, useRef, useMemo, useEffect } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Star, ChevronRight, Plus, Trash2, ArrowLeft, ListPlus, MapPin, SlidersHorizontal, X, ChevronDown, Heart, Upload, Search, Check, Edit3, LayoutGrid, List, ArrowUpDown, MoreHorizontal, Download, Plane, StickyNote, CalendarDays, Tag, Image, Loader2, Building2, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type CustomList, type PhotoItem, type Trip, type TripRestaurant, type TripHotel, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { Link, useNavigate } from 'react-router-dom';
import { searchHotels, searchPlacesByText, type PlaceResult } from '../lib/places';
import { getCuisineLabel } from './useRestaurantDetail';
import { useAuth } from '../contexts/AuthContext';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, Calendar } from '../components/RatingShared';

/* ── Preset list suggestions ── */
interface PresetList { name: string; emoji: string; category: string; type?: 'hotel-breakfast' | 'home-cooking'; }

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
  { name: 'Home Cooking', emoji: '🍳', category: 'Functional & Daily', type: 'home-cooking' },
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
  onCreateTrip?: () => void;
}> = ({ open, onClose, onCreate, existingListNames, onCreateTrip }) => {
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
                <div className="px-5 pb-3 space-y-2">
                  <button onClick={() => setMode('custom')} className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/20 text-primary hover:bg-primary/5 transition-all">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Edit3 size={16} /></div>
                    <div className="text-left">
                      <p className="text-sm font-semibold">Create Custom List</p>
                      <p className="text-[11px] text-primary/60">Choose your own name & emoji</p>
                    </div>
                  </button>
                  {onCreateTrip && (
                    <button onClick={() => { handleClose(); onCreateTrip(); }} className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/20 text-primary hover:bg-primary/5 transition-all">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Plane size={16} /></div>
                      <div className="text-left">
                        <p className="text-sm font-semibold">Plan a Trip</p>
                        <p className="text-[11px] text-primary/60">Organize restaurants by night</p>
                      </div>
                    </button>
                  )}
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
  onCreateNewRating?: (restaurantId: string, meta: RestaurantMeta) => void;
}> = ({ open, onClose, listId, listRestaurantIds, onCreateNewRating }) => {
  const { ratings, addToList, removeFromList } = useLists();
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');
  const [promptRating, setPromptRating] = useState<RestaurantRating | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return ratings;
    const q = search.toLowerCase();
    return ratings.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
  }, [ratings, search]);

  const handleToggle = (r: RestaurantRating) => {
    if (listRestaurantIds.includes(r.restaurantId)) {
      removeFromList(listId, r.restaurantId);
    } else {
      setPromptRating(r);
    }
  };

  const handleUseSame = () => {
    if (!promptRating) return;
    addToList(listId, promptRating.restaurantId);
    setPromptRating(null);
  };

  const handleCreateNew = () => {
    if (!promptRating) return;
    const r = promptRating;
    setPromptRating(null);
    onClose();
    onCreateNewRating?.(r.restaurantId, { id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address });
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
                  <button key={r.restaurantId} onClick={() => handleToggle(r)}
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

            {/* Rating choice prompt */}
            <AnimatePresence>
              {promptRating && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/40 z-10 flex items-end sm:items-center justify-center"
                  onClick={() => setPromptRating(null)}>
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white rounded-2xl shadow-2xl border border-on-surface/8 mx-5 mb-8 sm:mb-0 w-full max-w-xs overflow-hidden">
                    <div className="p-5 text-center">
                      <div className="w-12 h-12 rounded-xl overflow-hidden mx-auto mb-3 bg-on-surface/5">
                        {promptRating.image ? <img src={promptRating.image} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-on-surface/20 font-serif font-bold">{promptRating.name.charAt(0)}</div>}
                      </div>
                      <p className="font-serif font-bold text-sm mb-1">{promptRating.name}</p>
                      <p className="text-[11px] text-on-surface/40 mb-4">How would you like to add this?</p>
                      <div className="space-y-2">
                        <button onClick={handleUseSame}
                          className="w-full py-3 bg-primary text-white rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform">
                          Use Existing Rating ({promptRating.score.toFixed(1)})
                        </button>
                        <button onClick={handleCreateNew}
                          className="w-full py-3 bg-on-surface/[0.04] border border-on-surface/10 rounded-xl text-sm font-semibold text-on-surface/70 hover:bg-on-surface/[0.08] transition-colors">
                          Create New Rating
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
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
                      {cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine}{cuisine !== 'Hotel Breakfast' && price ? ` · ${price}` : ''}
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
            {cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine}{cuisine !== 'Hotel Breakfast' && price ? ` · ${price}` : ''}
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
          {cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine}{cuisine !== 'Hotel Breakfast' && price ? ` · ${price}` : ''}
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
type HotelPage = 'search' | 'main' | 'notes' | 'tags' | 'photos' | 'date';

const HOTEL_TAGS = ['Buffet', 'Continental', 'Full English', 'Room Service', 'Restaurant', 'Rooftop', 'Pool Side', 'Included', 'Extra Charge', 'Fresh Juice', 'Coffee', 'Pastries', 'Made to Order', 'Vegan Options'];

const HotelSubPage: React.FC<{
  children: React.ReactNode; onBack: () => void; title: string; rightAction?: React.ReactNode;
}> = ({ children, onBack, title, rightAction }) => (
  <motion.div initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col flex-1 min-h-0" onTouchMove={(e) => e.stopPropagation()}>
    <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
      <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
        <ArrowLeft size={20} />
      </button>
      <h2 className="font-serif font-bold text-lg flex-1">{title}</h2>
      {rightAction}
    </div>
    {children}
  </motion.div>
);

const HotelBottomBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
    <button onClick={onClick} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{label}</button>
  </div>
);

const HotelDetailBtn: React.FC<{
  icon: React.ReactNode; label: string; active: boolean; sub?: string; onClick: () => void;
}> = ({ icon, label, active, sub, onClick }) => (
  <button onClick={onClick}
    className={cn("w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all text-left",
      active ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15"
    )}>
    <span className={cn("flex-shrink-0", active ? "text-primary" : "text-on-surface/30")}>{icon}</span>
    <span className={cn("text-xs font-semibold flex-1", active ? "text-primary" : "text-on-surface/50")}>{label}</span>
    {sub && <span className="text-[11px] text-primary/60 flex-shrink-0">{sub}</span>}
    <ChevronRight size={14} className="text-on-surface/20 flex-shrink-0" />
  </button>
);

const AddHotelBreakfastModal: React.FC<{
  open: boolean;
  onClose: () => void;
  listId: string;
}> = ({ open, onClose, listId }) => {
  const { rateRestaurant, getRating, addToList, cacheRestaurantMeta } = useLists();
  const { phoneMode } = useSettings();
  const [page, setPage] = useState<HotelPage>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedHotel, setSelectedHotel] = useState<PlaceResult | null>(null);
  const [tagSearch, setTagSearch] = useState('');

  // Rating state
  const [score, setScore] = useState(7.0);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPage('search');
      setQuery('');
      setResults([]);
      setSelectedHotel(null);
      setScore(7.0);
      setNotes('');
      setVisitDate(new Date().toISOString().slice(0, 10));
      setWouldReturn(true);
      setSelectedTags([]);
      setPhotos([]);
      setTagSearch('');
    }
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
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
    setPage('main');
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

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));
  const updatePhotoCaption = (idx: number, caption: string) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, caption } : p));
  const togglePhotoFavorite = (idx: number) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, isFavorite: !p.isFavorite } : p));

  const handleSave = () => {
    if (!selectedHotel) return;
    rateRestaurant({
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
    });
    addToList(listId, selectedHotel.id);
    cacheRestaurantMeta({ id: selectedHotel.id, name: selectedHotel.name, image: selectedHotel.photoUrl || '', cuisine: 'Hotel Breakfast', price: '', address: selectedHotel.address || '' });
    onClose();
  };

  const existing = selectedHotel ? getRating(selectedHotel.id) : undefined;
  const hasNotes = notes.trim().length > 0;
  const hasDate = visitDate.length > 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const dateLabel = hasDate ? new Date(visitDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined;
  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';
  const filteredTags = tagSearch.trim() ? HOTEL_TAGS.filter((t) => t.toLowerCase().includes(tagSearch.toLowerCase())) : HOTEL_TAGS;

  if (!open) return null;

  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAddPhotos} />;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
          phoneMode ? "items-end" : "items-end sm:items-center")}
        onClick={onClose}
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
              : "h-full sm:max-w-md sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl")}
        >
          {photoInput}
          <AnimatePresence mode="wait">
            {/* ═══════════ SEARCH PAGE ═══════════ */}
            {page === 'search' && (
              <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                className="flex flex-col flex-1 min-h-0">
                <div className="px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                  <div className="min-w-0">
                    <h2 className="font-serif font-bold text-lg">Find a Hotel</h2>
                    <p className="text-xs text-on-surface/40">Search for the hotel you stayed at</p>
                  </div>
                  <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="px-5 pt-2 pb-3 flex-shrink-0">
                  <div className="relative">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/35" />
                    <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                      placeholder="Hotel name or location..." autoFocus
                      className="w-full pl-10 pr-20 py-3.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
                    <button type="submit" disabled={searching || !query.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-primary text-white rounded-xl text-xs font-bold disabled:opacity-30 transition-opacity">
                      {searching ? '...' : 'Search'}
                    </button>
                  </div>
                </form>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                  {results.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/30 mb-2">{results.length} results</p>}
                  <div className="space-y-2">
                    {results.map((hotel) => (
                      <button key={hotel.id} onClick={() => handleSelectHotel(hotel)}
                        className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white border border-on-surface/5 shadow-sm hover:shadow-md hover:border-primary/15 transition-all text-left group">
                        {hotel.photoUrl ? (
                          <img src={hotel.photoUrl} alt={hotel.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-16 h-16 rounded-xl bg-primary/5 flex items-center justify-center flex-shrink-0 text-2xl">🏨</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{hotel.name}</p>
                          <p className="text-[11px] text-on-surface/40 truncate mt-0.5">{hotel.address}</p>
                          {hotel.rating > 0 && (
                            <div className="flex items-center gap-1 mt-1">
                              <Star size={11} className="text-amber-500 fill-amber-500" />
                              <span className="text-[10px] text-on-surface/50 font-medium">{hotel.rating}</span>
                            </div>
                          )}
                        </div>
                        <ChevronRight size={16} className="text-on-surface/15 group-hover:text-primary/40 flex-shrink-0 transition-colors" />
                      </button>
                    ))}
                    {results.length === 0 && !query && !searching && (
                      <div className="text-center py-12">
                        <span className="text-4xl mb-3 block">🏨</span>
                        <p className="text-sm text-on-surface/40 font-medium">Search for a hotel</p>
                        <p className="text-xs text-on-surface/25 mt-1">Find the hotel where you had breakfast</p>
                      </div>
                    )}
                    {results.length === 0 && query && !searching && (
                      <div className="text-center py-12">
                        <p className="text-sm text-on-surface/40">No hotels found</p>
                        <p className="text-xs text-on-surface/25 mt-1">Try a different search term</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ═══════════ MAIN PAGE ═══════════ */}
            {page === 'main' && (
              <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                className="flex flex-col flex-1 min-h-0">
                <div className="px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                  <div className="min-w-0">
                    <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Update Rating' : 'Rate Breakfast'}</h2>
                    <p className="text-xs text-on-surface/40 truncate">{selectedHotel?.name}</p>
                  </div>
                  <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                  {/* Score circle */}
                  <div className="flex flex-col items-center pt-3 sm:pt-5">
                    <div className={cn("relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center mb-3 bg-gradient-to-b ring-4", scoreBg, scoreRing)}>
                      <div className="text-center">
                        <div className={cn("text-4xl sm:text-5xl font-serif font-bold tabular-nums transition-colors duration-300", scoreColor)}>{score.toFixed(1)}</div>
                        <div className="text-[8px] font-bold uppercase tracking-widest text-on-surface/30 mt-0.5">out of 10</div>
                      </div>
                    </div>
                    <div className="w-full max-w-[260px] mb-1.5">
                      <input type="range" min="1" max="10" step="0.1" value={score} onChange={(e) => setScore(parseFloat(e.target.value))}
                        className="w-full h-2.5 bg-on-surface/8 rounded-full appearance-none cursor-pointer accent-primary" />
                      <div className="flex justify-between mt-1 text-[10px] text-on-surface/25 font-semibold px-0.5">
                        <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-on-surface/40 mb-4">
                      {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                    </p>
                    <div className="w-full max-w-[260px] mb-5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 text-center mb-2">Would you go back?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setWouldReturn(true)} className={cn("flex-1 py-2 rounded-xl text-sm font-semibold border transition-all", wouldReturn ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-on-surface/10 text-on-surface/40")}>Yes!</button>
                        <button onClick={() => setWouldReturn(false)} className={cn("flex-1 py-2 rounded-xl text-sm font-semibold border transition-all", !wouldReturn ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-on-surface/10 text-on-surface/40")}>Nah</button>
                      </div>
                    </div>
                  </div>

                  {/* Detail buttons */}
                  <div className="border-t border-on-surface/6 pt-3 pb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2.5">Add details</p>
                    <div className="space-y-2">
                      <HotelDetailBtn icon={<StickyNote size={17} />} label="Notes" active={hasNotes} sub={hasNotes ? notes.slice(0, 20) + '...' : undefined} onClick={() => setPage('notes')} />
                      <HotelDetailBtn icon={<CalendarDays size={17} />} label="Date" active={hasDate} sub={dateLabel} onClick={() => setPage('date')} />
                      <HotelDetailBtn icon={<Tag size={17} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
                      <HotelDetailBtn icon={<Image size={17} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={() => setPage('photos')} />
                    </div>
                  </div>
                </div>

                <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                  <button onClick={handleSave} className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                    {existing ? 'Update Rating' : 'Save Rating'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══════════ NOTES ═══════════ */}
            {page === 'notes' && (
              <HotelSubPage key="notes" onBack={() => setPage('main')} title="Notes">
                <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="How was the breakfast? Any favorite dishes, standout moments?" rows={8} autoFocus
                    className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                </div>
                <HotelBottomBtn label={hasNotes ? 'Update Notes' : 'Save Notes'} onClick={() => setPage('main')} />
              </HotelSubPage>
            )}

            {/* ═══════════ DATE ═══════════ */}
            {page === 'date' && (
              <HotelSubPage key="date" onBack={() => setPage('main')} title="Date Visited">
                <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                  <Calendar value={visitDate} onChange={setVisitDate} onClear={() => setVisitDate('')} />
                </div>
                <HotelBottomBtn label="Done" onClick={() => setPage('main')} />
              </HotelSubPage>
            )}

            {/* ═══════════ TAGS ═══════════ */}
            {page === 'tags' && (
              <HotelSubPage key="tags" onBack={() => { setPage('main'); setTagSearch(''); }} title="Tags">
                <div className="px-5 pt-4 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Search tags..."
                      className="w-full pl-10 pr-4 py-2.5 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-2">
                  {filteredTags.map((tag) => {
                    const sel = selectedTags.includes(tag);
                    return (
                      <button key={tag} onClick={() => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
                        className={cn("w-full flex items-center gap-3 py-3 border-b border-on-surface/6 transition-colors",
                          sel ? "text-primary" : "text-on-surface/60 hover:text-on-surface/80")}>
                        <div className={cn("w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0",
                          sel ? "bg-primary border-primary text-white" : "border-on-surface/20"
                        )}>{sel && <Check size={12} strokeWidth={3} />}</div>
                        <span className={cn("text-sm font-medium", sel ? "text-primary" : "text-on-surface/70")}>{tag}</span>
                      </button>
                    );
                  })}
                </div>
                <HotelBottomBtn label={hasTags ? `Done (${selectedTags.length})` : 'Done'} onClick={() => { setPage('main'); setTagSearch(''); }} />
              </HotelSubPage>
            )}

            {/* ═══════════ PHOTOS ═══════════ */}
            {page === 'photos' && (
              <HotelSubPage key="photos" onBack={() => setPage('main')} title="Photos" rightAction={
                <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-primary">Add More</button>
              }>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" onTouchMove={(e) => e.stopPropagation()}>
                  {photos.length === 0 ? (
                    <div className="px-5 py-16 flex flex-col items-center justify-center text-on-surface/30">
                      <Image size={28} className="mb-2" />
                      <p className="text-sm font-semibold">No photos yet</p>
                      <button onClick={() => fileInputRef.current?.click()} className="mt-3 text-primary text-sm font-semibold">Add Photos</button>
                    </div>
                  ) : (
                    <div className="divide-y divide-on-surface/8">
                      {photos.map((photo, idx) => (
                        <div key={idx} className="flex gap-3 px-5 py-4">
                          <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 relative">
                            <img src={photo.url} alt="" className="w-full h-full object-cover" />
                            <button onClick={() => removePhoto(idx)}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                              <X size={10} className="text-white" />
                            </button>
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                            <input type="text" value={photo.caption} onChange={(e) => updatePhotoCaption(idx, e.target.value)}
                              placeholder="What's this dish?"
                              className="text-sm font-medium text-on-surface/70 placeholder:text-on-surface/30 border-none outline-none bg-transparent w-full" />
                            <button onClick={() => togglePhotoFavorite(idx)}
                              className={cn("flex items-center gap-2 mt-2 text-xs font-medium transition-colors",
                                photo.isFavorite ? "text-primary" : "text-on-surface/35"
                              )}>
                              <span className="text-on-surface/40">Mark as a favorite dish:</span>
                              <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                photo.isFavorite ? "bg-primary border-primary text-white" : "border-on-surface/20"
                              )}>
                                {photo.isFavorite && <Star size={10} fill="white" />}
                              </div>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <HotelBottomBtn label={hasPhotos ? `Done (${photos.length})` : 'Done'} onClick={() => setPage('main')} />
              </HotelSubPage>
            )}
          </AnimatePresence>
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
  const { ratings, getRestaurantInfo, removeFromList, removeFromWishlistInList, openAddRestaurantModal, deleteList, wishlist, removeFromWishlist, rateRestaurant, addToList, setListRating, getListRating, getRecipes, openAddRecipeModal, removeRecipe } = useLists();
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [hotelModalOpen, setHotelModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pendingListRatingRef = useRef<{ restaurantId: string; openedAt: number } | null>(null);

  // Watch for the global rating being updated after we opened the modal for a list-specific rating
  useEffect(() => {
    const pending = pendingListRatingRef.current;
    if (!pending) return;
    const globalRating = ratings.find((r) => r.restaurantId === pending.restaurantId);
    if (globalRating && globalRating.createdAt && globalRating.createdAt >= pending.openedAt) {
      // The rating was just saved/updated — move it to list-specific storage
      setListRating(list.id, globalRating);
      pendingListRatingRef.current = null;
    }
  }, [ratings, list.id, setListRating]);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteList, setConfirmDeleteList] = useState(false);

  const isWishlistView = list.id === '__wishlist__';
  const isHotelBreakfast = list.type === 'hotel-breakfast';
  const isHomeCooking = list.type === 'home-cooking';

  const recipes = getRecipes(list.id);
  const filteredRecipes = useMemo(() => {
    if (!searchQuery.trim()) return recipes;
    const q = searchQuery.toLowerCase();
    return recipes.filter((r) => r.title.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)));
  }, [recipes, searchQuery]);

  const ratedRestaurants = list.restaurantIds.map((id) => {
    const info = getRestaurantInfo(id);
    // Prefer list-specific rating over global rating
    const listRating = getListRating(list.id, id);
    const globalRating = ratings.find((r) => r.restaurantId === id);
    const rating = listRating || globalRating;
    return { id, info, rating, hasListRating: !!listRating };
  }).filter(({ info }) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return info?.name.toLowerCase().includes(q) || info?.cuisine.toLowerCase().includes(q) || info?.address.toLowerCase().includes(q);
  });

  const wishlistedRestaurants = isHotelBreakfast
    ? wishlist.filter((w) => w.cuisine === 'Hotel Breakfast').map((w) => ({
        id: w.restaurantId,
        info: getRestaurantInfo(w.restaurantId) || { id: w.restaurantId, name: w.name, image: w.image, cuisine: w.cuisine, price: w.price, address: w.address },
        wishItem: w,
      }))
    : (list.wishlistIds || []).map((id) => {
        const info = getRestaurantInfo(id);
        const wishItem = wishlist.find((w) => w.restaurantId === id);
        return { id, info, wishItem };
      }).filter(({ info }) => info);

  const totalCount = isHomeCooking ? recipes.length : list.restaurantIds.length + (list.wishlistIds?.length || 0);

  const handlePlusClick = () => {
    if (isHomeCooking) openAddRecipeModal(list.id);
    else if (isHotelBreakfast) setHotelModalOpen(true);
    else setAddSheetOpen(true);
  };

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
            {isHomeCooking ? `${totalCount} recipe${totalCount !== 1 ? 's' : ''}` : `${totalCount} restaurant${totalCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={() => setSearchOpen(!searchOpen)}
          className={cn("p-2 rounded-full transition-colors", searchOpen ? "text-primary bg-primary/10" : "text-on-surface/40 hover:text-on-surface")}>
          <Search size={18} />
        </button>
        {!isWishlistView && (
          <button onClick={handlePlusClick}
            className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors" title={isHomeCooking ? "Add recipe" : isHotelBreakfast ? "Add hotel" : "Add restaurants"}>
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

      {isHomeCooking ? (
        /* ── Home Cooking: Recipe list ── */
        recipes.length === 0 ? (
          <div className="text-center py-16">
            <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
            <p className="text-sm font-medium text-on-surface/40">No recipes yet</p>
            <p className="text-xs text-on-surface/30 mt-1">Add your first home cooking recipe</p>
            <button onClick={() => openAddRecipeModal(list.id)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
              <Plus size={14} />Add Recipe
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecipes.map((recipe) => {
              const scoreColor = recipe.score >= 8 ? 'text-green-500' : recipe.score >= 5 ? 'text-yellow-500' : 'text-red-400';
              return (
                <button key={recipe.id} onClick={() => openAddRecipeModal(list.id, recipe)}
                  className="w-full flex items-center gap-3 p-3 bg-white border border-on-surface/8 rounded-2xl hover:shadow-md transition-all text-left">
                  {recipe.coverPhoto ? (
                    <img src={recipe.coverPhoto} alt={recipe.title} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-on-surface/5 flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">🍳</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface/80 truncate">{recipe.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {recipe.cuisine && <span className="text-[11px] text-on-surface/40">{recipe.cuisine}</span>}
                      {recipe.difficulty && <span className="text-[11px] text-on-surface/30">· {recipe.difficulty}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {(recipe.prepTime > 0 || recipe.cookTime > 0) && (
                        <span className="text-[10px] text-on-surface/35">{recipe.prepTime + recipe.cookTime} min</span>
                      )}
                      {recipe.ingredients.length > 0 && (
                        <span className="text-[10px] text-on-surface/35">{recipe.ingredients.length} ingredients</span>
                      )}
                      {recipe.tags.length > 0 && (
                        <span className="text-[10px] text-on-surface/35">{recipe.tags[0]}{recipe.tags.length > 1 ? ` +${recipe.tags.length - 1}` : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className={cn("text-lg font-serif font-bold tabular-nums", scoreColor)}>{recipe.score.toFixed(1)}</span>
                    <p className="text-[9px] text-on-surface/30 font-medium">/ 10</p>
                  </div>
                </button>
              );
            })}
            {/* Add more button */}
            <button onClick={() => openAddRecipeModal(list.id)}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
              <Plus size={16} /><span className="text-sm font-semibold">Add Recipe</span>
            </button>
          </div>
        )
      ) : totalCount === 0 ? (
        <div className="text-center py-16">
          <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">This list is empty</p>
          <p className="text-xs text-on-surface/30 mt-1">{isHotelBreakfast ? 'Rate a hotel breakfast to get started' : 'Add restaurants from your rated collection'}</p>
          <button onClick={() => isHotelBreakfast ? setHotelModalOpen(true) : setAddSheetOpen(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            <Plus size={14} />{isHotelBreakfast ? 'Add Hotel Breakfast' : 'Add Restaurants'}
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
          <button onClick={handlePlusClick}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
            <Plus size={16} /><span className="text-sm font-semibold">{isHotelBreakfast ? 'Add Hotel' : 'Add Restaurants'}</span>
          </button>
        </div>
      )}

      <AddFromRatedSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} listId={list.id} listRestaurantIds={list.restaurantIds}
        onCreateNewRating={(restaurantId, meta) => {
          pendingListRatingRef.current = { restaurantId, openedAt: Date.now() };
          addToList(list.id, restaurantId);
          openAddRestaurantModal(meta);
        }}
      />
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

/* ── Add to Night Sheet ── */
type AddNightPage = 'select' | 'from-rated' | 'search-new' | 'hotel';
const MEAL_TYPES: TripRestaurant['mealType'][] = ['breakfast', 'lunch', 'drinks', 'dinner', 'snack'];

const AddToNightSheet: React.FC<{
  open: boolean;
  nightIndex: number;
  nightDate: string;
  tripId: string;
  tripLat: number;
  tripLng: number;
  existingRestaurantIds: Set<string>;
  ratings: RestaurantRating[];
  addRestaurantToTrip: (tripId: string, restaurant: TripRestaurant) => void;
  openAddRestaurantModal: (restaurant: RestaurantMeta, initialPage?: string) => void;
  rateRestaurant: (rating: RestaurantRating) => void;
  onClose: () => void;
}> = ({ open, nightIndex, nightDate, tripId, tripLat, tripLng, existingRestaurantIds, ratings, addRestaurantToTrip, openAddRestaurantModal, rateRestaurant, onClose }) => {
  const { phoneMode } = useSettings();
  const [page, setPage] = useState<AddNightPage>('select');
  const [mealType, setMealType] = useState<TripRestaurant['mealType']>('dinner');
  const [reservationTime, setReservationTime] = useState('');
  const [ratedSearch, setRatedSearch] = useState('');
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [hotelSearch, setHotelSearch] = useState('');
  const [hotelResults, setHotelResults] = useState<PlaceResult[]>([]);
  const [hotelLoading, setHotelLoading] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPage('select');
      setMealType('dinner');
      setReservationTime('');
      setRatedSearch('');
      setPlaceSearch('');
      setPlaceResults([]);
      setHotelSearch('');
      setHotelResults([]);
      setJustAdded(null);
    }
  }, [open]);

  const lat = tripLat || 40.735;
  const lng = tripLng || -73.99;

  const handleSearchPlaces = async () => {
    if (!placeSearch.trim()) return;
    setPlaceLoading(true);
    try {
      const res = await searchPlacesByText(placeSearch, lat, lng);
      setPlaceResults(res);
    } catch { setPlaceResults([]); }
    finally { setPlaceLoading(false); }
  };

  const handleSearchHotels = async () => {
    if (!hotelSearch.trim()) return;
    setHotelLoading(true);
    try {
      const res = await searchHotels(hotelSearch, lat, lng);
      setHotelResults(res);
    } catch { setHotelResults([]); }
    finally { setHotelLoading(false); }
  };

  const addFromRating = (r: RestaurantRating) => {
    if (existingRestaurantIds.has(r.restaurantId)) return;
    addRestaurantToTrip(tripId, {
      restaurantId: r.restaurantId,
      name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address,
      night: nightIndex, mealType, status: 'planned',
      reservationTime: reservationTime || undefined,
    });
    setJustAdded(r.restaurantId);
    setTimeout(() => setJustAdded(null), 1200);
  };

  const addFromSearch = (place: PlaceResult) => {
    const cuisine = getCuisineLabel(place.types);
    const meta: RestaurantMeta = {
      id: place.id, name: place.name, image: place.photoUrl || '',
      cuisine, price: '', address: place.address,
    };
    // Add to trip immediately
    addRestaurantToTrip(tripId, {
      restaurantId: place.id,
      name: place.name, image: place.photoUrl || '', cuisine, price: '', address: place.address,
      night: nightIndex, mealType, status: 'planned',
      reservationTime: reservationTime || undefined,
    });
    // Open rating modal so user can rate it
    onClose();
    openAddRestaurantModal(meta);
  };

  const addHotel = (hotel: PlaceResult) => {
    addRestaurantToTrip(tripId, {
      restaurantId: hotel.id,
      name: hotel.name, image: hotel.photoUrl || '', cuisine: 'Hotel Breakfast', price: '', address: hotel.address,
      night: nightIndex, mealType: mealType === 'dinner' ? 'breakfast' : mealType, status: 'planned',
      reservationTime: reservationTime || undefined,
    });
    setJustAdded(hotel.id);
    setTimeout(() => setJustAdded(null), 1200);
  };

  const filteredRatings = ratedSearch.trim()
    ? ratings.filter((r) => r.name.toLowerCase().includes(ratedSearch.toLowerCase()) || r.cuisine.toLowerCase().includes(ratedSearch.toLowerCase()))
    : ratings;

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
          phoneMode ? "items-end" : "items-end sm:items-center")}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className={cn("bg-surface w-full overflow-hidden flex flex-col",
            phoneMode ? "h-full rounded-none" : "h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl")}
        >
          {phoneMode && <div className="flex justify-center pt-3 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}

          <AnimatePresence mode="wait">
            {/* ═══ PAGE 1: SELECT MODE ═══ */}
            {page === 'select' && (
              <motion.div key="select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                className="flex flex-col flex-1 min-h-0">
                <div className="px-5 pt-4 pb-3 flex items-center justify-between flex-shrink-0">
                  <div>
                    <h2 className="font-serif font-bold text-lg">Add to Night {nightIndex + 1}</h2>
                    <p className="text-xs text-on-surface/40">{nightDate}</p>
                  </div>
                  <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                </div>

                {/* Meal type + time */}
                <div className="px-5 pb-4 flex-shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2">Meal Type</p>
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
                    {MEAL_TYPES.map((m) => (
                      <button key={m} onClick={() => setMealType(m)}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border-2 capitalize transition-all whitespace-nowrap",
                          mealType === m ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/40")}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <input type="text" value={reservationTime} onChange={(e) => setReservationTime(e.target.value)}
                    placeholder="Reservation time (e.g. 7:30 PM)"
                    className="w-full px-3.5 py-2.5 bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                  {/* Option cards */}
                  <div className="space-y-2.5 mb-4">
                    <button onClick={() => setPage('from-rated')}
                      className="w-full flex items-center gap-4 p-4 bg-white border border-on-surface/8 rounded-2xl text-left hover:border-primary/20 hover:shadow-sm transition-all">
                      <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Star size={20} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface">From My Ratings</p>
                        <p className="text-[11px] text-on-surface/40 mt-0.5">Pick from restaurants you've already reviewed</p>
                      </div>
                      <ChevronRight size={16} className="text-on-surface/20 flex-shrink-0" />
                    </button>

                    <button onClick={() => setPage('search-new')}
                      className="w-full flex items-center gap-4 p-4 bg-white border border-on-surface/8 rounded-2xl text-left hover:border-primary/20 hover:shadow-sm transition-all">
                      <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                        <Search size={20} className="text-violet-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface">Search New Restaurant</p>
                        <p className="text-[11px] text-on-surface/40 mt-0.5">Find a restaurant and add a new rating</p>
                      </div>
                      <ChevronRight size={16} className="text-on-surface/20 flex-shrink-0" />
                    </button>
                  </div>

                  {/* Secondary option */}
                  <button onClick={() => { setPage('hotel'); if (mealType === 'dinner') setMealType('breakfast'); }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-on-surface/[0.03] border border-on-surface/6 rounded-xl text-left hover:bg-on-surface/[0.05] transition-all">
                    <Building2 size={16} className="text-on-surface/35 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-on-surface/60">Hotel / Hotel Breakfast</p>
                      <p className="text-[10px] text-on-surface/30">Restaurant inside a hotel</p>
                    </div>
                    <ChevronRight size={14} className="text-on-surface/15 flex-shrink-0" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══ PAGE 2A: FROM MY RATINGS ═══ */}
            {page === 'from-rated' && (
              <motion.div key="from-rated" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="flex flex-col h-full">
                <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
                  <button onClick={() => setPage('select')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40"><ChevronLeft size={22} /></button>
                  <h2 className="font-serif font-bold text-lg flex-1">From My Ratings</h2>
                </div>

                <div className="px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={ratedSearch} onChange={(e) => setRatedSearch(e.target.value)} placeholder="Search your ratings..."
                      className="w-full pl-10 pr-4 py-2.5 bg-on-surface/5 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                  {ratings.length === 0 ? (
                    <div className="text-center py-16">
                      <Star size={28} className="mx-auto text-on-surface/15 mb-2" />
                      <p className="text-sm text-on-surface/40 font-medium">No rated restaurants yet</p>
                      <button onClick={() => setPage('search-new')} className="mt-3 text-sm font-semibold text-primary">Search for a restaurant</button>
                    </div>
                  ) : filteredRatings.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-sm text-on-surface/40">No matches for "{ratedSearch}"</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 pt-2">
                      {filteredRatings.map((r) => {
                        const alreadyAdded = existingRestaurantIds.has(r.restaurantId);
                        const wasJustAdded = justAdded === r.restaurantId;
                        return (
                          <div key={r.restaurantId} className="flex items-center gap-3 py-2.5">
                            {r.image ? (
                              <img src={r.image} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-11 h-11 rounded-lg bg-on-surface/[0.04] flex items-center justify-center flex-shrink-0 text-sm font-serif font-bold text-on-surface/20">{r.name.charAt(0)}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold truncate">{r.name}</p>
                              <p className="text-[10px] text-on-surface/40">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                            </div>
                            {r.score > 0 && <span className={cn("text-sm font-serif font-bold flex-shrink-0", scoreColor(r.score))}>{r.score.toFixed(1)}</span>}
                            <button
                              onClick={() => !alreadyAdded && !wasJustAdded && addFromRating(r)}
                              disabled={alreadyAdded}
                              className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                                wasJustAdded ? "bg-green-100 text-green-600" :
                                alreadyAdded ? "bg-on-surface/5 text-on-surface/20 cursor-not-allowed" :
                                "bg-primary/10 text-primary hover:bg-primary/20")}
                            >
                              {wasJustAdded || alreadyAdded ? <Check size={14} /> : <Plus size={14} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                  <button onClick={onClose} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">Done</button>
                </div>
              </motion.div>
            )}

            {/* ═══ PAGE 2B: SEARCH NEW RESTAURANT ═══ */}
            {page === 'search-new' && (
              <motion.div key="search-new" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="flex flex-col h-full">
                <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
                  <button onClick={() => setPage('select')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40"><ChevronLeft size={22} /></button>
                  <h2 className="font-serif font-bold text-lg flex-1">Search Restaurant</h2>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSearchPlaces(); }} className="px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={placeSearch} onChange={(e) => setPlaceSearch(e.target.value)} placeholder="Restaurant name..."
                      autoFocus className="w-full pl-10 pr-20 py-2.5 bg-on-surface/5 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <button type="submit" disabled={placeLoading || !placeSearch.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-30 transition-opacity">
                      {placeLoading ? '...' : 'Search'}
                    </button>
                  </div>
                </form>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                  {placeLoading && (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-primary" />
                    </div>
                  )}
                  {!placeLoading && placeResults.length === 0 && placeSearch && (
                    <div className="text-center py-12">
                      <p className="text-sm text-on-surface/40">No restaurants found</p>
                      <p className="text-xs text-on-surface/25 mt-1">Try a different search</p>
                    </div>
                  )}
                  {!placeLoading && placeResults.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      {placeResults.map((place) => {
                        const alreadyAdded = existingRestaurantIds.has(place.id);
                        return (
                          <button key={place.id} onClick={() => !alreadyAdded && addFromSearch(place)} disabled={alreadyAdded}
                            className={cn("w-full flex items-center gap-3 py-2.5 text-left transition-all",
                              alreadyAdded ? "opacity-40" : "hover:bg-on-surface/[0.02]")}>
                            {place.photoUrl ? (
                              <img src={place.photoUrl} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-11 h-11 rounded-lg bg-on-surface/[0.04] flex items-center justify-center flex-shrink-0 text-sm font-serif font-bold text-on-surface/20">{place.name.charAt(0)}</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold truncate">{place.name}</p>
                              <p className="text-[10px] text-on-surface/40">{getCuisineLabel(place.types)}{place.rating > 0 ? ` · ★ ${place.rating}` : ''}</p>
                            </div>
                            {alreadyAdded ? (
                              <span className="text-[10px] text-on-surface/30 font-medium flex-shrink-0">Added</span>
                            ) : (
                              <ChevronRight size={16} className="text-on-surface/20 flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ═══ PAGE 2C: HOTEL / HOTEL BREAKFAST ═══ */}
            {page === 'hotel' && (
              <motion.div key="hotel" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="flex flex-col h-full">
                <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
                  <button onClick={() => setPage('select')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40"><ChevronLeft size={22} /></button>
                  <h2 className="font-serif font-bold text-lg flex-1">Hotel Restaurant</h2>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSearchHotels(); }} className="px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={hotelSearch} onChange={(e) => setHotelSearch(e.target.value)} placeholder="Hotel name or location..."
                      autoFocus className="w-full pl-10 pr-20 py-2.5 bg-on-surface/5 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <button type="submit" disabled={hotelLoading || !hotelSearch.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-30 transition-opacity">
                      {hotelLoading ? '...' : 'Search'}
                    </button>
                  </div>
                </form>

                {/* Meal type selector for hotel */}
                <div className="px-5 py-2 flex-shrink-0">
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                    {(['breakfast', 'lunch', 'dinner', 'snack'] as TripRestaurant['mealType'][]).map((m) => (
                      <button key={m} onClick={() => setMealType(m)}
                        className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border-2 capitalize transition-all whitespace-nowrap",
                          mealType === m ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/40")}>
                        {m === 'breakfast' ? '🥐 Breakfast' : m === 'lunch' ? '🍽️ Lunch' : m === 'dinner' ? '🌙 Dinner' : '🍰 Snack'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                  {hotelLoading && (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-primary" />
                    </div>
                  )}
                  {!hotelLoading && hotelResults.length === 0 && hotelSearch && (
                    <div className="text-center py-12">
                      <p className="text-sm text-on-surface/40">No hotels found</p>
                    </div>
                  )}
                  {!hotelLoading && hotelResults.length === 0 && !hotelSearch && (
                    <div className="text-center py-12">
                      <span className="text-3xl mb-2 block">🏨</span>
                      <p className="text-sm text-on-surface/40">Search for a hotel</p>
                    </div>
                  )}
                  {!hotelLoading && hotelResults.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      {hotelResults.map((hotel) => {
                        const alreadyAdded = existingRestaurantIds.has(hotel.id);
                        const wasJustAdded = justAdded === hotel.id;
                        return (
                          <div key={hotel.id} className="flex items-center gap-3 py-2.5">
                            {hotel.photoUrl ? (
                              <img src={hotel.photoUrl} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-11 h-11 rounded-lg bg-primary/5 flex items-center justify-center flex-shrink-0 text-base">🏨</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold truncate">{hotel.name}</p>
                              <p className="text-[10px] text-on-surface/40 truncate">{hotel.address}</p>
                            </div>
                            <button
                              onClick={() => !alreadyAdded && !wasJustAdded && addHotel(hotel)}
                              disabled={alreadyAdded}
                              className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                                wasJustAdded ? "bg-green-100 text-green-600" :
                                alreadyAdded ? "bg-on-surface/5 text-on-surface/20 cursor-not-allowed" :
                                "bg-primary/10 text-primary hover:bg-primary/20")}
                            >
                              {wasJustAdded || alreadyAdded ? <Check size={14} /> : <Plus size={14} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                  <button onClick={onClose} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">Done</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
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
  autoCreate?: boolean;
  onAutoCreateHandled?: () => void;
}> = ({ trips, createTrip, updateTrip, deleteTrip, addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip, addHotelToTrip, updateHotel, removeHotelFromTrip, rateRestaurant, openAddRestaurantModal, cacheRestaurantMeta, ratings, onBack, autoCreate, onAutoCreateHandled }) => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [addNightSheetOpen, setAddNightSheetOpen] = useState(false);
  const [addNightIndex, setAddNightIndex] = useState<number>(0);

  const selectedTrip = trips.find((t) => t.id === selectedTripId) || null;

  // Auto-open create sheet when navigating from "Plan a Trip" in the lists popup
  useEffect(() => {
    if (autoCreate && !createOpen) {
      setCreateOpen(true);
      onAutoCreateHandled?.();
    }
  }, [autoCreate]);

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
    const plannedCount = selectedTrip.restaurants.filter((r) => r.status === 'planned').length;
    const avgRating = completedCount > 0
      ? (selectedTrip.restaurants.filter((r) => r.status === 'completed' && r.rating).reduce((sum, r) => sum + (r.rating?.score || 0), 0) / completedCount).toFixed(1)
      : '—';
    const totalRestaurants = selectedTrip.restaurants.length;

    // Check for tonight's reminder
    const today = new Date();
    const tripStart = new Date(selectedTrip.startDate + 'T00:00:00');
    const currentNight = Math.floor((today.getTime() - tripStart.getTime()) / 86400000);
    const tonightDinner = selectedTrip.restaurants.find((r) => r.night === currentNight && r.mealType === 'dinner' && r.status === 'planned');

    return (
      <div className="pb-8">
        {/* ── Header ── */}
        <div className="mb-6">
          {selectedTrip.coverImage ? (
            <div className="relative -mx-3 mb-5">
              <div className="relative aspect-[2.5/1] rounded-2xl overflow-hidden mx-3">
                <img src={selectedTrip.coverImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                <button onClick={() => setSelectedTripId(null)}
                  className="absolute top-3 left-3 p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/90 hover:bg-black/40 transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div className="absolute top-3 right-3 flex gap-1.5">
                  <button onClick={() => setEditingTrip(selectedTrip)}
                    className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/90 hover:bg-black/40 transition-colors">
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => { if (confirm('Delete this trip?')) { deleteTrip(selectedTrip.id); setSelectedTripId(null); } }}
                    className="p-2 bg-black/25 backdrop-blur-sm rounded-full text-white/90 hover:bg-black/40 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 mb-5">
              <button onClick={() => setSelectedTripId(null)} className="p-1.5 rounded-full hover:bg-on-surface/5 transition-colors">
                <ArrowLeft size={20} className="text-on-surface/50" />
              </button>
              <div className="flex-1" />
              <button onClick={() => setEditingTrip(selectedTrip)} className="p-2 rounded-full hover:bg-on-surface/5 transition-colors">
                <Edit3 size={15} className="text-on-surface/35" />
              </button>
              <button onClick={() => { if (confirm('Delete this trip?')) { deleteTrip(selectedTrip.id); setSelectedTripId(null); } }}
                className="p-2 rounded-full hover:bg-on-surface/5 transition-colors text-on-surface/25 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          )}

          {/* Trip name + meta */}
          <div className="px-1">
            <h1 className="text-2xl font-serif font-bold text-on-surface leading-tight">{selectedTrip.name}</h1>
            <p className="text-sm text-on-surface/45 mt-1.5 font-medium">
              {selectedTrip.destination} · {formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}
            </p>
            <div className="mt-3">
              <span className={cn("inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider",
                selectedTrip.status === 'active' ? "bg-green-50 text-green-600" :
                selectedTrip.status === 'completed' ? "bg-on-surface/[0.04] text-on-surface/35" :
                "bg-primary/[0.06] text-primary/70"
              )}>{selectedTrip.status}</span>
            </div>
          </div>
        </div>

        {/* ── Tonight reminder ── */}
        {tonightDinner && selectedTrip.status === 'active' && (
          <div className="bg-primary/[0.04] border border-primary/10 rounded-2xl px-4 py-3.5 mb-6 flex items-center gap-3">
            <span className="text-xl">🍽️</span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary/70 mb-0.5">Tonight</p>
              <p className="text-sm font-semibold text-on-surface truncate">{tonightDinner.name}</p>
              {tonightDinner.reservationTime && <p className="text-[11px] text-on-surface/40 mt-0.5">{tonightDinner.reservationTime}</p>}
            </div>
          </div>
        )}

        {/* ── Stats ── */}
        <div className="flex items-center gap-6 px-1 mb-7">
          {[
            { value: nights, label: 'Nights' },
            { value: plannedCount, label: 'Planned' },
            { value: completedCount, label: 'Done' },
            { value: avgRating, label: 'Avg' },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-lg font-serif font-bold text-on-surface leading-none">{s.value}</p>
              <p className="text-[9px] text-on-surface/35 font-medium uppercase tracking-wider mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Hotels ── */}
        {selectedTrip.hotels.length > 0 && (
          <div className="mb-7">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mb-2.5 px-1">Accommodation</p>
            {selectedTrip.hotels.map((hotel) => (
              <div key={hotel.id} className="bg-white rounded-2xl border border-on-surface/[0.06] shadow-sm p-3.5 mb-2 flex items-center gap-3">
                {hotel.image ? (
                  <img src={hotel.image} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 text-base">🏨</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[13px] truncate">{hotel.name}</p>
                  <p className="text-[10px] text-on-surface/35 mt-0.5">{hotel.checkIn} → {hotel.checkOut}</p>
                </div>
                {hotel.confirmationNumber && (
                  <span className="text-[9px] text-on-surface/25 font-mono flex-shrink-0">#{hotel.confirmationNumber}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Empty hint ── */}
        {totalRestaurants === 0 && (
          <div className="text-center py-2 mb-4">
            <p className="text-xs text-on-surface/30 font-medium">Tap <span className="text-primary">+ Add</span> on any night to start building your itinerary</p>
          </div>
        )}

        {/* ── Night-by-night itinerary ── */}
        <div className="space-y-3 mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 px-1">Itinerary</p>

          {Array.from({ length: nights }).map((_, nightIdx) => {
            const nightRestaurants = selectedTrip.restaurants
              .filter((r) => r.night === nightIdx)
              .sort((a, b) => (MEAL_ORDER[a.mealType] || 0) - (MEAL_ORDER[b.mealType] || 0));

            const nightDateStr = getNightDate(selectedTrip.startDate, nightIdx);

            return (
              <div key={nightIdx} className="bg-white rounded-2xl border border-on-surface/[0.06] shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3.5">
                  {/* Left: night number + date */}
                  <div className="flex-shrink-0 w-12 text-center">
                    <p className="text-xl font-serif font-bold text-on-surface leading-none">{nightIdx + 1}</p>
                    <p className="text-[8px] font-semibold uppercase tracking-wider text-on-surface/30 mt-1">Night</p>
                  </div>
                  <div className="h-8 w-px bg-on-surface/[0.06]" />
                  {/* Right: date + content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-on-surface/50">{nightDateStr}</p>
                    {nightRestaurants.length === 0 && (
                      <p className="text-[11px] text-on-surface/25 italic mt-0.5">No restaurants planned</p>
                    )}
                  </div>
                  {/* Add button */}
                  <button
                    onClick={() => { setAddNightIndex(nightIdx); setAddNightSheetOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/[0.06] text-primary hover:bg-primary/[0.12] transition-colors flex-shrink-0"
                  >
                    <Plus size={13} />
                    <span className="text-[11px] font-semibold">Add</span>
                  </button>
                </div>

                {/* Restaurant cards within this night */}
                {nightRestaurants.length > 0 && (
                  <div className="border-t border-on-surface/[0.05] divide-y divide-on-surface/[0.05]">
                    {nightRestaurants.map((r) => (
                      <div key={`${r.restaurantId}-${r.night}`}
                        className={cn("flex items-center gap-3 px-4 py-3", r.status === 'skipped' && "opacity-40")}
                      >
                        {r.image ? (
                          <img src={r.image} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-on-surface/[0.04] flex items-center justify-center flex-shrink-0 text-base">🍽️</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-[13px] font-semibold truncate", r.status === 'skipped' && "line-through")}>{r.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn("px-1.5 py-px rounded text-[8px] font-bold uppercase tracking-wide", MEAL_COLORS[r.mealType] || 'bg-gray-100 text-gray-600')}>{r.mealType}</span>
                            {r.reservationTime && <span className="text-[10px] text-on-surface/35">{r.reservationTime}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {r.status === 'planned' && (
                            <button onClick={() => updateTripRestaurant(selectedTrip.id, r.restaurantId, r.night, { status: 'completed' })}
                              className="w-7 h-7 rounded-full bg-green-50 flex items-center justify-center text-green-500 hover:bg-green-100 transition-colors">
                              <Check size={13} />
                            </button>
                          )}
                          {r.status === 'completed' && (
                            <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                              <Check size={13} className="text-green-600" />
                            </div>
                          )}
                          <button onClick={() => removeRestaurantFromTrip(selectedTrip.id, r.restaurantId, r.night)}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-on-surface/15 hover:text-red-400 hover:bg-red-50 transition-colors">
                            <X size={11} />
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

        {/* ── Share ── */}
        <button
          onClick={() => {
            const n = getNightCount(selectedTrip.startDate, selectedTrip.endDate);
            let text = `🗺️ ${selectedTrip.name} — ${selectedTrip.destination}\n${formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}\n\n`;
            for (let i = 0; i < n; i++) {
              const nightRests = selectedTrip.restaurants.filter((r) => r.night === i).sort((a, b) => (MEAL_ORDER[a.mealType] || 0) - (MEAL_ORDER[b.mealType] || 0));
              if (nightRests.length === 0) continue;
              text += `Night ${i + 1} — ${getNightDate(selectedTrip.startDate, i)}\n`;
              nightRests.forEach((r) => { text += `  ${r.mealType}: ${r.name}${r.reservationTime ? ` (${r.reservationTime})` : ''}\n`; });
              text += '\n';
            }
            if (navigator.share) navigator.share({ text });
            else { navigator.clipboard.writeText(text); alert('Itinerary copied to clipboard!'); }
          }}
          className="w-full py-3 rounded-2xl text-xs font-semibold text-on-surface/35 hover:text-on-surface/50 hover:bg-on-surface/[0.03] transition-colors"
        >
          📋 Share Itinerary
        </button>

        {/* Edit Trip Sheet */}
        <CreateTripSheet
          open={!!editingTrip}
          trip={editingTrip}
          onClose={() => setEditingTrip(null)}
          onSave={(data) => {
            updateTrip(editingTrip!.id, data);
            setEditingTrip(null);
          }}
        />

        {/* Add to Night Sheet */}
        <AddToNightSheet
          open={addNightSheetOpen}
          nightIndex={addNightIndex}
          nightDate={getNightDate(selectedTrip.startDate, addNightIndex)}
          tripId={selectedTrip.id}
          tripLat={selectedTrip.destinationLat}
          tripLng={selectedTrip.destinationLng}
          existingRestaurantIds={new Set(selectedTrip.restaurants.filter((r) => r.night === addNightIndex).map((r) => r.restaurantId))}
          ratings={ratings}
          addRestaurantToTrip={addRestaurantToTrip}
          openAddRestaurantModal={openAddRestaurantModal}
          rateRestaurant={rateRestaurant}
          onClose={() => setAddNightSheetOpen(false)}
        />
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
  const [calendarOpen, setCalendarOpen] = useState<'start' | 'end' | null>(null);

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
      setCalendarOpen(null);
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
            <div className="grid grid-cols-2 gap-3 mb-2">
              <button type="button" onClick={() => setCalendarOpen('start')}
                className={cn("w-full px-3 py-3 rounded-xl border text-left transition-all",
                  startDate ? "bg-primary/5 border-primary/20" : "bg-on-surface/[0.04] border-on-surface/8")}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface/40 mb-1">Start Date</p>
                <div className="flex items-center gap-2">
                  <CalendarDays size={14} className={startDate ? "text-primary" : "text-on-surface/30"} />
                  <span className={cn("text-sm font-medium", startDate ? "text-on-surface" : "text-on-surface/35")}>
                    {startDate ? new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Select date'}
                  </span>
                </div>
              </button>
              <button type="button" onClick={() => setCalendarOpen('end')}
                className={cn("w-full px-3 py-3 rounded-xl border text-left transition-all",
                  endDate ? "bg-primary/5 border-primary/20" : "bg-on-surface/[0.04] border-on-surface/8")}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface/40 mb-1">End Date</p>
                <div className="flex items-center gap-2">
                  <CalendarDays size={14} className={endDate ? "text-primary" : "text-on-surface/30"} />
                  <span className={cn("text-sm font-medium", endDate ? "text-on-surface" : "text-on-surface/35")}>
                    {endDate ? new Date(endDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Select date'}
                  </span>
                </div>
              </button>
            </div>
            {nightCount > 0 && (
              <p className="text-xs text-primary font-semibold mb-4">{nightCount} night{nightCount !== 1 ? 's' : ''}</p>
            )}

            {/* Calendar popup */}
            <AnimatePresence>
              {calendarOpen && (
                <>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/30 z-30" onClick={() => setCalendarOpen(null)} />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 8 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                    className="relative z-40 bg-white rounded-2xl shadow-2xl border border-on-surface/8 p-4 mb-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-serif font-bold text-sm">{calendarOpen === 'start' ? 'Start Date' : 'End Date'}</h3>
                      <button onClick={() => setCalendarOpen(null)} className="p-1 rounded-full hover:bg-on-surface/5">
                        <X size={16} className="text-on-surface/40" />
                      </button>
                    </div>
                    <Calendar
                      value={calendarOpen === 'start' ? startDate : endDate}
                      onChange={(date) => {
                        if (calendarOpen === 'start') {
                          setStartDate(date);
                          if (endDate && date > endDate) setEndDate('');
                        } else {
                          setEndDate(date);
                        }
                        setCalendarOpen(null);
                      }}
                      onClear={() => {
                        if (calendarOpen === 'start') setStartDate('');
                        else setEndDate('');
                        setCalendarOpen(null);
                      }}
                    />
                  </motion.div>
                </>
              )}
            </AnimatePresence>

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
  const [createTripFromList, setCreateTripFromList] = useState(false);
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
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'added'>('highest');

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
    // Exclude special list ratings (e.g. hotel breakfasts) from the main list
    let result = ratings.filter((r) => r.cuisine !== 'Hotel Breakfast');

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

  const regularRatingsCount = useMemo(() => ratings.filter((r) => r.cuisine !== 'Hotel Breakfast').length, [ratings]);
  const regularWishlist = useMemo(() => wishlist.filter((w) => w.cuisine !== 'Hotel Breakfast'), [wishlist]);

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
      ? { ...selectedList, wishlistIds: regularWishlist.map((w) => w.restaurantId) } as CustomList
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
            autoCreate={createTripFromList}
            onAutoCreateHandled={() => setCreateTripFromList(false)}
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
                  onClick={() => setSelectedList({ id: '__wishlist__', name: 'Wishlist', emoji: '❤️', restaurantIds: [], wishlistIds: regularWishlist.map((w) => w.restaurantId), createdAt: 0 } as CustomList)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-red-50 rounded-full border border-red-200 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                >
                  <span className="text-sm">❤️</span>
                  <span className="text-xs font-semibold text-red-500 whitespace-nowrap">Wishlist</span>
                  <span className="text-[10px] text-red-400 font-medium">{regularWishlist.length}</span>
                </button>

                {/* Trips pill — only shown when trips exist */}
                {trips.length > 0 && (
                  <button
                    onClick={() => setShowTrips(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-primary/5 rounded-full border border-primary/20 shadow-sm hover:shadow-md transition-all flex-shrink-0"
                  >
                    <Plane size={13} className="text-primary" />
                    <span className="text-xs font-semibold text-primary whitespace-nowrap">Trips</span>
                    <span className="text-[10px] text-primary/60 font-medium">{trips.length}</span>
                  </button>
                )}

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
            {regularRatingsCount > 0 && (
              <div className="flex items-center gap-4 px-1 mb-3">
                <p className="text-xs text-on-surface/40">
                  <span className="font-bold text-on-surface">{filteredRatings.length}</span>
                  {filteredRatings.length !== regularRatingsCount && ` of ${regularRatingsCount}`} rated
                </p>
                {filteredRatings.length > 0 && (
                  <p className="text-xs text-on-surface/40">
                    Avg: <span className="font-bold text-on-surface">{(filteredRatings.reduce((sum, r) => sum + r.score, 0) / filteredRatings.length).toFixed(1)}</span>/10
                  </p>
                )}
                {regularWishlist.length > 0 && (
                  <p className="text-xs text-on-surface/40">
                    <Heart size={10} className="inline text-red-400 fill-red-400 mr-0.5" />
                    <span className="font-bold text-on-surface">{regularWishlist.length}</span> wishlisted
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
            {regularRatingsCount === 0 && regularWishlist.length === 0 ? (
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
                ) : regularRatingsCount > 0 ? (
                  <div className="text-center py-8">
                    <SlidersHorizontal size={28} className="mx-auto text-on-surface/15 mb-3" />
                    <p className="text-sm font-medium text-on-surface/40">No matches</p>
                    <p className="text-xs text-on-surface/30 mt-1">Try adjusting your filters</p>
                  </div>
                ) : null}

                {/* Wishlist section (global) */}
                {regularWishlist.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 mt-2">
                      <Heart size={14} className="text-red-400 fill-red-400" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Wishlist ({regularWishlist.length})</h3>
                    </div>
                    <div className="space-y-3">
                      {regularWishlist.map((w) => (
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
        onCreateTrip={() => { setShowTrips(true); setCreateTripFromList(true); }}
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
