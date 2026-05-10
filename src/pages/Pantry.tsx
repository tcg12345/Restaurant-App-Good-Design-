import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, ChevronRight, Plus, Trash2, ArrowLeft, ListPlus, MapPin, SlidersHorizontal, X, ChevronDown, Heart, Upload, Search, Check, Edit3, LayoutGrid, List, ArrowUpDown, MoreHorizontal, Download, Plane, StickyNote, CalendarDays, Tag, Image, Loader2, Building2, ChevronLeft, GripVertical, Crown, ChefHat, UtensilsCrossed, Clock, Flame, Users, Hash, FileText, Share2 } from 'lucide-react';
import { ShareRecipeSheet } from '../components/ShareRecipeSheet';
import type { SharedRecipe } from '../contexts/ChatContext';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { formatDuration, formatDurationCompact, getMealCoverUrl, scaleQuantity, extractStepMinutes, StepTimer, PhotoLightbox } from '../lib/recipe-display';
import { getHomeMealReviews, summarizeReviews, type HomeMealReview } from '../lib/supabase-home-meal-reviews';
import { getProfilesByIds, getFriends, type UserProfile } from '../lib/supabase-community';
import { useLists, type CustomList, type PhotoItem, type Trip, type TripRestaurant, type TripHotel, type RestaurantRating, type RestaurantMeta, type HomeMeal } from '../contexts/ListsContext';
import { PhonePantryHome } from '../components/PhonePantryHome';
import { SearchPopup } from '../components/SearchPopup';
import { useSettings } from '../contexts/SettingsContext';
import { usePageSearch } from '../contexts/PageSearchContext';
import { usePageAddAction } from '../contexts/PageAddActionContext';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { searchHotels, searchPlacesByText, extractCityState, formatLocationLabel, fetchLocationDataForPlace, type PlaceResult } from '../lib/places';
import { getCuisineLabel } from './useRestaurantDetail';
import { useAuth } from '../contexts/AuthContext';
import { getHotelDining, type HotelDining } from '../lib/supabase-community';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, Calendar } from '../components/RatingShared';
import { loadLastSelectedLocation } from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';

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
type CreateListKind = 'restaurants' | 'recipes';

const CreateListSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, emoji: string, type?: PresetList['type']) => void;
  existingListNames: string[];
  onCreateTrip?: () => void;
  /**
   * Controls which presets are offered and what `type` a custom list is
   * created with. 'restaurants' (default) hides the home-cooking preset
   * since recipe lists live on the Recipes tab; 'recipes' filters the
   * preset list to home-cooking and tags any custom list created here as
   * type='home-cooking' so it appears under Recipes.
   */
  kind?: CreateListKind;
}> = ({ open, onClose, onCreate, existingListNames, onCreateTrip, kind = 'restaurants' }) => {
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'browse' | 'custom'>('browse');
  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('📋');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const existingNamesLower = useMemo(() => new Set(existingListNames.map((n) => n.toLowerCase())), [existingListNames]);

  const presetsForKind = useMemo(
    () => kind === 'recipes'
      // Recipes tab: only show the home-cooking preset(s).
      ? PRESET_LISTS.filter((p) => p.type === 'home-cooking')
      // Restaurants tab: hide home-cooking — those belong to the
      // Recipes tab now.
      : PRESET_LISTS.filter((p) => p.type !== 'home-cooking'),
    [kind],
  );

  const categoriesForKind = useMemo(
    () => Array.from(new Set(presetsForKind.map((p) => p.category))),
    [presetsForKind],
  );

  const filteredPresets = useMemo(() => {
    let list = presetsForKind;
    if (selectedCategory) list = list.filter((p) => p.category === selectedCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    return list;
  }, [search, selectedCategory, presetsForKind]);

  const groupedPresets = useMemo(() => {
    const groups: Record<string, PresetList[]> = {};
    for (const preset of filteredPresets) {
      if (!groups[preset.category]) groups[preset.category] = [];
      groups[preset.category].push(preset);
    }
    return groups;
  }, [filteredPresets]);

  const handleSelectPreset = (preset: PresetList) => { onCreate(preset.name, preset.emoji, preset.type); handleClose(); };
  const handleCreateCustom = () => {
    if (!customName.trim()) return;
    // For the Recipes tab, tag a freshly created custom list with
    // type='home-cooking' so it shows up under Recipes and uses the
    // recipe-list rendering path in ListDetailView.
    onCreate(customName.trim(), customEmoji, kind === 'recipes' ? 'home-cooking' : undefined);
    handleClose();
  };
  const handleClose = () => { setSearch(''); setMode('browse'); setCustomName(''); setCustomEmoji('📋'); setSelectedCategory(null); onClose(); };

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
              <h2 className="font-serif font-bold text-lg">
                {mode === 'browse'
                  ? kind === 'recipes' ? 'New Recipe List' : 'New List'
                  : kind === 'recipes' ? 'Create Custom Recipe List' : 'Create Custom List'}
              </h2>
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
                {/* Category tab row */}
                <div className="pb-3 flex-shrink-0">
                  <div className="flex gap-1 overflow-x-auto px-5 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors",
                        selectedCategory === null ? "bg-primary text-white" : "bg-transparent text-on-surface/50 hover:text-on-surface/70")}
                    >
                      All
                    </button>
                    {categoriesForKind.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors",
                          selectedCategory === cat ? "bg-primary text-white" : "bg-transparent text-on-surface/50 hover:text-on-surface/70")}
                      >
                        {cat}
                      </button>
                    ))}
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
                  {onCreateTrip && kind === 'restaurants' && (
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
                    categoriesForKind.filter((cat) => groupedPresets[cat]).map((category) => (
                      <div key={category} className="mb-6">
                        <h3 className="font-serif font-bold text-base text-on-surface/80 mb-2 px-1">{category}</h3>
                        <div className="divide-y divide-on-surface/[0.06]">
                          {groupedPresets[category].map((preset) => {
                            const alreadyExists = existingNamesLower.has(preset.name.toLowerCase());
                            return (
                              <button key={preset.name} onClick={() => !alreadyExists && handleSelectPreset(preset)} disabled={alreadyExists}
                                className={cn("w-full flex items-center gap-3 py-3 px-1 transition-colors text-left",
                                  alreadyExists ? "opacity-40 cursor-not-allowed" : "hover:bg-on-surface/[0.03] active:bg-primary/5")}>
                                <span className="text-xl flex-shrink-0">{preset.emoji}</span>
                                <span className="text-sm font-medium flex-1 truncate text-on-surface">{preset.name}</span>
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

// Backfill location data on saved restaurants so cards can render the
// Beli-style "Neighborhood, Borough" / "Neighborhood, City, ST" label.
// One Places call (deduped via inflight + cache) gives us the address
// components; one Mapbox reverse-geocode gives us the neighborhood
// (Google rarely returns neighborhood components). Once written to the
// shared restaurantMeta, every card using that meta upgrades to the
// richer label automatically.
function useBackfillLocationComponents(restaurantId: string, hasFullData: boolean) {
  const { cacheRestaurantMeta } = useLists();
  useEffect(() => {
    if (!restaurantId || hasFullData) return;
    let cancelled = false;
    fetchLocationDataForPlace(restaurantId).then(({ addressComponents, neighborhood, lat, lng }) => {
      if (cancelled) return;
      // Skip the meta write if both fields are empty so we don't
      // pointlessly bump the cache.
      if (!addressComponents?.length && !neighborhood && lat == null && lng == null) return;
      cacheRestaurantMeta({
        id: restaurantId,
        ...(addressComponents?.length ? { addressComponents } : {}),
        ...(neighborhood ? { neighborhood } : {}),
        ...(lat != null ? { lat } : {}),
        ...(lng != null ? { lng } : {}),
      });
    });
    return () => { cancelled = true; };
  }, [restaurantId, hasFullData, cacheRestaurantMeta]);
}

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
  const { phoneMode } = useSettings();
  const { restaurantMeta } = useLists();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swiped, setSwiped] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [isDragging, setIsDragging] = useState(false);

  // Resolve a "City, ST" / "City, Country" label from the address. Use the
  // Beli-style hierarchical label — neighborhood + borough/city + state
  // when address components are cached, falls back to formatted-address
  // parsing for older saved restaurants.
  const meta = restaurantMeta[restaurantId];
  useBackfillLocationComponents(restaurantId, !!meta?.addressComponents && meta?.neighborhood !== undefined);
  const location = address || meta?.address
    ? formatLocationLabel(meta?.addressComponents, address || meta?.address || '', meta?.neighborhood)
    : '';

  // Distance from the user's anchor location to the cached coords for
  // this place (populated by useRestaurantDetail). Renders inline next
  // to the city when available; otherwise the city stands alone.
  const distanceLabel = useMemo(() => {
    const home = loadLastSelectedLocation();
    if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return '';
    if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lng)) return '';
    return formatDistance(haversineDistanceMi(home.lat, home.lng, meta.lat!, meta.lng!));
  }, [meta?.lat, meta?.lng]);

  const handleDelete = () => {
    if (onRemove) {
      setDismissed(true);
      setTimeout(() => onRemove(), 300);
    }
  };

  if (dismissed) return null;

  // Total width for swipe-revealed action buttons (Edit + Delete side by side)
  const hasEdit = !!onEdit;
  const hasRemove = !!onRemove;
  const actionCount = (hasEdit ? 1 : 0) + (hasRemove ? 1 : 0);
  const revealWidth = actionCount * 64;

  return (
    <div className="relative">
      {/* Swipe-revealed action buttons (underneath) — Edit + Delete */}
      {phoneMode && actionCount > 0 && (swiped || isDragging) && (
        <div
          className="absolute inset-y-0 right-0 flex items-stretch"
          style={{ width: revealWidth }}
        >
          {hasEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); setSwiped(false); onEdit?.(); }}
              className="w-16 flex flex-col items-center justify-center gap-0.5 bg-blue-500 text-white active:bg-blue-600 transition-colors"
              aria-label="Edit"
            >
              <Edit3 size={16} />
              <span className="text-[10px] font-semibold">Edit</span>
            </button>
          )}
          {hasRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              className="w-16 flex flex-col items-center justify-center gap-0.5 bg-red-500 text-white active:bg-red-600 transition-colors"
              aria-label="Delete"
            >
              <Trash2 size={16} />
              <span className="text-[10px] font-semibold">Delete</span>
            </button>
          )}
        </div>
      )}

      <motion.div
        drag={phoneMode && actionCount > 0 ? 'x' : false}
        dragConstraints={{ left: -revealWidth - 20, right: 0 }}
        dragElastic={0.1}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(_: any, info: any) => {
          setTimeout(() => setIsDragging(false), 50);
          if (info.offset.x < -revealWidth / 2) setSwiped(true);
          else setSwiped(false);
        }}
        animate={{ x: swiped ? -revealWidth : 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        style={{ touchAction: 'pan-y' }}
        className="relative z-10 bg-surface"
      >
        <Link
          to={`/restaurant/${restaurantId}`}
          className="block group"
          onClick={(e) => {
            if (isDragging || swiped) {
              e.preventDefault();
              if (swiped) setSwiped(false);
            }
          }}
        >
          <div className="flex items-start gap-3 py-3 active:scale-[0.99] transition-transform">
            {/* Image thumbnail — only when there's an actual photo. The
                no-image monogram tile is intentionally gone so the row
                stays clean and lets the location read as its own line. */}
            {image && (
              <div className="w-14 h-14 rounded-lg overflow-hidden bg-on-surface/[0.05] flex-shrink-0 flex items-center justify-center">
                <img src={image} alt={name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" referrerPolicy="no-referrer" />
              </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif font-bold text-[15px] leading-tight truncate">{name}</h3>
                  <p className="mt-0.5 text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider truncate">
                    {cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine}{cuisine !== 'Hotel Breakfast' && price ? ` · ${price}` : ''}
                  </p>
                  {location && (
                    <p className="mt-1 text-[12.5px] text-on-surface/55 font-medium truncate">
                      {location}{distanceLabel ? ` · ${distanceLabel}` : ''}
                    </p>
                  )}
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
                      <Edit3 size={14} />
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
                <div className="flex flex-wrap gap-1 mt-1.5">
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

      {/* Desktop delete confirmation */}
      {confirmDelete && (
        <div className="absolute inset-0 z-20 bg-surface/95 backdrop-blur-sm rounded-2xl flex items-center justify-center gap-3">
          <p className="text-xs text-on-surface/60 font-medium">Delete this restaurant?</p>
          <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 bg-on-surface/[0.06] rounded-lg hover:bg-on-surface/10">Cancel</button>
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
  /** Full address — derives the city + distance line under cuisine. */
  address?: string;
  notes?: string;
  onRemove?: () => void;
}> = ({ restaurantId, name, image, cuisine, price, address, notes, onRemove }) => {
  const { restaurantMeta } = useLists();

  // Beli-style label: neighborhood + borough/city + state, falling back
  // to formatted-address parsing when no addressComponents are cached.
  const wlMeta = restaurantMeta[restaurantId];
  useBackfillLocationComponents(restaurantId, !!wlMeta?.addressComponents && wlMeta?.neighborhood !== undefined);
  const fullAddr = address || wlMeta?.address || '';
  const location = fullAddr ? formatLocationLabel(wlMeta?.addressComponents, fullAddr, wlMeta?.neighborhood) : '';

  // Distance from the user's anchor location.
  const distanceLabel = useMemo(() => {
    const home = loadLastSelectedLocation();
    if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return '';
    if (!wlMeta || !Number.isFinite(wlMeta.lat) || !Number.isFinite(wlMeta.lng)) return '';
    return formatDistance(haversineDistanceMi(home.lat, home.lng, wlMeta.lat!, wlMeta.lng!));
  }, [wlMeta?.lat, wlMeta?.lng]);

  return (
    <div className="flex items-start gap-3 py-3 group">
      {/* Image thumbnail — only when an actual photo exists. The
          monogram tile that used to render with no image is gone so the
          row stays clean and the location can read as its own line. */}
      {image && (
        <Link
          to={`/restaurant/${restaurantId}`}
          className="w-14 h-14 rounded-lg overflow-hidden bg-on-surface/[0.05] flex-shrink-0 flex items-center justify-center block"
        >
          <img src={image} alt={name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" referrerPolicy="no-referrer" />
        </Link>
      )}
      <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">
        <div>
          <Link to={`/restaurant/${restaurantId}`}>
            <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">{name}</h3>
          </Link>
          <p className="text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
            {cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine}{cuisine !== 'Hotel Breakfast' && price ? ` · ${price}` : ''}
          </p>
          {location && (
            <p className="mt-1 text-[12.5px] text-on-surface/55 font-medium truncate">
              {location}{distanceLabel ? ` · ${distanceLabel}` : ''}
            </p>
          )}
          {notes && (
            <p className="text-[11px] text-on-surface/45 mt-1 line-clamp-2 italic">&ldquo;{notes}&rdquo;</p>
          )}
        </div>
        {onRemove && (
          <div className="flex justify-end mt-1.5">
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

/* ── Wishlist grid card (desktop) ────────────────────────────────────
   Airy editorial tile: white surface, big serif name, filled-heart pip
   in the top-right (also the remove control), CUISINE·PRICE under the
   name, intentionally empty middle for breathing room, and a footer
   line with the street address + distance. Hover lifts the card. ── */
const WishlistGridCard: React.FC<{
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address?: string;
  notes?: string;
  onRemove?: () => void;
}> = ({ restaurantId, name, cuisine, price, address, onRemove }) => {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { restaurantMeta } = useLists();
  const cuisineLabel = cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine;
  const showPrice = cuisine !== 'Hotel Breakfast' && !!price;

  const meta = restaurantMeta[restaurantId];
  useBackfillLocationComponents(restaurantId, !!meta?.addressComponents && meta?.neighborhood !== undefined);
  const fullAddress = address || meta?.address || '';
  // Beli-style hierarchical label using Google's address components plus
  // Mapbox-derived neighborhood when available; falls back to
  // formatted-address parsing for older saved restaurants. Renders as
  // "West Village, Manhattan", "Mission, San Francisco, CA", "Stowe,
  // VT", etc.
  const streetCity = useMemo(
    () => fullAddress ? formatLocationLabel(meta?.addressComponents, fullAddress, meta?.neighborhood) : '',
    [fullAddress, meta?.addressComponents, meta?.neighborhood],
  );
  const distanceLabel = useMemo(() => {
    const home = loadLastSelectedLocation();
    if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return '';
    if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lng)) return '';
    return formatDistance(haversineDistanceMi(home.lat, home.lng, meta.lat!, meta.lng!));
  }, [meta?.lat, meta?.lng]);

  return (
    <div className="group relative">
      <Link
        to={`/restaurant/${restaurantId}`}
        className={cn(
          'block rounded-2xl bg-white border border-on-surface/[0.07]',
          'p-5 transition-all duration-200',
          'hover:border-on-surface/15 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.16)] hover:-translate-y-px',
          'flex flex-col min-h-[230px]',
        )}
      >
        {/* Top row: name + heart pip (also the remove control) */}
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-serif font-bold text-[22px] leading-tight tracking-tight text-on-surface line-clamp-2 min-w-0">
            {name}
          </h3>
          {onRemove ? (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmRemove(true); }}
              aria-label="Remove from wishlist"
              title="Remove from wishlist"
              className="flex-shrink-0 w-8 h-8 rounded-full bg-red-50 text-red-400 flex items-center justify-center hover:bg-red-100 active:scale-95 transition-all"
            >
              <Heart size={15} className="fill-red-400" />
            </button>
          ) : (
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-red-50 text-red-400 flex items-center justify-center">
              <Heart size={15} className="fill-red-400" />
            </span>
          )}
        </div>

        {/* Cuisine · price */}
        {(cuisineLabel || showPrice) && (
          <p className="mt-1 text-[11px] text-on-surface/45 font-semibold uppercase tracking-[0.14em]">
            {cuisineLabel}
            {cuisineLabel && showPrice ? ' · ' : ''}
            {showPrice && price}
          </p>
        )}

        {/* Spacer pushes the footer to the bottom of the tile */}
        <div className="flex-1" />

        {/* Footer: pin + location (allowed to wrap to two lines so the
            full "Neighborhood, City, ST" doesn't get cut off), then a
            second muted line for the distance when we have one. */}
        <div className="text-[12.5px] text-on-surface/55">
          <div className="flex items-start gap-1.5 min-w-0">
            <MapPin size={13} className="flex-shrink-0 text-on-surface/40 mt-[2px]" />
            <span className="line-clamp-2 leading-snug">{streetCity || 'Location unavailable'}</span>
          </div>
          {distanceLabel && (
            <p className="mt-1 pl-[20px] tabular-nums text-on-surface/45">{distanceLabel}</p>
          )}
        </div>
      </Link>

      {confirmRemove && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 p-4">
          <p className="text-sm text-on-surface/70 font-medium text-center">Remove from wishlist?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmRemove(false)} className="px-4 py-2 text-xs font-semibold text-on-surface/55 bg-on-surface/[0.06] rounded-lg hover:bg-on-surface/10">Cancel</button>
            <button onClick={() => { if (onRemove) onRemove(); }} className="px-4 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Remove</button>
          </div>
        </div>
      )}
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
  /** Full address — used to derive "City, State" for the footer. */
  address?: string;
  /** User's notes / quote for this rating — rendered as italic text. */
  notes?: string;
  onEdit?: () => void;
  onRemove?: () => void;
}> = ({ restaurantId, name, image, cuisine, price, score, address, notes, onEdit, onRemove }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const { restaurantMeta } = useLists();
  const hasScore = score !== undefined && score > 0;
  const cuisineLabel = cuisine === 'Hotel Breakfast' ? 'Hotel' : cuisine;
  const showPrice = cuisine !== 'Hotel Breakfast' && !!price;

  // Resolve city/state for the footer line. Prefer the explicit address
  // prop (from the rating record) and fall back to whatever's cached on
  // the meta entry — that way we still show a location for restaurants
  // re-hydrated from cloud where the rating may not include an address.
  const meta = restaurantMeta[restaurantId];
  useBackfillLocationComponents(restaurantId, !!meta?.addressComponents && meta?.neighborhood !== undefined);
  const fullAddress = address || meta?.address || '';
  // Hierarchical Beli-style label — neighborhood + borough/city + state
  // when components are cached, falling back to the formatted address.
  const locationLabel = fullAddress
    ? formatLocationLabel(meta?.addressComponents, fullAddress, meta?.neighborhood)
    : '';

  // Distance in miles from the user's anchor location to the cached
  // place coordinates. Only renders when we have both, otherwise the
  // footer just shows the city.
  const distanceLabel = useMemo(() => {
    const home = loadLastSelectedLocation();
    if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return '';
    if (!meta || !Number.isFinite(meta.lat) || !Number.isFinite(meta.lng)) return '';
    return formatDistance(haversineDistanceMi(home.lat, home.lng, meta.lat!, meta.lng!));
  }, [meta?.lat, meta?.lng]);

  // Close the more menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  // ── No-image variant ──────────────────────────────────────────────
  // Same airy editorial tile as the wishlist card, just with the
  // numeric score in the top-right slot instead of a heart pip. Big
  // serif name, CUISINE·PRICE, breathing-room middle, footer with the
  // street address + distance. Edit / more controls fade in on hover.
  if (!image) {
    // Display label uses the same Beli-style helper as the rest of the
    // app — "Neighborhood, Borough" / "Neighborhood, City, ST" /
    // "City, ST" depending on what address components are cached.
    const streetCity = locationLabel;

    return (
      <div className="group relative">
        <Link
          to={`/restaurant/${restaurantId}`}
          className={cn(
            'block rounded-2xl bg-white border border-on-surface/[0.07]',
            'p-5 transition-all duration-200',
            'hover:border-on-surface/15 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.16)] hover:-translate-y-px',
            'flex flex-col min-h-[230px]',
          )}
        >
          {/* Top row: name + score */}
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-serif font-bold text-[22px] leading-tight tracking-tight text-on-surface line-clamp-2 min-w-0">
              {name}
            </h3>
            {hasScore && (
              <span className={cn(
                'font-serif font-bold tabular-nums leading-none text-[28px] flex-shrink-0',
                scoreColor(score!),
              )}>
                {score!.toFixed(1)}
              </span>
            )}
          </div>

          {/* Cuisine · price */}
          {(cuisineLabel || showPrice) && (
            <p className="mt-1 text-[11px] text-on-surface/45 font-semibold uppercase tracking-[0.14em]">
              {cuisineLabel}
              {cuisineLabel && showPrice ? ' · ' : ''}
              {showPrice && price}
            </p>
          )}

          {/* Spacer pushes the footer to the bottom of the tile */}
          <div className="flex-1" />

          {/* Footer: pin + location (line-clamp 2 so the full Beli-style
              label is never cut off), then a second line with the
              distance label and the hover-revealed action icons. */}
          <div className="text-[12.5px] text-on-surface/55">
            <div className="flex items-start gap-1.5 min-w-0">
              <MapPin size={13} className="flex-shrink-0 text-on-surface/40 mt-[2px]" />
              <span className="line-clamp-2 leading-snug">{streetCity || 'Location unavailable'}</span>
            </div>
            <div className="mt-1 pl-[20px] flex items-center justify-between gap-2 min-h-[28px]">
              {distanceLabel ? (
                <span className="tabular-nums text-on-surface/45">{distanceLabel}</span>
              ) : <span />}
              {(onEdit || onRemove) && (
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {onEdit && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                      aria-label="Edit"
                      className="w-7 h-7 rounded-full text-on-surface/35 hover:text-primary hover:bg-primary/[0.06] flex items-center justify-center transition-colors"
                    >
                      <Edit3 size={13} />
                    </button>
                  )}
                  {onRemove && (
                    <div className="relative" ref={moreRef}>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMoreOpen((v) => !v); }}
                        aria-label="More options"
                        aria-haspopup="menu"
                        aria-expanded={moreOpen}
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center transition-colors',
                          moreOpen
                            ? 'text-on-surface bg-on-surface/[0.06]'
                            : 'text-on-surface/35 hover:text-on-surface hover:bg-on-surface/[0.05]',
                        )}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      <AnimatePresence>
                        {moreOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                            role="menu"
                            className="absolute right-0 bottom-full mb-1.5 z-30 min-w-[140px] rounded-xl bg-white border border-on-surface/[0.08] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.2)] py-1 overflow-hidden"
                          >
                            <button
                              role="menuitem"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMoreOpen(false); setConfirmDelete(true); }}
                              className="w-full px-3 py-2 text-left text-[13px] font-semibold text-red-500 hover:bg-red-50 flex items-center gap-2"
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Link>

        {confirmDelete && (
          <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 p-4">
            <p className="text-sm text-on-surface/70 font-medium text-center">Delete this restaurant?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 text-xs font-semibold text-on-surface/55 bg-on-surface/[0.06] rounded-lg hover:bg-on-surface/10">Cancel</button>
              <button onClick={() => { if (onRemove) onRemove(); }} className="px-4 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── With-image variant (existing layout) ──────────────────────────
  return (
    <div className="group relative">
      <Link to={`/restaurant/${restaurantId}`} className="block aspect-[4/3] overflow-hidden rounded-2xl bg-on-surface/[0.05]">
        <img src={image} alt={name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" referrerPolicy="no-referrer" />
      </Link>
      <div className="pt-2.5 pb-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/restaurant/${restaurantId}`} className="min-w-0 flex-1">
            <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">{name}</h3>
          </Link>
          <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5">
            {hasScore && (
              <span className={cn("text-base font-serif font-bold", scoreColor(score!))}>{score!.toFixed(1)}</span>
            )}
            {onEdit && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                className="p-1 text-on-surface/30 hover:text-primary rounded-lg transition-colors"><Edit3 size={12} /></button>
            )}
            {onRemove && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }}
                className="p-1 text-on-surface/20 hover:text-red-500 rounded-lg transition-colors"><Trash2 size={12} /></button>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
          {cuisineLabel}{cuisineLabel && showPrice ? ' · ' : ''}{showPrice && price}
        </p>
      </div>
      {confirmDelete && (
        <div className="absolute inset-0 z-20 bg-surface/95 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-2 p-3">
          <p className="text-xs text-on-surface/60 font-medium text-center">Delete this restaurant?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 bg-on-surface/[0.06] rounded-lg hover:bg-on-surface/10">Cancel</button>
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
  const scoreClr = scoreColorLight(score);
  const scoreBg = scoreBgGradient(score);
  const scoreRing = scoreRingColor(score);
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
                        <div className={cn("text-4xl sm:text-5xl font-serif font-bold tabular-nums transition-colors duration-300", scoreClr)}>{score.toFixed(1)}</div>
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
                    <div className="divide-y divide-on-surface/[0.06]">
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
  const { phoneMode } = useSettings();
  const { setScopedSearch, scopedSearch, bumpFocus } = usePageSearch();
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

  // ── Scoped header search (desktop only) ──
  // Click "Search this list" → hijack the desktop header input as a
  // filter for this list. Mirrors the rated-view pattern in <Pantry>.
  // We tag the scope with the list id so the keep-in-sync effect below
  // doesn't fight with sibling scopes from other components.
  const scopeName = isWishlistView ? 'Wishlist' : list.name;
  const scopeKey = `list:${list.id}`;
  const activateListScope = useCallback(() => {
    setScopedSearch({
      scopeName,
      placeholder: `Search ${scopeName.toLowerCase()}…`,
      query: searchQuery,
      setQuery: setSearchQuery,
      onDismiss: () => setSearchQuery(''),
    });
    bumpFocus();
  }, [scopeName, searchQuery, setScopedSearch, bumpFocus]);

  // Keep header chip + input value in lockstep with searchQuery without
  // looping. Only pages that own the active scope re-set it.
  useEffect(() => {
    if (scopedSearch && scopedSearch.scopeName === scopeName && scopedSearch.query !== searchQuery) {
      setScopedSearch({ ...scopedSearch, query: searchQuery });
    }
  }, [searchQuery, scopedSearch, scopeName, setScopedSearch]);

  // Drop the scope when the list unmounts (user backed out / picked
  // another list) so a stale chip doesn't carry over.
  useEffect(() => {
    return () => { setScopedSearch(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // ── Wishlist-only filter state ─────────────────────────────────────
  // Lives on ListView (not the global page) so the sheet's selections
  // reset cleanly when the user closes the view.
  const [wishlistFilterOpen, setWishlistFilterOpen] = useState(false);
  const [wishlistSort, setWishlistSort] = useState<WishlistSort>('recent');
  const [wishlistCuisineFilter, setWishlistCuisineFilter] = useState<string[]>([]);
  const [wishlistCityFilter, setWishlistCityFilter] = useState<string[]>([]);
  const [wishlistPriceFilter, setWishlistPriceFilter] = useState<string | null>(null);
  // Per-pill dropdowns now live inside <AnchoredPill> on desktop, so
  // each pill manages its own open state. The shared open/close state
  // that used to coordinate sibling sheets is no longer needed.
  const wlSortLabels: Record<WishlistSort, string> = {
    recent: 'Recent', oldest: 'Oldest', 'name-asc': 'Name A→Z', 'name-desc': 'Name Z→A',
  };
  const toggleWlCity = (c: string) =>
    setWishlistCityFilter((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  const toggleWlCuisine = (c: string) =>
    setWishlistCuisineFilter((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  const wishlistActiveFilterCount =
    (wishlistCuisineFilter.length > 0 ? 1 : 0) +
    (wishlistCityFilter.length > 0 ? 1 : 0) +
    (wishlistPriceFilter ? 1 : 0);
  const resetWishlistFilters = () => {
    setWishlistCuisineFilter([]);
    setWishlistCityFilter([]);
    setWishlistPriceFilter(null);
    setWishlistSort('recent');
  };

  const recipes = getRecipes(list.id);
  const filteredRecipes = useMemo(() => {
    if (!searchQuery.trim()) return recipes;
    const q = searchQuery.toLowerCase();
    return recipes.filter((r) => r.title.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)));
  }, [recipes, searchQuery]);

  const ratedRestaurantsRaw = list.restaurantIds.map((id) => {
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
  // Filtered version that the toolbar's City/Cuisine/Price pills also
  // narrow down. The same wishlist* filter state is reused (the names
  // are historical — they apply to any non-recipe list view now).
  const ratedRestaurants = useMemo(() => {
    if (isWishlistView || isHomeCooking) return ratedRestaurantsRaw;
    let out = ratedRestaurantsRaw;
    if (wishlistCuisineFilter.length > 0) {
      out = out.filter(({ info }) => info?.cuisine && wishlistCuisineFilter.includes(info.cuisine));
    }
    if (wishlistCityFilter.length > 0) {
      out = out.filter(({ info }) => {
        const c = extractCityState(info?.address || '', info?.address || '');
        return c && wishlistCityFilter.includes(c);
      });
    }
    if (wishlistPriceFilter) {
      out = out.filter(({ info }) => info?.price === wishlistPriceFilter);
    }
    return out;
  }, [isWishlistView, isHomeCooking, ratedRestaurantsRaw, wishlistCuisineFilter, wishlistCityFilter, wishlistPriceFilter]);

  const wishlistedRestaurantsRaw = isHotelBreakfast
    ? wishlist.filter((w) => w.cuisine === 'Hotel Breakfast').map((w) => ({
        id: w.restaurantId,
        info: getRestaurantInfo(w.restaurantId) || { id: w.restaurantId, name: w.name, image: w.image, cuisine: w.cuisine, price: w.price, address: w.address },
        wishItem: w,
      }))
    : isWishlistView
      // Drive the global wishlist view directly off the wishlist array so
      // recently-toggled hearts show up immediately, in the order the user
      // added them. The synthetic list only has wishlistIds, which loses
      // the addedAt timestamp we need for sort.
      ? wishlist.filter((w) => w.cuisine !== 'Hotel Breakfast').map((w) => ({
          id: w.restaurantId,
          info: getRestaurantInfo(w.restaurantId) || { id: w.restaurantId, name: w.name, image: w.image, cuisine: w.cuisine, price: w.price, address: w.address },
          wishItem: w,
        }))
      : (list.wishlistIds || []).map((id) => {
          const info = getRestaurantInfo(id);
          const wishItem = wishlist.find((w) => w.restaurantId === id);
          return { id, info, wishItem };
        }).filter(({ info }) => info);

  // Filter + sort options pulled from the list's actual contents, so
  // the dropdowns only ever offer cuisines / cities the user has on
  // this list. Recipe lists skip this — they have their own filters.
  // The names are historical (they used to be wishlist-only); they now
  // apply to any non-recipe list view (wishlist + custom restaurant +
  // hotel-breakfast).
  const wishlistAllCuisines = useMemo(() => {
    if (isHomeCooking) return [] as string[];
    const set = new Set<string>();
    wishlistedRestaurantsRaw.forEach(({ info }) => { if (info?.cuisine) set.add(info.cuisine); });
    ratedRestaurantsRaw.forEach(({ info }) => { if (info?.cuisine) set.add(info.cuisine); });
    return Array.from(set).sort();
  }, [isHomeCooking, wishlistedRestaurantsRaw, ratedRestaurantsRaw]);
  const wishlistAllCities = useMemo(() => {
    if (isHomeCooking) return [] as string[];
    const set = new Set<string>();
    wishlistedRestaurantsRaw.forEach(({ info }) => {
      const c = extractCityState(info?.address || '', info?.address || '');
      if (c) set.add(c);
    });
    ratedRestaurantsRaw.forEach(({ info }) => {
      const c = extractCityState(info?.address || '', info?.address || '');
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [isHomeCooking, wishlistedRestaurantsRaw, ratedRestaurantsRaw]);

  const wishlistedRestaurants = useMemo(() => {
    if (isHomeCooking) return wishlistedRestaurantsRaw;
    let out = wishlistedRestaurantsRaw;
    if (wishlistCuisineFilter.length > 0) {
      out = out.filter(({ info }) => info?.cuisine && wishlistCuisineFilter.includes(info.cuisine));
    }
    if (wishlistCityFilter.length > 0) {
      out = out.filter(({ info }) => {
        const c = extractCityState(info?.address || '', info?.address || '');
        return c && wishlistCityFilter.includes(c);
      });
    }
    if (wishlistPriceFilter) {
      out = out.filter(({ info }) => info?.price === wishlistPriceFilter);
    }
    const sorted = [...out];
    sorted.sort((a, b) => {
      switch (wishlistSort) {
        case 'oldest': return (a.wishItem?.addedAt ?? 0) - (b.wishItem?.addedAt ?? 0);
        case 'name-asc': return (a.info?.name || '').localeCompare(b.info?.name || '');
        case 'name-desc': return (b.info?.name || '').localeCompare(a.info?.name || '');
        case 'recent':
        default: return (b.wishItem?.addedAt ?? 0) - (a.wishItem?.addedAt ?? 0);
      }
    });
    return sorted;
  }, [isHomeCooking, wishlistedRestaurantsRaw, wishlistCuisineFilter, wishlistCityFilter, wishlistPriceFilter, wishlistSort]);

  // Apply the search input on top of the filter pipeline (wishlist view
  // only — the rated and hotel-breakfast paths already filter above).
  const wishlistedRestaurantsFinal = useMemo(() => {
    if (!isWishlistView || !searchQuery.trim()) return wishlistedRestaurants;
    const q = searchQuery.toLowerCase();
    return wishlistedRestaurants.filter(({ info }) =>
      (info?.name || '').toLowerCase().includes(q) ||
      (info?.cuisine || '').toLowerCase().includes(q) ||
      (info?.address || '').toLowerCase().includes(q),
    );
  }, [isWishlistView, wishlistedRestaurants, searchQuery]);

  const totalCount = isHomeCooking
    ? recipes.length
    : isWishlistView
      ? wishlistedRestaurantsRaw.length
      : list.restaurantIds.length + (list.wishlistIds?.length || 0);

  const handlePlusClick = () => {
    if (isHomeCooking) openAddRecipeModal(list.id);
    else if (isHotelBreakfast) setHotelModalOpen(true);
    else setAddSheetOpen(true);
  };

  // ── Editorial header derivations ──────────────────────────────────
  // The four list "kinds" each get their own accent color, eyebrow,
  // and icon so the page title row reads as a cover for that list.
  const headerVariant: {
    eyebrow: string;
    icon: React.ReactNode;
    accent: string; // text class
    chipBg: string; // bg class for the icon tile
  } = isHomeCooking
    ? { eyebrow: 'Your kitchen', icon: <ChefHat size={26} className="text-emerald-600" strokeWidth={1.7} />, accent: 'text-emerald-600', chipBg: 'bg-emerald-50' }
    : isHotelBreakfast
      ? { eyebrow: 'Hotel mornings', icon: <Building2 size={26} className="text-amber-600" strokeWidth={1.7} />, accent: 'text-amber-600', chipBg: 'bg-amber-50' }
      : isWishlistView
        ? { eyebrow: 'Your saved places', icon: <Heart size={24} className="text-red-400 fill-red-400" />, accent: 'text-red-400', chipBg: 'bg-red-50' }
        : { eyebrow: 'Your collection', icon: <span className="text-2xl leading-none">{list.emoji}</span>, accent: 'text-primary', chipBg: 'bg-primary/8' };

  // Distinct city count for the stats row.
  const cityCount = useMemo(() => {
    const set = new Set<string>();
    const items = isWishlistView
      ? wishlistedRestaurantsRaw.map(({ info }) => info?.address || '')
      : ratedRestaurants.map(({ info }) => info?.address || '');
    for (const a of items) {
      const c = extractCityState(a, a);
      if (c) set.add(c);
    }
    return set.size;
  }, [isWishlistView, ratedRestaurants, wishlistedRestaurantsRaw]);

  // "Updated X ago" — most recent addedAt (wishlist) or createdAt (ratings).
  const lastUpdated = useMemo(() => {
    let max = 0;
    if (isWishlistView) {
      for (const { wishItem } of wishlistedRestaurantsRaw) {
        if (wishItem?.addedAt && wishItem.addedAt > max) max = wishItem.addedAt;
      }
    } else if (isHomeCooking) {
      for (const r of recipes) if (r.createdAt > max) max = r.createdAt;
    } else {
      for (const { rating } of ratedRestaurants) {
        if (rating?.createdAt && rating.createdAt > max) max = rating.createdAt;
      }
    }
    if (max === 0) return '';
    const days = Math.floor((Date.now() - max) / 86400000);
    if (days < 1) return 'Updated today';
    if (days === 1) return 'Updated yesterday';
    if (days < 7) return `Updated ${days} days ago`;
    if (days < 14) return 'Updated last week';
    if (days < 60) return `Updated ${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `Updated ${Math.floor(days / 30)} months ago`;
    return `Updated ${Math.floor(days / 365)} year${days >= 730 ? 's' : ''} ago`;
  }, [isWishlistView, isHomeCooking, ratedRestaurants, wishlistedRestaurantsRaw, recipes]);

  // ── Quick-filter pills ────────────────────────────────────────────
  // Wishlist view derives its pill row from the actual saved places,
  // showing the top cities, prices, and cuisines so the user can narrow
  // the grid in one click. Tapping a pill toggles it on the existing
  // wishlist filter state. The "Filters" pill opens the full sheet.
  const quickFilterPills = useMemo(() => {
    if (!isWishlistView) return [] as Array<{ key: string; label: string; count: number; kind: 'city' | 'price' | 'cuisine'; active: boolean; onClick: () => void }>;
    const items = wishlistedRestaurantsRaw;
    const cityCounts = new Map<string, number>();
    const priceCounts = new Map<string, number>();
    const cuisineCounts = new Map<string, number>();
    for (const { info } of items) {
      const city = extractCityState(info?.address || '', info?.address || '');
      if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
      if (info?.price) priceCounts.set(info.price, (priceCounts.get(info.price) ?? 0) + 1);
      if (info?.cuisine) cuisineCounts.set(info.cuisine, (cuisineCounts.get(info.cuisine) ?? 0) + 1);
    }
    const pickTop = <T,>(m: Map<T, number>, n: number): Array<[T, number]> =>
      Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
    const out: Array<{ key: string; label: string; count: number; kind: 'city' | 'price' | 'cuisine'; active: boolean; onClick: () => void }> = [];
    for (const [city, count] of pickTop(cityCounts, 3)) {
      out.push({
        key: `city:${city}`,
        label: String(city),
        count,
        kind: 'city',
        active: wishlistCityFilter.includes(String(city)),
        onClick: () => setWishlistCityFilter((prev) => prev.includes(String(city)) ? prev.filter((x) => x !== String(city)) : [...prev, String(city)]),
      });
    }
    for (const [price, count] of pickTop(priceCounts, 2)) {
      out.push({
        key: `price:${price}`,
        label: String(price),
        count,
        kind: 'price',
        active: wishlistPriceFilter === String(price),
        onClick: () => setWishlistPriceFilter((prev) => prev === String(price) ? null : String(price)),
      });
    }
    for (const [cuisine, count] of pickTop(cuisineCounts, 3)) {
      out.push({
        key: `cuisine:${cuisine}`,
        label: String(cuisine),
        count,
        kind: 'cuisine',
        active: wishlistCuisineFilter.includes(String(cuisine)),
        onClick: () => setWishlistCuisineFilter((prev) => prev.includes(String(cuisine)) ? prev.filter((x) => x !== String(cuisine)) : [...prev, String(cuisine)]),
      });
    }
    return out;
  }, [isWishlistView, wishlistedRestaurantsRaw, wishlistCityFilter, wishlistPriceFilter, wishlistCuisineFilter]);

  // Result count + avg score for the desktop toolbar's right-side stats.
  // These are best-effort numbers — they show what's currently visible
  // vs the list's true total, so users still see "5 / 14 · Avg 8.0"
  // when filters narrow things down. Avg uses each item's score (rated
  // or list-rating override; recipes use meal score).
  const listStats = (() => {
    if (isHomeCooking) {
      const total = recipes.length;
      const visible = filteredRecipes.length;
      const scored = filteredRecipes.filter((r) => r.score > 0);
      const avg = scored.length > 0
        ? scored.reduce((s, r) => s + r.score, 0) / scored.length
        : null;
      return { total, visible, avg };
    }
    if (isWishlistView) {
      return { total: wishlistedRestaurantsRaw.length, visible: wishlistedRestaurantsFinal.length, avg: null };
    }
    // Custom restaurant or hotel-breakfast list — combine rated and wishlist sections.
    const total = ratedRestaurants.length + wishlistedRestaurantsRaw.length;
    const visible = total; // no per-list filter UI yet beyond search
    const scored = ratedRestaurants
      .map((r) => r.rating?.score)
      .filter((s): s is number => typeof s === 'number' && s > 0);
    const avg = scored.length > 0 ? scored.reduce((s, n) => s + n, 0) / scored.length : null;
    return { total, visible, avg };
  })();

  return (
    <div>
      {/* ── Phone-only top bar ─────────────────────────────────────────
          Back arrow, search-icon toggle, and (for deletable lists) a
          trash icon. Desktop drops this entire row — Pantry's tab pill
          handles navigation, the toolbar below handles search, and
          delete moves to the More menu (⋯). */}
      {phoneMode && (
        <div className="flex items-center justify-end gap-2 mb-4">
          <button
            onClick={onBack}
            aria-label="Back"
            className="p-2 -ml-2 mr-auto text-on-surface/40 hover:text-on-surface transition-colors flex-shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            aria-label={searchOpen ? 'Close search' : `Search ${list.name}`}
            title={searchOpen ? 'Close search' : `Search ${list.name}`}
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
              searchOpen
                ? 'bg-on-surface/[0.08] text-on-surface'
                : 'text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.05]',
            )}
          >
            <Search size={17} />
          </button>
          {!isWishlistView && (
            <button
              type="button"
              onClick={() => setConfirmDeleteList(true)}
              aria-label="Delete list"
              title="Delete list"
              className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface/40 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}

      {/* ── Desktop toolbar ───────────────────────────────────────────
          Same shape as the rated view: Search this list pill on the
          left, list-appropriate filter pills next to it, result count
          + avg + view toggle on the right, thin border separates the
          chrome from the content below. */}
      {!phoneMode && (
        <div className="mb-5 pb-4 border-b border-on-surface/[0.06]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {/* Search this list */}
            <button
              type="button"
              onClick={activateListScope}
              aria-label={`Search ${list.name}`}
              className={cn(
                'inline-flex items-center gap-2 h-8 px-3.5 rounded-full transition-colors text-[13px] font-semibold flex-shrink-0',
                searchQuery
                  ? 'bg-primary/[0.10] text-primary hover:bg-primary/[0.14]'
                  : 'bg-on-surface/[0.05] text-on-surface/75 hover:bg-on-surface/[0.08] hover:text-on-surface',
              )}
            >
              <Search size={13} />
              <span>Search this list</span>
              {searchQuery && (
                <span className="inline-flex items-center gap-1 ml-0.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-[11px] font-bold">
                  <span className="truncate max-w-[100px]">"{searchQuery}"</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setSearchQuery(''); setScopedSearch(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSearchQuery(''); setScopedSearch(null); } }}
                    aria-label="Clear list search"
                    className="text-primary/70 hover:text-primary"
                  >
                    <X size={11} />
                  </span>
                </span>
              )}
            </button>

            {/* Filter pills — same shape as the rated view:
                Filters / City / Cuisine / Price / Sort. Each pill
                except "Filters" opens an anchored dropdown popover
                (positioned right under the pill on desktop). The main
                "Filters" pill opens the full Spotlight-style filter
                sheet that lives at the end of this component. */}
            {!isHomeCooking && (
              <>
                <span className="w-px h-5 bg-on-surface/[0.10] flex-shrink-0 mx-1" aria-hidden="true" />
                <FilterPill
                  onClick={() => setWishlistFilterOpen(true)}
                  icon={<SlidersHorizontal size={12} />}
                  label="Filters"
                  active={wishlistActiveFilterCount > 0}
                  badge={wishlistActiveFilterCount > 0 ? wishlistActiveFilterCount : undefined}
                />
                <AnchoredPill
                  pill={{
                    icon: <MapPin size={11} />,
                    label: wishlistCityFilter.length > 0 ? `City (${wishlistCityFilter.length})` : 'City',
                    active: wishlistCityFilter.length > 0,
                    onClear: wishlistCityFilter.length > 0 ? () => setWishlistCityFilter([]) : undefined,
                  }}
                  popoverWidth="w-[280px]"
                >
                  {() => (
                    <SearchableMultiSelect
                      placeholder="Search cities..."
                      options={wishlistAllCities}
                      selected={wishlistCityFilter}
                      onToggle={toggleWlCity}
                    />
                  )}
                </AnchoredPill>
                <AnchoredPill
                  pill={{
                    label: wishlistCuisineFilter.length > 0 ? `Cuisine (${wishlistCuisineFilter.length})` : 'Cuisine',
                    active: wishlistCuisineFilter.length > 0,
                    onClear: wishlistCuisineFilter.length > 0 ? () => setWishlistCuisineFilter([]) : undefined,
                  }}
                  popoverWidth="w-[280px]"
                >
                  {() => (
                    <SearchableMultiSelect
                      placeholder="Search cuisines..."
                      options={wishlistAllCuisines}
                      selected={wishlistCuisineFilter}
                      onToggle={toggleWlCuisine}
                    />
                  )}
                </AnchoredPill>
                <AnchoredPill
                  pill={{
                    label: wishlistPriceFilter || 'Price',
                    active: !!wishlistPriceFilter,
                    onClear: wishlistPriceFilter ? () => setWishlistPriceFilter(null) : undefined,
                  }}
                  popoverWidth="w-[240px]"
                >
                  {(close) => (
                    <PricePickerContent
                      value={wishlistPriceFilter}
                      onChange={(v) => { setWishlistPriceFilter(v); close(); }}
                    />
                  )}
                </AnchoredPill>
                <AnchoredPill
                  pill={{
                    icon: <ArrowUpDown size={11} />,
                    label: wishlistSort !== 'recent' ? wlSortLabels[wishlistSort] : 'Sort',
                    active: wishlistSort !== 'recent',
                    onClear: wishlistSort !== 'recent' ? () => setWishlistSort('recent') : undefined,
                  }}
                  popoverWidth="w-[220px]"
                >
                  {(close) => (
                    <SortPickerContent
                      value={wishlistSort}
                      options={[
                        ['recent', 'Recent'],
                        ['oldest', 'Oldest'],
                        ['name-asc', 'Name A→Z'],
                        ['name-desc', 'Name Z→A'],
                      ]}
                      onChange={(v) => { setWishlistSort(v as WishlistSort); close(); }}
                    />
                  )}
                </AnchoredPill>
                {(wishlistActiveFilterCount > 0 || wishlistSort !== 'recent') && (
                  <button
                    onClick={resetWishlistFilters}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-semibold text-red-500/80 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                  >
                    <X size={11} /><span>Clear all</span>
                  </button>
                )}
              </>
            )}

            {/* Right side: stats + view toggle */}
            <div className="ml-auto flex items-center gap-3 flex-shrink-0">
              {listStats.total > 0 && (
                <p className="text-[12px] text-on-surface/50 whitespace-nowrap tabular-nums">
                  <span className="font-bold text-on-surface">{listStats.visible}</span>
                  {listStats.visible !== listStats.total && (
                    <span className="text-on-surface/35"> / {listStats.total}</span>
                  )}
                  {listStats.avg !== null && (
                    <>
                      <span className="text-on-surface/25 mx-1.5">·</span>
                      <span>Avg <span className="font-bold text-on-surface">{listStats.avg.toFixed(1)}</span></span>
                    </>
                  )}
                </p>
              )}
              {!isHomeCooking && (
                <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible search input — phone only. Desktop uses the
          header-scoped search button above instead. */}
      <AnimatePresence initial={false}>
        {searchOpen && phoneMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden mb-4"
          >
            <div className="relative max-w-2xl">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/35 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isHomeCooking
                    ? 'Search your recipes...'
                    : isWishlistView
                      ? 'Search your wishlist...'
                      : `Search ${list.name.toLowerCase()}...`
                }
                autoFocus
                className="w-full bg-on-surface/[0.04] hover:bg-on-surface/[0.06] focus:bg-on-surface/[0.06] rounded-full py-2.5 pl-11 pr-10 text-sm font-medium text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/35 hover:text-on-surface/70 transition-colors"
                >
                  <X size={14} />
                </button>
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

      {/* ── Phone-only filter pill row + view toggle ──────────────────
          Filters pill opens the full sheet. "All" clears every active
          quick filter. Each subsequent pill toggles a city / price /
          cuisine filter — counts come from the actual list. Desktop
          uses the unified toolbar above instead. */}
      {phoneMode && (isWishlistView ? wishlistedRestaurantsRaw.length > 0 : totalCount > 0) && (
        <div className="flex items-center gap-2 mb-5 -mx-1 px-1 overflow-x-auto scrollbar-hide pb-1">
          {isWishlistView && (
            <>
              <button
                onClick={() => setWishlistFilterOpen(true)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-colors flex-shrink-0',
                  wishlistActiveFilterCount > 0
                    ? 'border-primary/30 bg-primary/[0.06] text-primary'
                    : 'border-on-surface/[0.08] text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.04]',
                )}
              >
                <SlidersHorizontal size={12} />
                Filters
                {wishlistActiveFilterCount > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold">{wishlistActiveFilterCount}</span>
                )}
              </button>

              <span className="w-px h-4 bg-on-surface/[0.08] mx-1 flex-shrink-0" />

              {/* "All" pill — solid when no quick filter is active */}
              <button
                onClick={resetWishlistFilters}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors flex-shrink-0',
                  wishlistActiveFilterCount === 0
                    ? 'bg-on-surface text-surface'
                    : 'text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.04]',
                )}
              >
                All
                <span className={cn('text-[11px] tabular-nums', wishlistActiveFilterCount === 0 ? 'text-surface/65' : 'text-on-surface/40')}>
                  {wishlistedRestaurantsRaw.length}
                </span>
              </button>

              {quickFilterPills.map((pill) => (
                <button
                  key={pill.key}
                  onClick={pill.onClick}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors flex-shrink-0',
                    pill.active
                      ? 'bg-on-surface text-surface'
                      : 'text-on-surface/65 hover:text-on-surface hover:bg-on-surface/[0.04]',
                  )}
                >
                  {pill.label}
                  <span className={cn('text-[11px] tabular-nums', pill.active ? 'text-surface/65' : 'text-on-surface/40')}>
                    {pill.count}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* The view toggle that used to live here is gone — the
              desktop toolbar above carries the only one now, and on
              phone effectiveViewMode is forced to 'list' anyway, so a
              second toggle here was either duplicate or dead UI. */}
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
                    <span className={cn("text-lg font-serif font-bold tabular-nums", scoreColor(recipe.score))}>{recipe.score.toFixed(1)}</span>
                    <p className="text-[9px] text-on-surface/30 font-medium">/ 10</p>
                  </div>
                </button>
              );
            })}
            {/* Add more button — phone only. On desktop the header's
                "Add Recipe" CTA replaces this footer. */}
            {phoneMode && (
              <button onClick={() => openAddRecipeModal(list.id)}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
                <Plus size={16} /><span className="text-sm font-semibold">Add Recipe</span>
              </button>
            )}
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
              <div className={viewMode === 'grid' ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6" : "divide-y divide-on-surface/[0.06]"}>
                {ratedRestaurants.map(({ id, info, rating }) => viewMode === 'grid' ? (
                  <RestaurantGridCard
                    key={id}
                    restaurantId={id}
                    name={info?.name ?? id}
                    image={info?.image ?? ''}
                    cuisine={info?.cuisine ?? ''}
                    price={info?.price ?? ''}
                    address={info?.address}
                    notes={rating?.notes}
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

          {/* No-matches empty state — wishlist view only, when filters/search hide everything */}
          {/* Truly empty wishlist — nothing saved at all. The minimalist
              chrome above is otherwise the only thing on the page, which
              reads as blank. Surface a friendly explainer so the user
              knows the page isn't broken. */}
          {isWishlistView && wishlistedRestaurantsRaw.length === 0 && (
            <div className="text-center py-20">
              <div className="w-14 h-14 rounded-full bg-red-50 text-red-400 flex items-center justify-center mx-auto mb-4">
                <Heart size={20} />
              </div>
              <p className="text-base font-serif font-bold text-on-surface mb-1">Your wishlist is empty</p>
              <p className="text-sm text-on-surface/50 max-w-xs mx-auto">Tap the heart on any restaurant card to save it here for later.</p>
            </div>
          )}
          {isWishlistView && wishlistedRestaurantsRaw.length > 0 && wishlistedRestaurantsFinal.length === 0 && (
            <div className="text-center py-12">
              <SlidersHorizontal size={28} className="mx-auto text-on-surface/15 mb-3" />
              <p className="text-sm font-medium text-on-surface/40">No matches</p>
              <p className="text-xs text-on-surface/30 mt-1">Try adjusting your filters or search</p>
              {wishlistActiveFilterCount > 0 && (
                <button
                  onClick={resetWishlistFilters}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-primary bg-primary/10 rounded-full hover:bg-primary/15 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* Wishlist section */}
          {wishlistedRestaurantsFinal.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Heart size={14} className="text-red-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Wishlist ({wishlistedRestaurantsFinal.length}{isWishlistView && wishlistedRestaurantsFinal.length !== wishlistedRestaurantsRaw.length ? ` of ${wishlistedRestaurantsRaw.length}` : ''})</h3>
              </div>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6">
                  {wishlistedRestaurantsFinal.map(({ id, info, wishItem }) => (
                    <WishlistGridCard
                      key={id}
                      restaurantId={id}
                      name={info?.name ?? id}
                      image={info?.image ?? ''}
                      cuisine={info?.cuisine ?? ''}
                      price={info?.price ?? ''}
                      address={info?.address}
                      notes={wishItem?.notes}
                      onRemove={() => (isWishlistView || isHotelBreakfast) ? removeFromWishlist(id) : removeFromWishlistInList(list.id, id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-on-surface/[0.06]">
                  {wishlistedRestaurantsFinal.map(({ id, info, wishItem }) => (
                    <WishlistRow
                      key={id}
                      restaurantId={id}
                      name={info?.name ?? id}
                      image={info?.image ?? ''}
                      cuisine={info?.cuisine ?? ''}
                      price={info?.price ?? ''}
                      address={info?.address}
                      notes={wishItem?.notes}
                      onRemove={() => (isWishlistView || isHotelBreakfast) ? removeFromWishlist(id) : removeFromWishlistInList(list.id, id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Add more button — hidden in the synthetic Wishlist view
              (the heart icons across the app are how you add to the
              wishlist). On desktop the dashed footer is also dropped:
              the desktop header's "Add Rating" CTA opens a SearchPopup
              that adds straight into the current list. */}
          {!isWishlistView && phoneMode && (
            <button onClick={handlePlusClick}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
              <Plus size={16} /><span className="text-sm font-semibold">{isHotelBreakfast ? 'Add Hotel' : 'Add Restaurants'}</span>
            </button>
          )}
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
      {!isHomeCooking && (
        <WishlistFilterSheet
          open={wishlistFilterOpen}
          onClose={() => setWishlistFilterOpen(false)}
          sortBy={wishlistSort}
          onSortBy={setWishlistSort}
          cuisineFilter={wishlistCuisineFilter}
          onCuisineFilter={setWishlistCuisineFilter}
          cityFilter={wishlistCityFilter}
          onCityFilter={setWishlistCityFilter}
          priceFilter={wishlistPriceFilter}
          onPriceFilter={setWishlistPriceFilter}
          allCuisines={wishlistAllCuisines}
          allCities={wishlistAllCities}
          onReset={resetWishlistFilters}
          activeCount={wishlistActiveFilterCount}
        />
      )}

      {/* The per-pill bottom sheets that used to live here are gone —
          the desktop toolbar's pills now embed their own anchored
          popovers via <AnchoredPill> instead, so taps drop a small
          dropdown right under the pill rather than sliding a sheet up
          from the bottom of the screen. */}
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
          {/* Backdrop. Desktop gets a richer blur — same Spotlight feel
              as the SearchPopup. Phone keeps the lighter blur so the
              underlying page is still subtly visible behind the sheet. */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: phoneMode ? 0.14 : 0.16 }}
            className={cn(
              'fixed inset-0 z-50',
              phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md',
              !phoneMode && 'flex items-start justify-center pt-[10vh] px-4',
            )}
            onClick={onClose}
          >
            <motion.div
              {...(phoneMode
                ? {
                    initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                    transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                    drag: 'y' as const,
                    dragConstraints: { top: 0 },
                    dragElastic: { top: 0, bottom: 0.4 },
                    onDragEnd: (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
                      if (info.offset.y > 80 || info.velocity.y > 300) onClose();
                    },
                  }
                : {
                    initial: { opacity: 0, scale: 0.94, y: -12 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    exit: { opacity: 0, scale: 0.96, y: -8 },
                    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                  })}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={cn(
                'flex flex-col overflow-hidden bg-surface',
                phoneMode
                  ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl h-[92vh]'
                  : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
              )}
            >
            {/* Drag handle (phone only — desktop has no draggable affordance) */}
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            {/* Header */}
            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-3 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4',
            )}>
              <h3 className={cn('font-serif font-bold', phoneMode ? 'text-lg' : 'text-[20px]')}>Filters</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Sort */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Sort by</p>
                <div className="flex flex-wrap gap-2">
                  {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['added', 'Date Added'], ['custom', 'Custom Order']] as const).map(([key, label]) => (
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
            <div className="flex-shrink-0 border-t border-on-surface/[0.06] px-5 py-4 flex gap-3">
              <button onClick={onReset}
                className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-on-surface/[0.04] transition-colors">Reset</button>
              <button onClick={onClose}
                className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all">Apply</button>
            </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── Wishlist filter sheet ──────────────────────────────────────────────
   Drag-to-dismiss bottom sheet tailored to the wishlist view: sort by
   recency / name, filter by cuisine, price, and city. Cuisine + city are
   collapsible and searchable so the sheet stays compact even with long
   collections. Backdrop fades in, panel springs up. Same animation feel
   as FilterSheet above so the two share muscle memory. ──────────────── */
export type WishlistSort = 'recent' | 'oldest' | 'name-asc' | 'name-desc';

const WishlistFilterSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  sortBy: WishlistSort;
  onSortBy: (v: WishlistSort) => void;
  cuisineFilter: string[];
  onCuisineFilter: (v: string[]) => void;
  cityFilter: string[];
  onCityFilter: (v: string[]) => void;
  priceFilter: string | null;
  onPriceFilter: (v: string | null) => void;
  allCuisines: string[];
  allCities: string[];
  onReset: () => void;
  activeCount: number;
}> = ({ open, onClose, sortBy, onSortBy, cuisineFilter, onCuisineFilter, cityFilter, onCityFilter, priceFilter, onPriceFilter, allCuisines, allCities, onReset, activeCount }) => {
  const { phoneMode } = useSettings();
  const [cuisineOpen, setCuisineOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [cuisineSearch, setCuisineSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');

  const filteredCuisines = cuisineSearch.trim()
    ? allCuisines.filter((c) => c.toLowerCase().includes(cuisineSearch.toLowerCase()))
    : allCuisines;
  const filteredCities = citySearch.trim()
    ? allCities.filter((c) => c.toLowerCase().includes(citySearch.toLowerCase()))
    : allCities;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-[120]',
            phoneMode ? 'bg-black/45 backdrop-blur-md' : 'bg-black/50 backdrop-blur-md',
            !phoneMode && 'flex items-start justify-center pt-[10vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                  transition: { type: 'spring' as const, damping: 30, stiffness: 320, mass: 0.9 },
                  drag: 'y' as const,
                  dragConstraints: { top: 0 },
                  dragElastic: { top: 0, bottom: 0.4 },
                  onDragEnd: (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
                    if (info.offset.y > 90 || info.velocity.y > 350) onClose();
                  },
                }
              : {
                  initial: { opacity: 0, scale: 0.94, y: -12 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.96, y: -8 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'flex flex-col overflow-hidden bg-surface',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl h-[88vh] shadow-[0_-12px_40px_-8px_rgba(0,0,0,0.18)]'
                : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {/* Drag handle (phone only) */}
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1.5 cursor-grab active:cursor-grabbing flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}

            {/* Header */}
            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-2 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4',
            )}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-red-50 text-red-400 flex items-center justify-center">
                  <SlidersHorizontal size={15} />
                </div>
                <div>
                  <h3 className={cn('font-serif font-bold leading-tight', phoneMode ? 'text-lg' : 'text-[20px]')}>Filter wishlist</h3>
                  {activeCount > 0 && (
                    <p className="text-[11px] text-on-surface/45 font-medium">
                      {activeCount} active filter{activeCount === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
              >
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Sort */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Sort by</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['recent', 'Recently Added'],
                    ['oldest', 'Oldest First'],
                    ['name-asc', 'Name A–Z'],
                    ['name-desc', 'Name Z–A'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => onSortBy(key)}
                      className={cn(
                        "px-3.5 py-2 rounded-full text-xs font-semibold transition-all",
                        sortBy === key
                          ? "bg-primary text-white shadow-sm shadow-primary/20"
                          : "bg-on-surface/5 text-on-surface/55 hover:bg-on-surface/10",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Price</p>
                <div className="flex gap-2">
                  {['$', '$$', '$$$', '$$$$'].map((p) => (
                    <button
                      key={p}
                      onClick={() => onPriceFilter(priceFilter === p ? null : p)}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border-2",
                        priceFilter === p
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cuisine */}
              <div>
                <button onClick={() => setCuisineOpen(!cuisineOpen)} className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">Cuisine</p>
                    {cuisineFilter.length > 0 && (
                      <span className="text-[10px] font-semibold text-primary truncate">{cuisineFilter.join(', ')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {cuisineFilter.length > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); onCuisineFilter([]); }} className="text-[10px] text-primary font-semibold">Clear</button>
                    )}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", cuisineOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {cuisineOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input
                          type="text" value={cuisineSearch} onChange={(e) => setCuisineSearch(e.target.value)}
                          placeholder="Search cuisines..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filteredCuisines.map((c) => {
                          const on = cuisineFilter.includes(c);
                          return (
                            <button
                              key={c}
                              onClick={() => onCuisineFilter(on ? cuisineFilter.filter((x) => x !== c) : [...cuisineFilter, c])}
                              className={cn(
                                "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                                on ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/55 hover:border-on-surface/20",
                              )}
                            >
                              {c}
                            </button>
                          );
                        })}
                        {filteredCuisines.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No cuisines match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* City */}
              <div>
                <button onClick={() => setCityOpen(!cityOpen)} className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40">City / Location</p>
                    {cityFilter.length > 0 && (
                      <span className="text-[10px] font-semibold text-primary truncate">{cityFilter.join(', ')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {cityFilter.length > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); onCityFilter([]); }} className="text-[10px] text-primary font-semibold">Clear</button>
                    )}
                    <ChevronDown size={14} className={cn("text-on-surface/30 transition-transform", cityOpen && "rotate-180")} />
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {cityOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="relative mb-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                        <input
                          type="text" value={citySearch} onChange={(e) => setCitySearch(e.target.value)}
                          placeholder="Search locations..."
                          className="w-full bg-on-surface/5 rounded-lg py-2 pl-8 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pb-1">
                        {filteredCities.map((c) => {
                          const on = cityFilter.includes(c);
                          return (
                            <button
                              key={c}
                              onClick={() => onCityFilter(on ? cityFilter.filter((x) => x !== c) : [...cityFilter, c])}
                              className={cn(
                                "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                                on ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/55 hover:border-on-surface/20",
                              )}
                            >
                              {c}
                            </button>
                          );
                        })}
                        {filteredCities.length === 0 && <p className="text-[11px] text-on-surface/30 py-1">No locations match</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-on-surface/[0.06] px-5 py-4 flex gap-3 bg-surface">
              <button
                onClick={onReset}
                className="flex-1 py-3 rounded-2xl border-2 border-on-surface/10 text-sm font-semibold text-on-surface/60 hover:bg-on-surface/[0.03] transition-colors"
              >
                Reset
              </button>
              <button
                onClick={onClose}
                className="flex-[2] py-3 rounded-2xl bg-primary text-white text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all"
              >
                {activeCount > 0 ? `Show results` : 'Done'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Main Page ── */
// Top-level tab on the Pantry landing. Restaurants is the default; Recipes
// surfaces the cookbook (all home meals) plus user-created recipe lists.
type PantryTab = 'restaurants' | 'recipes';

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
  tripHotels?: TripHotel[];
  addRestaurantToTrip: (tripId: string, restaurant: TripRestaurant) => void;
  openAddRestaurantModal: (restaurant: RestaurantMeta, initialPage?: string) => void;
  rateRestaurant: (rating: RestaurantRating) => void;
  onClose: () => void;
}> = ({ open, nightIndex, nightDate, tripId, tripLat, tripLng, existingRestaurantIds, ratings, tripHotels = [], addRestaurantToTrip, openAddRestaurantModal, rateRestaurant, onClose }) => {
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
      cuisine, price: '', address: place.fullAddress || place.address,
    };
    // Add to trip immediately
    addRestaurantToTrip(tripId, {
      restaurantId: place.id,
      name: place.name, image: place.photoUrl || '', cuisine, price: '', address: place.fullAddress || place.address,
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

                {/* Meal type selector for hotel */}
                <div className="px-5 pt-3 pb-2 flex-shrink-0">
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
                  {/* Trip hotels quick-add */}
                  {tripHotels.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2">Your Trip Hotels</p>
                      <div className="space-y-1.5">
                        {tripHotels.map((hotel) => {
                          const hotelId = hotel.placeId || hotel.id;
                          const alreadyAdded = existingRestaurantIds.has(hotelId);
                          const wasJustAdded = justAdded === hotelId;
                          return (
                            <div key={hotel.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-teal-50/50 border border-teal-200/40">
                              {hotel.image ? (
                                <img src={hotel.image} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-11 h-11 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0 text-base">🏨</div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold truncate">{hotel.name}</p>
                                <p className="text-[10px] text-on-surface/40 truncate">{hotel.address}</p>
                                {hotel.checkIn && <p className="text-[9px] text-teal-600/70 mt-0.5">{hotel.checkIn} → {hotel.checkOut}</p>}
                              </div>
                              <button
                                onClick={() => {
                                  if (alreadyAdded || wasJustAdded) return;
                                  addRestaurantToTrip(tripId, {
                                    restaurantId: hotelId,
                                    name: hotel.name, image: hotel.image || '', cuisine: 'Hotel Breakfast', price: '', address: hotel.address,
                                    night: nightIndex, mealType: mealType === 'dinner' ? 'breakfast' : mealType, status: 'planned',
                                    reservationTime: reservationTime || undefined,
                                  });
                                  setJustAdded(hotelId);
                                  setTimeout(() => setJustAdded(null), 1200);
                                }}
                                disabled={alreadyAdded}
                                className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                                  wasJustAdded ? "bg-green-100 text-green-600" :
                                  alreadyAdded ? "bg-on-surface/5 text-on-surface/20 cursor-not-allowed" :
                                  "bg-teal-100 text-teal-600 hover:bg-teal-200")}
                              >
                                {wasJustAdded || alreadyAdded ? <Check size={14} /> : <Plus size={14} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Search for other hotels */}
                  <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2">{tripHotels.length > 0 ? 'Search Other Hotels' : 'Search Hotels'}</p>
                  <form onSubmit={(e) => { e.preventDefault(); handleSearchHotels(); }} className="mb-3">
                    <div className="relative">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={hotelSearch} onChange={(e) => setHotelSearch(e.target.value)} placeholder="Hotel name or location..."
                        autoFocus={tripHotels.length === 0} className="w-full pl-10 pr-20 py-2.5 bg-on-surface/5 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      <button type="submit" disabled={hotelLoading || !hotelSearch.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold disabled:opacity-30 transition-opacity">
                        {hotelLoading ? '...' : 'Search'}
                      </button>
                    </div>
                  </form>

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
                  {!hotelLoading && hotelResults.length === 0 && !hotelSearch && tripHotels.length === 0 && (
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
  const [hotelDiningMap, setHotelDiningMap] = useState<Record<string, HotelDining[]>>({});

  const selectedTrip = trips.find((t) => t.id === selectedTripId) || null;

  // Fetch hotel dining options for trip hotels
  useEffect(() => {
    if (!selectedTrip || selectedTrip.hotels.length === 0) { setHotelDiningMap({}); return; }
    const fetchDining = async () => {
      const map: Record<string, HotelDining[]> = {};
      await Promise.all(selectedTrip.hotels.map(async (hotel) => {
        const placeId = hotel.placeId || hotel.id;
        const dining = await getHotelDining(placeId);
        if (dining.length > 0) map[placeId] = dining;
      }));
      setHotelDiningMap(map);
    };
    fetchDining();
  }, [selectedTrip?.id, selectedTrip?.hotels.length]);

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
                <Edit3 size={14} className="text-on-surface/35" />
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
            {selectedTrip.hotels.map((hotel) => {
              const hotelPlaceId = hotel.placeId || hotel.id;
              const diningOptions = hotelDiningMap[hotelPlaceId] || [];
              return (
                <div key={hotel.id} className="mb-3">
                  <div className="bg-white rounded-2xl border border-on-surface/[0.06] shadow-sm p-3.5 flex items-center gap-3">
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
                  {/* Dining options for this hotel */}
                  {diningOptions.length > 0 && (
                    <div className="ml-5 mt-1.5 border-l-2 border-teal-200/50 pl-3.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-teal-600/50 mb-1.5">Dining at {hotel.name.split(' ').slice(0, 3).join(' ')}</p>
                      {diningOptions.map((d) => (
                        <div key={d.id} className="flex items-center gap-2.5 py-1.5">
                          <div className="w-7 h-7 rounded-md bg-teal-50 flex items-center justify-center flex-shrink-0 text-xs">
                            {d.dining_type === 'breakfast' ? '🥐' : d.dining_type === 'bar' ? '🍸' : d.dining_type === 'room_service' ? '🛎️' : d.dining_type === 'pool_bar' ? '🏊' : d.dining_type === 'rooftop' ? '🌇' : '🍽️'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold truncate">{d.restaurant_name}</p>
                            <p className="text-[8px] text-on-surface/30 capitalize">{d.dining_type.replace('_', ' ')}</p>
                          </div>
                          <button
                            onClick={() => {
                              setAddNightIndex(0);
                              addRestaurantToTrip(selectedTrip.id, {
                                restaurantId: d.restaurant_place_id,
                                name: d.restaurant_name, image: '', cuisine: d.dining_type === 'breakfast' ? 'Hotel Breakfast' : 'Hotel Restaurant',
                                price: '', address: d.hotel_address,
                                night: 0, mealType: d.dining_type === 'breakfast' ? 'breakfast' : d.dining_type === 'bar' || d.dining_type === 'pool_bar' || d.dining_type === 'rooftop' ? 'drinks' : 'dinner',
                                status: 'planned',
                              });
                            }}
                            className="px-2 py-1 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100 transition-colors flex-shrink-0"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Empty hint ── */}
        {totalRestaurants === 0 && (
          <div className="text-center py-2 mb-4">
            <p className="text-xs text-on-surface/30 font-medium">Tap <span className="text-primary">+ Add</span> on any night to start building your itinerary</p>
          </div>
        )}

        {/* ── Night-by-night itinerary ── */}
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 px-1 mb-3">Itinerary</p>

          <div className="flex flex-col gap-6">
            {Array.from({ length: nights }).map((_, nightIdx) => {
              const nightRestaurants = selectedTrip.restaurants
                .filter((r) => r.night === nightIdx)
                .sort((a, b) => (MEAL_ORDER[a.mealType] || 0) - (MEAL_ORDER[b.mealType] || 0));

              const nightDateStr = getNightDate(selectedTrip.startDate, nightIdx);

              return (
                <div key={nightIdx}>
                  {/* Flat bold header: "Night N — Date" + Add */}
                  <div className="flex items-baseline gap-2 mb-3 px-1">
                    <h3 className="font-serif font-bold text-lg text-on-surface leading-none">Night {nightIdx + 1}</h3>
                    <span className="text-on-surface/25 text-sm">—</span>
                    <span className="text-sm text-on-surface/50 font-medium truncate">{nightDateStr}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => { setAddNightIndex(nightIdx); setAddNightSheetOpen(true); }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/[0.06] text-primary hover:bg-primary/[0.12] transition-colors flex-shrink-0"
                    >
                      <Plus size={12} />
                      <span className="text-[11px] font-semibold">Add</span>
                    </button>
                  </div>

                  {/* Flat meal list — no card, no borders, just gap-3 spacing */}
                  {nightRestaurants.length === 0 ? (
                    <p className="text-[11px] text-on-surface/25 italic px-1">No restaurants planned</p>
                  ) : (
                    <div className="flex flex-col gap-3 px-1">
                      {nightRestaurants.map((r) => (
                        <div
                          key={`${r.restaurantId}-${r.night}`}
                          className={cn("flex items-center gap-3", r.status === 'skipped' && "opacity-40")}
                        >
                          {/* Left-aligned colored meal pill */}
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide flex-shrink-0 min-w-[58px] text-center",
                              MEAL_COLORS[r.mealType] || 'bg-gray-100 text-gray-600'
                            )}
                          >
                            {r.mealType}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-semibold text-on-surface truncate", r.status === 'skipped' && "line-through")}>{r.name}</p>
                            {r.reservationTime && <p className="text-[11px] text-on-surface/40 mt-0.5">{r.reservationTime}</p>}
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
          tripHotels={selectedTrip.hotels}
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
  const [hotels, setHotels] = useState<TripHotel[]>([]);

  // Hotel suggestions
  const [suggestedHotels, setSuggestedHotels] = useState<PlaceResult[]>([]);
  const [hotelsLoading, setHotelsLoading] = useState(false);

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
      setHotels(trip?.hotels || []);
      setSuggestedHotels([]);
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

  // Search for hotels near destination
  useEffect(() => {
    if (!destLat || !destLng || !destination) { setSuggestedHotels([]); return; }
    // Don't search if editing an existing trip (already has hotels)
    if (trip && trip.hotels.length > 0) return;
    setHotelsLoading(true);
    (async () => {
      try {
        const results = await searchHotels('hotels', destLat, destLng);
        setSuggestedHotels(results.slice(0, 6));
      } catch { setSuggestedHotels([]); }
      finally { setHotelsLoading(false); }
    })();
  }, [destLat, destLng, destination]);

  const addSuggestedHotel = (place: PlaceResult) => {
    if (hotels.some((h) => h.placeId === place.id)) return;
    setHotels((prev) => [...prev, {
      id: crypto.randomUUID(),
      name: place.name,
      address: place.fullAddress || place.address,
      checkIn: startDate,
      checkOut: endDate,
      image: place.photoUrl || undefined,
      placeId: place.id,
    }]);
  };

  const removeSuggestedHotel = (hotelId: string) => {
    setHotels((prev) => prev.filter((h) => h.id !== hotelId));
  };

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
      hotels,
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

            {/* Suggested Hotels */}
            {destination && destLat > 0 && (
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-1.5 block">Hotels</label>
                {/* Already added hotels */}
                {hotels.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {hotels.map((h) => (
                      <div key={h.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-teal-50/50 border border-teal-200/40">
                        {h.image ? (
                          <img src={h.image} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0 text-sm">🏨</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{h.name}</p>
                          <p className="text-[9px] text-on-surface/35 truncate">{h.address}</p>
                        </div>
                        <button onClick={() => removeSuggestedHotel(h.id)} className="p-1 text-on-surface/20 hover:text-red-400 transition-colors flex-shrink-0">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Suggestions */}
                {hotelsLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={18} className="animate-spin text-teal-500" />
                    <span className="text-xs text-on-surface/35 ml-2">Finding hotels nearby...</span>
                  </div>
                )}
                {!hotelsLoading && suggestedHotels.length > 0 && (
                  <div className="space-y-1.5">
                    {suggestedHotels.filter((s) => !hotels.some((h) => h.placeId === s.id)).map((place) => (
                      <button key={place.id} onClick={() => addSuggestedHotel(place)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-on-surface/8 bg-white hover:border-teal-300 transition-all text-left">
                        {place.photoUrl ? (
                          <img src={place.photoUrl} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-on-surface/5 flex items-center justify-center flex-shrink-0 text-sm">🏨</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{place.name}</p>
                          <p className="text-[9px] text-on-surface/35 truncate">{place.address}</p>
                          {place.rating > 0 && <p className="text-[8px] text-on-surface/25 mt-0.5">★ {place.rating.toFixed(1)}</p>}
                        </div>
                        <Plus size={14} className="text-teal-500 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {!hotelsLoading && suggestedHotels.length === 0 && hotels.length === 0 && (
                  <p className="text-[11px] text-on-surface/25 text-center py-3">No hotel suggestions available</p>
                )}
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

/* ── Home Cooking Tab ── */
const HOME_MEAL_TAGS = ['Comfort Food', 'Healthy', 'Quick & Easy', 'Baking', 'Date Night', 'Meal Prep', 'Grill', 'Pasta', 'Asian', 'Mexican', 'Italian', 'Dessert', 'Breakfast', 'Soup', 'Salad', 'Seafood', 'Vegetarian', 'New Recipe'];

const HomeCookingTab: React.FC<{
  meals: HomeMeal[];
  onCreateMeal: (meal: Omit<HomeMeal, 'id' | 'createdAt'>) => HomeMeal;
  onUpdateMeal: (id: string, updates: Partial<HomeMeal>) => void;
  onDeleteMeal: (id: string) => void;
  onOpenModal: (meal?: HomeMeal) => void;
  onBack: () => void;
  selectedMealId: string | null;
  onSelectMeal: (id: string | null) => void;
  // When the desktop tabs render this view, the page already has a
  // tab strip + back via the Restaurants tab — skip the local back
  // button + duplicate header to avoid two layers of chrome.
  hideHeader?: boolean;
}> = ({ meals, onCreateMeal, onUpdateMeal, onDeleteMeal, onOpenModal, onBack, selectedMealId, onSelectMeal, hideHeader = false }) => {
  const { phoneMode } = useSettings();
  const { user } = useAuth();
  const { setScopedSearch, scopedSearch, bumpFocus } = usePageSearch();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'quickest'>('recent');

  // Desktop: clicking "Search this list" hijacks the desktop header
  // search input as a recipe filter, just like the rated view does.
  const activateRecipesScope = useCallback(() => {
    setScopedSearch({
      scopeName: 'All Recipes',
      placeholder: 'Search this list…',
      query: searchQuery,
      setQuery: setSearchQuery,
      onDismiss: () => setSearchQuery(''),
    });
    bumpFocus();
  }, [searchQuery, setScopedSearch, bumpFocus]);

  useEffect(() => {
    if (scopedSearch && scopedSearch.scopeName === 'All Recipes' && scopedSearch.query !== searchQuery) {
      setScopedSearch({ ...scopedSearch, query: searchQuery });
    }
  }, [searchQuery, scopedSearch, setScopedSearch]);

  // Drop the scope when the cookbook unmounts so it doesn't bleed into
  // the next page. Other components manage their own scope on mount, so
  // an unconditional clear here is safe.
  useEffect(() => {
    return () => { setScopedSearch(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lightboxPhotoIdx, setLightboxPhotoIdx] = useState<number | null>(null);
  // Transient recipe-page UI state (not persisted — pure display aids).
  const [servingsScale, setServingsScale] = useState(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set());
  // Rating tab: "mine" shows the author's own /10 score; "community" shows
  // 5-star reviews from friends/other users.
  const [ratingTab, setRatingTab] = useState<'mine' | 'community'>('mine');
  const [communityReviews, setCommunityReviews] = useState<HomeMealReview[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Record<string, UserProfile>>({});
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [shareRecipeData, setShareRecipeData] = useState<SharedRecipe | null>(null);

  const selectedMeal = meals.find((m) => m.id === selectedMealId) || null;

  // Reset the transient display state whenever the user opens a different meal.
  useEffect(() => {
    setServingsScale(1);
    setCheckedIngredients(new Set());
    setRatingTab('mine');
    setCommunityReviews([]);
    setReviewerProfiles({});
  }, [selectedMealId]);

  // Lazily load community reviews when the user switches to that tab.
  // Scan the author's friends' meta rows too so reviews saved via the
  // ListsContext fallback (restaurant_meta.__my_meal_reviews__) show up
  // even when the dedicated recipe_reviews table doesn't exist.
  useEffect(() => {
    if (ratingTab !== 'community' || !selectedMealId) return;
    if (communityReviews.length > 0) return; // already loaded
    let cancelled = false;
    setLoadingReviews(true);
    (async () => {
      try {
        const authorId = user?.id || null;
        let scanIds: string[] = [];
        if (authorId) {
          const friends = await getFriends(authorId);
          scanIds = [authorId, ...friends.map((f) => f.friend_id)];
        }
        const reviews = await getHomeMealReviews(selectedMealId, scanIds);
        if (cancelled) return;
        setCommunityReviews(reviews);
        const ids = [...new Set(reviews.map((r) => r.userId))];
        if (ids.length > 0) {
          const profiles = await getProfilesByIds(ids);
          if (!cancelled) setReviewerProfiles(profiles);
        }
      } finally {
        if (!cancelled) setLoadingReviews(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ratingTab, selectedMealId, communityReviews.length, user]);

  const filteredMeals = useMemo(() => {
    let result = [...meals];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.dishes.some((d) => d.name.toLowerCase().includes(q)) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (sortBy === 'recent') {
      result.sort((a, b) => b.createdAt - a.createdAt);
    } else if (sortBy === 'highest') {
      result.sort((a, b) => b.score - a.score);
    } else if (sortBy === 'lowest') {
      result.sort((a, b) => a.score - b.score);
    } else if (sortBy === 'quickest') {
      // Total time = prep + cook. Treat undefined as 0 so meals without
      // times sink to the top of the list (they're "instant" by default).
      const total = (m: HomeMeal) => (m.prepTime || 0) + (m.cookTime || 0);
      result.sort((a, b) => total(a) - total(b));
    }

    return result;
  }, [meals, searchQuery, sortBy]);

  // ── Meal detail view (diary / blog entry style) ──
  if (selectedMeal) {
    // Canonical cover image used everywhere (card thumbnails, phone hero,
    // desktop hero-image column) so every surface shows the same photo for
    // the same recipe.
    const coverUrl = getMealCoverUrl(selectedMeal);
    const allPhotos = [
      ...(selectedMeal.coverPhoto ? [{ url: selectedMeal.coverPhoto, caption: '' }] : []),
      ...selectedMeal.photos.map((p) => ({ url: p.url, caption: p.caption })),
    ];
    // coverUrl is always allPhotos[0] (either the explicit coverPhoto at
    // index 0, or the first photo when no coverPhoto was set).
    const coverLightboxIdx = 0;
    const hasIngredients = (selectedMeal.ingredients?.length ?? 0) > 0;
    const hasSteps = (selectedMeal.steps?.length ?? 0) > 0;
    const totalTime = (selectedMeal.prepTime ?? 0) + (selectedMeal.cookTime ?? 0);

    // Servings scaling: `baseServings` is the author's original, `displayServings`
    // is what the ratio button is currently set to. Ratio is derived from that.
    const baseServings = selectedMeal.servings && selectedMeal.servings > 0 ? selectedMeal.servings : 4;
    const displayServings = Math.max(1, Math.round(baseServings * servingsScale));

    const toggleCheckedIngredient = (idx: number) => {
      setCheckedIngredients((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
    };

    const jumpTargets: { id: string; label: string }[] = [
      ...(hasIngredients ? [{ id: 'ingredients', label: 'Ingredients' }] : []),
      ...(hasSteps ? [{ id: 'directions', label: 'Directions' }] : []),
      ...(selectedMeal.description ? [{ id: 'notes', label: 'Notes' }] : []),
      ...(selectedMeal.photos.length > 0 ? [{ id: 'photos', label: 'Photos' }] : []),
    ];


    // ── Reusable section blocks, identical content for phone and desktop ──

    const buildSharedRecipe = (): SharedRecipe => ({
      mealId: selectedMeal.id,
      authorId: user?.id || '',
      authorName: user?.user_metadata?.display_name || user?.user_metadata?.username || 'You',
      name: selectedMeal.name,
      image: coverUrl,
      description: selectedMeal.description || undefined,
      tags: selectedMeal.tags.length > 0 ? selectedMeal.tags : undefined,
      totalTime: (selectedMeal.prepTime ?? 0) + (selectedMeal.cookTime ?? 0) || undefined,
      difficulty: selectedMeal.difficulty || undefined,
      ingredientCount: selectedMeal.ingredients?.length || undefined,
      stepCount: selectedMeal.steps?.length || undefined,
    });

    const actionsHeader = (
      <div className="flex items-center gap-3">
        <button onClick={() => onSelectMeal(null)} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1" />
        <button onClick={() => setShareRecipeData(buildSharedRecipe())}
          className="p-2 text-on-surface/40 hover:text-emerald-600 rounded-full transition-colors" title="Share recipe">
          <Share2 size={18} />
        </button>
        <button onClick={() => onOpenModal(selectedMeal)}
          className="p-2 text-on-surface/40 hover:text-primary rounded-full transition-colors" title="Edit meal">
          <Edit3 size={18} />
        </button>
        <button onClick={() => setConfirmDeleteId(selectedMeal.id)}
          className="p-2 text-on-surface/40 hover:text-red-500 rounded-full transition-colors" title="Delete meal">
          <Trash2 size={18} />
        </button>
      </div>
    );

    const communitySummary = summarizeReviews(communityReviews);

    const titleBlock = (
      <header>
        <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-on-surface/40 font-medium mb-1">
          {new Date(selectedMeal.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <h1 className="font-serif font-bold text-[26px] leading-[1.15] sm:text-4xl text-on-surface mb-3">
          {selectedMeal.name}
        </h1>

        {/* Tags */}
        {selectedMeal.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {selectedMeal.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center px-2.5 py-0.5 bg-amber-50 text-amber-800 rounded-full text-[10px] font-semibold tracking-wide">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* My Rating ↔ Community toggle */}
        <div className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
          <div className="flex border-b border-on-surface/6">
            <button
              onClick={() => setRatingTab('mine')}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-center transition-colors",
                ratingTab === 'mine'
                  ? "text-on-surface border-b-2 border-emerald-600"
                  : "text-on-surface/40 hover:text-on-surface/60",
              )}
            >
              My Rating
            </button>
            <button
              onClick={() => setRatingTab('community')}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-center transition-colors",
                ratingTab === 'community'
                  ? "text-on-surface border-b-2 border-amber-500"
                  : "text-on-surface/40 hover:text-on-surface/60",
              )}
            >
              Community
            </button>
          </div>

          {ratingTab === 'mine' ? (
            <div className="px-4 py-4 flex items-center gap-4">
              {selectedMeal.score > 0 ? (
                <>
                  <div className="flex items-baseline">
                    <span className={cn("text-4xl font-serif font-bold tabular-nums", scoreColor(selectedMeal.score))}>
                      {selectedMeal.score.toFixed(1)}
                    </span>
                    <span className="text-xs text-on-surface/35 font-medium ml-1">/ 10</span>
                  </div>
                  {'wouldMakeAgain' in selectedMeal && (
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold",
                      selectedMeal.wouldMakeAgain
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-600",
                    )}>
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        selectedMeal.wouldMakeAgain ? "bg-emerald-500" : "bg-red-500",
                      )} />
                      {selectedMeal.wouldMakeAgain ? 'Would make again' : "Wouldn't repeat"}
                    </span>
                  )}
                </>
              ) : (
                <p className="text-sm text-on-surface/40 italic">No rating yet — edit to add one.</p>
              )}
            </div>
          ) : (
            <div className="px-4 py-4">
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-baseline">
                  <span className="text-4xl font-serif font-bold tabular-nums text-amber-600">
                    {communitySummary.count > 0 ? communitySummary.average.toFixed(1) : '—'}
                  </span>
                  <span className="text-xs text-on-surface/35 font-medium ml-1">/ 5</span>
                </div>
                <div>
                  <div className="flex gap-0.5 mb-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={14} className={cn(
                        communitySummary.count > 0 && n <= Math.round(communitySummary.average)
                          ? "text-amber-500 fill-amber-500"
                          : "text-amber-200",
                      )} />
                    ))}
                  </div>
                  <p className="text-[10px] text-on-surface/45">
                    {communitySummary.count === 0 ? 'No reviews yet' : `${communitySummary.count} review${communitySummary.count !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>

              {loadingReviews ? (
                <p className="text-xs text-on-surface/40 text-center py-3">Loading…</p>
              ) : communityReviews.length === 0 ? (
                <p className="text-xs text-on-surface/40 italic">Share this recipe (set to Public) so friends can rate it.</p>
              ) : (
                <div className="space-y-2.5 max-h-60 overflow-y-auto">
                  {communityReviews.map((r) => {
                    const name = reviewerProfiles[r.userId]?.display_name || reviewerProfiles[r.userId]?.username || 'Someone';
                    return (
                      <div key={r.id} className="border-t border-on-surface/6 pt-2.5 first:border-0 first:pt-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-xs font-semibold text-on-surface">{name}</p>
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star key={n} size={11} className={cn(
                                n <= r.rating ? "text-amber-500 fill-amber-500" : "text-on-surface/15",
                              )} />
                            ))}
                          </div>
                        </div>
                        {r.notes && <p className="text-[12px] text-on-surface/60 leading-relaxed">{r.notes}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </header>
    );

    // Stat cards — on phone use compact durations ("2h 45m") in a 2-col grid
    // so nothing wraps or gets clipped; desktop keeps the wider 5-col layout.
    const durationLabel = (m: number) => phoneMode ? formatDurationCompact(m) : formatDuration(m);
    const statCells: { key: string; icon: React.ReactNode; label: string; value: string }[] = [];
    if ((selectedMeal.prepTime ?? 0) > 0) {
      statCells.push({ key: 'prep', icon: <Clock size={12} className="text-on-surface/40" />, label: 'Prep', value: durationLabel(selectedMeal.prepTime ?? 0) });
    }
    if ((selectedMeal.cookTime ?? 0) > 0) {
      statCells.push({ key: 'cook', icon: <Flame size={12} className="text-on-surface/40" />, label: 'Cook', value: durationLabel(selectedMeal.cookTime ?? 0) });
    }
    if (totalTime > 0 && (selectedMeal.prepTime ?? 0) > 0 && (selectedMeal.cookTime ?? 0) > 0) {
      statCells.push({ key: 'total', icon: <Clock size={12} className="text-on-surface/40" />, label: 'Total', value: durationLabel(totalTime) });
    }
    if ((selectedMeal.servings ?? 0) > 0) {
      statCells.push({ key: 'serves', icon: <Users size={12} className="text-on-surface/40" />, label: 'Serves', value: String(selectedMeal.servings) });
    }
    if (selectedMeal.difficulty) {
      statCells.push({ key: 'difficulty', icon: <Star size={12} className="text-amber-500 fill-amber-500" />, label: 'Difficulty', value: selectedMeal.difficulty });
    }

    const statCardsBlock = statCells.length > 0 ? (
      <div className={cn(
        "grid gap-px bg-on-surface/8 rounded-2xl overflow-hidden border border-on-surface/8",
        phoneMode ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
      )}>
        {statCells.map((c) => (
          <div key={c.key} className="bg-white px-4 py-3 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {c.icon}
              <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-medium truncate">{c.label}</p>
            </div>
            <p className="font-serif font-bold text-lg text-on-surface leading-tight whitespace-nowrap truncate">{c.value}</p>
          </div>
        ))}
      </div>
    ) : null;

    const ingredientsBlock = hasIngredients ? (
      <section id="ingredients">
        <div className="bg-white rounded-2xl border border-on-surface/8 p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <h2 className="font-serif font-bold text-2xl text-on-surface">Ingredients</h2>
            <span className="text-[11px] text-on-surface/40 font-medium">
              {selectedMeal.ingredients!.length} item{selectedMeal.ingredients!.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-on-surface/6">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-medium mb-0.5">Scale for</p>
              <p className="text-sm font-semibold text-on-surface tabular-nums">
                {displayServings} serving{displayServings !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 bg-on-surface/[0.04] border border-on-surface/10 rounded-full">
              <button
                type="button"
                onClick={() => setServingsScale(Math.max(0.25, (displayServings - 1) / baseServings))}
                disabled={displayServings <= 1}
                className="w-9 h-9 flex items-center justify-center text-on-surface/60 hover:text-on-surface disabled:opacity-30 transition-colors text-lg"
                aria-label="Decrease servings"
              >−</button>
              <div className="w-9 text-center text-sm font-semibold tabular-nums">{displayServings}</div>
              <button
                type="button"
                onClick={() => setServingsScale((displayServings + 1) / baseServings)}
                className="w-9 h-9 flex items-center justify-center text-on-surface/60 hover:text-on-surface transition-colors text-lg"
                aria-label="Increase servings"
              >+</button>
            </div>
          </div>

          <ul className="space-y-0.5">
            {selectedMeal.ingredients!.map((ing, i) => {
              const isChecked = checkedIngredients.has(i);
              const scaledAmount = ing.amount ? scaleQuantity(ing.amount, servingsScale) : '';
              return (
                <li key={i}>
                  <label className={cn(
                    "flex items-baseline gap-3 py-2.5 cursor-pointer group transition-colors",
                    isChecked && "opacity-40",
                  )}>
                    <span className="flex items-center flex-shrink-0 translate-y-[2px]">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCheckedIngredient(i)}
                        className="sr-only peer"
                      />
                      <span className={cn(
                        "w-[20px] h-[20px] rounded border-2 flex items-center justify-center transition-all",
                        isChecked
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "border-on-surface/20 group-hover:border-on-surface/40",
                      )}>
                        {isChecked && <Check size={13} strokeWidth={3} />}
                      </span>
                    </span>
                    <span className={cn(
                      "flex-1 text-[15px] leading-[1.6] text-on-surface/80",
                      isChecked && "line-through",
                    )}>
                      {(scaledAmount || ing.unit) && (
                        <span className="font-semibold text-on-surface tabular-nums">
                          {scaledAmount}{ing.unit ? ` ${ing.unit}` : ''}
                          {ing.name ? ' ' : ''}
                        </span>
                      )}
                      <span className="text-on-surface/70">{ing.name}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    ) : null;

    const directionsBlock = hasSteps ? (
      <section id="directions">
        <div className="bg-white rounded-2xl border border-on-surface/8 p-5 sm:p-6">
          <h2 className="font-serif font-bold text-2xl text-on-surface mb-5">Directions</h2>
          <ol className="space-y-5">
            {selectedMeal.steps!.map((step, i) => {
              const timerMinutes = extractStepMinutes(step);
              return (
                <li key={i} className="border-b border-on-surface/6 last:border-0 pb-5 last:pb-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600 mb-1.5">
                    Step {i + 1}
                  </p>
                  <p className="text-[16px] leading-[1.7] text-on-surface/85 whitespace-pre-wrap">
                    {step}
                  </p>
                  {timerMinutes !== null && (
                    <div className="mt-2">
                      <StepTimer minutes={timerMinutes} />
                    </div>
                    )}
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    ) : null;

    const notesBlock = selectedMeal.description ? (
      <section id="notes">
        <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Notes</h2>
        <blockquote className="relative bg-amber-50/60 border-l-4 border-amber-400 rounded-r-xl px-5 py-4 sm:px-6 sm:py-5">
          <p className="italic font-serif text-on-surface/75 leading-[1.7] text-[15px] sm:text-[16px] whitespace-pre-wrap">
            {selectedMeal.description}
          </p>
        </blockquote>
      </section>
    ) : null;

    const dishesBlock = selectedMeal.dishes.length > 0 ? (
      <section>
        <h2 className="font-serif font-bold text-xl text-on-surface mb-3">
          Dishes <span className="text-sm text-on-surface/35 font-medium">({selectedMeal.dishes.length})</span>
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {selectedMeal.dishes.map((dish) => (
            <div key={dish.id} className="bg-white rounded-2xl border border-on-surface/8 overflow-hidden">
              {dish.photo && (
                <img src={dish.photo} alt={dish.name} className="w-full aspect-[3/2] object-cover" />
              )}
              <div className="p-4">
                <p className="font-serif font-bold text-base text-on-surface">{dish.name}</p>
                {dish.description && <p className="text-sm text-on-surface/60 mt-1 leading-relaxed">{dish.description}</p>}
                {dish.recipeLink && (
                  <a href={dish.recipeLink} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary font-semibold mt-3 inline-block hover:underline">View Recipe →</a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    ) : null;

    // The header cover photo is either selectedMeal.coverPhoto (lives outside
    // selectedMeal.photos) or selectedMeal.photos[0]. In the second case we
    // skip photos[0] from the grid so it isn't shown twice.
    const photosSliceStart = selectedMeal.coverPhoto ? 0 : 1;
    const photosVisible = selectedMeal.photos.length > photosSliceStart;
    const photosBlock = photosVisible ? (
      <section id="photos">
        <h2 className="font-serif font-bold text-xl text-on-surface mb-3">Photos</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {selectedMeal.photos.slice(photosSliceStart).map((photo, i) => {
            const lightboxIdx = (selectedMeal.coverPhoto ? 1 : 0) + photosSliceStart + i;
            return (
              <button
                key={i}
                onClick={() => setLightboxPhotoIdx(lightboxIdx)}
                className="aspect-square rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
              >
                <img src={photo.url} alt={photo.caption || `Photo ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            );
          })}
        </div>
      </section>
    ) : null;

    const publicBadge = selectedMeal.isPublic ? (
      <p className="text-[11px] text-on-surface/30 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Shared on social feed
      </p>
    ) : null;

    const deleteConfirmOverlay = (
      <AnimatePresence>
        {confirmDeleteId && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50" onClick={() => setConfirmDeleteId(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-white rounded-2xl p-5 z-50 shadow-xl text-center"
            >
              <p className="font-semibold text-on-surface mb-2">Delete this meal?</p>
              <p className="text-sm text-on-surface/50 mb-4">This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 py-2 rounded-xl bg-on-surface/5 text-on-surface/60 text-sm font-semibold">Cancel</button>
                <button onClick={() => { onDeleteMeal(confirmDeleteId); setConfirmDeleteId(null); onSelectMeal(null); }}
                  className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold">Delete</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );

    const lightbox = (
      <PhotoLightbox
        photos={allPhotos}
        index={lightboxPhotoIdx}
        onClose={() => setLightboxPhotoIdx(null)}
        onChange={setLightboxPhotoIdx}
      />
    );

    const shareSheet = (
      <ShareRecipeSheet
        open={!!shareRecipeData}
        recipe={shareRecipeData}
        onClose={() => setShareRecipeData(null)}
      />
    );

    // ── Phone layout: full-width hero + fully stacked sections ──
    if (phoneMode) {
      return (
        <div className="-mx-3 pb-20">
          <div className="px-4 pt-2 pb-1">{actionsHeader}</div>

          {coverUrl ? (
            <button onClick={() => setLightboxPhotoIdx(coverLightboxIdx)} className="block w-full text-left mt-2 mb-5">
              <img src={coverUrl} alt={selectedMeal.name} className="w-full aspect-[4/3] object-cover" />
            </button>
          ) : (
            <div className="mt-2" />
          )}

          <div className="px-5 space-y-8">
            {titleBlock}
            {statCardsBlock}
            {ingredientsBlock}
            {directionsBlock}
            {notesBlock}
            {dishesBlock}
            {photosBlock}
            {publicBadge}
          </div>

          {deleteConfirmOverlay}
          {lightbox}
          {shareSheet}
        </div>
      );
    }

    // ── Desktop layout: editorial with two-column ingredients + directions ──
    return (
      <div className="max-w-[880px] mx-auto px-3">
        <div className="mb-6">{actionsHeader}</div>

        {/* Hero row: title block on left, cover photo on right */}
        <div className="grid md:grid-cols-[minmax(0,1fr)_240px] gap-6 items-stretch mb-8">
          {titleBlock}
          {coverUrl && (
            <button
              type="button"
              onClick={() => setLightboxPhotoIdx(coverLightboxIdx)}
              className="hidden md:block relative rounded-2xl overflow-hidden border border-on-surface/8 group"
              aria-label="Open photo gallery"
            >
              <img src={coverUrl} alt={selectedMeal.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
            </button>
          )}
        </div>

        {statCardsBlock && <div className="mb-8">{statCardsBlock}</div>}

        {jumpTargets.length > 1 && (
          <nav className="sticky top-0 z-20 bg-surface/75 backdrop-blur-md mb-6">
            <div className="flex gap-1 py-2.5 overflow-x-auto scrollbar-hide">
              {jumpTargets.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(t.id);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold text-on-surface/60 hover:bg-on-surface/5 hover:text-on-surface transition-colors whitespace-nowrap"
                >
                  {t.label}
                </a>
              ))}
            </div>
          </nav>
        )}

        <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 mb-10">
          <div className="md:sticky md:top-16 md:self-start">{ingredientsBlock}</div>
          {directionsBlock}
        </div>

        <div className="space-y-8 mb-12">
          {notesBlock}
          {dishesBlock}
          {photosBlock}
          {publicBadge}
        </div>

        {deleteConfirmOverlay}
        {lightbox}
      </div>
    );
  }

  // ── Meal list view ──
  // Stats for the desktop toolbar's right side: visible / total + avg.
  const visibleScored = filteredMeals.filter((m) => m.score > 0);
  const visibleAvg = visibleScored.length > 0
    ? visibleScored.reduce((s, m) => s + m.score, 0) / visibleScored.length
    : null;

  return (
    <div>
      {hideHeader ? (
        // Desktop toolbar — same shape as the rated view + ListDetailView.
        // Search this list pill on the left, recipe sort pills next to
        // it, count + avg + view toggle on the right, thin border.
        <div className="mb-5 pb-4 border-b border-on-surface/[0.06]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <button
              type="button"
              onClick={activateRecipesScope}
              aria-label="Search this list"
              className={cn(
                'inline-flex items-center gap-2 h-8 px-3.5 rounded-full transition-colors text-[13px] font-semibold flex-shrink-0',
                searchQuery
                  ? 'bg-primary/[0.10] text-primary hover:bg-primary/[0.14]'
                  : 'bg-on-surface/[0.05] text-on-surface/75 hover:bg-on-surface/[0.08] hover:text-on-surface',
              )}
            >
              <Search size={13} />
              <span>Search this list</span>
              {searchQuery && (
                <span className="inline-flex items-center gap-1 ml-0.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-[11px] font-bold">
                  <span className="truncate max-w-[100px]">"{searchQuery}"</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setSearchQuery(''); setScopedSearch(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSearchQuery(''); setScopedSearch(null); } }}
                    aria-label="Clear list search"
                    className="text-primary/70 hover:text-primary"
                  >
                    <X size={11} />
                  </span>
                </span>
              )}
            </button>

            <span className="w-px h-5 bg-on-surface/[0.10] flex-shrink-0 mx-1" aria-hidden="true" />

            {/* Recipe sort pills — inline rather than a modal sheet, so
                the user can switch sort without an extra click. */}
            {(['recent', 'highest', 'lowest', 'quickest'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSortBy(s)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-8 px-3 rounded-full transition-colors text-[12px] font-semibold flex-shrink-0',
                  sortBy === s
                    ? 'bg-primary/[0.10] text-primary hover:bg-primary/[0.14]'
                    : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/[0.08] hover:text-on-surface',
                )}
              >
                {s === 'recent' ? 'Recent' : s === 'highest' ? 'Highest' : s === 'lowest' ? 'Lowest' : 'Quickest'}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-3 flex-shrink-0">
              {meals.length > 0 && (
                <p className="text-[12px] text-on-surface/50 whitespace-nowrap tabular-nums">
                  <span className="font-bold text-on-surface">{filteredMeals.length}</span>
                  {filteredMeals.length !== meals.length && (
                    <span className="text-on-surface/35"> / {meals.length}</span>
                  )}
                  {visibleAvg !== null && (
                    <>
                      <span className="text-on-surface/25 mx-1.5">·</span>
                      <span>Avg <span className="font-bold text-on-surface">{visibleAvg.toFixed(1)}</span></span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-6">
            <button onClick={onBack} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
              <ArrowLeft size={20} />
            </button>
            <ChefHat size={22} className="text-emerald-600" />
            <div className="flex-1 min-w-0">
              <h2 className="font-serif font-bold text-xl">Home Cooking</h2>
              <p className="text-xs text-on-surface/40">{meals.length} meal{meals.length !== 1 ? 's' : ''} logged</p>
            </div>
            <button onClick={() => setSearchOpen(!searchOpen)}
              className={cn("p-2 rounded-full transition-colors", searchOpen ? "text-primary bg-primary/10" : "text-on-surface/40 hover:text-on-surface")}>
              <Search size={18} />
            </button>
            <button onClick={() => onOpenModal()}
              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors" title="Log a meal">
              <Plus size={20} />
            </button>
          </div>

          {/* Phone-only inline search toggle */}
          <AnimatePresence>
            {searchOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mb-3">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
                  <input
                    type="text"
                    placeholder="Search meals or dishes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    className="w-full pl-9 pr-4 py-2.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/40 transition-all"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phone-only sort pills */}
          <div className="flex gap-2 mb-4">
            {(['recent', 'highest'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={cn("px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                  sortBy === s ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-on-surface/5 text-on-surface/50 border-transparent")}
              >
                {s === 'recent' ? 'Recent' : 'Highest Rated'}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Meal cards */}
      {filteredMeals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <UtensilsCrossed size={40} className="text-on-surface/15 mb-3" />
          <p className="text-sm font-semibold text-on-surface/40 mb-1">
            {searchQuery.trim() ? 'No meals found' : 'No meals logged yet'}
          </p>
          <p className="text-xs text-on-surface/30 mb-4 max-w-[220px]">
            {searchQuery.trim() ? 'Try a different search' : 'Tap + to log your first home-cooked meal'}
          </p>
          {!searchQuery.trim() && (
            <button onClick={() => onOpenModal()}
              className="px-4 py-2 bg-emerald-600 text-white rounded-full text-sm font-semibold hover:bg-emerald-700 transition-colors">
              Log a Meal
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-on-surface/[0.06]">
          {filteredMeals.map((meal) => {
            const coverPhoto = getMealCoverUrl(meal);
            const totalTime = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
            const ingredientPreview = (meal.ingredients ?? []).slice(0, 6);
            return (
              <li key={meal.id} className="relative group/row">
                <button
                  onClick={() => onSelectMeal(meal.id)}
                  className="w-full flex gap-4 py-4 text-left group active:scale-[0.99] transition-transform"
                >
                  {/* Photo thumbnail */}
                  <div className="w-24 h-24 rounded-2xl overflow-hidden bg-on-surface/[0.05] flex-shrink-0">
                    {coverPhoto ? (
                      <img src={coverPhoto} alt={meal.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-emerald-50">
                        <ChefHat size={28} className="text-emerald-300" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2 flex-1">{meal.name}</h3>
                      {/* Score sits next to a placeholder gap so the pencil button (absolute-positioned)
                           doesn't overlap the number on narrow rows. */}
                      <span className={cn("text-lg font-serif font-bold flex-shrink-0 leading-none pt-0.5 mr-7", scoreColor(meal.score))}>
                        {meal.score.toFixed(1)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider">
                      {totalTime > 0 ? (
                        <>
                          <Clock size={11} />
                          <span>{formatDuration(totalTime)}</span>
                          {meal.difficulty && <><span className="text-on-surface/25">·</span><span>{meal.difficulty}</span></>}
                        </>
                      ) : meal.dishes.length > 0 ? (
                        <span>{meal.dishes.length} dish{meal.dishes.length !== 1 ? 'es' : ''}</span>
                      ) : null}
                    </div>

                    {ingredientPreview.length > 0 && (
                      <p className="text-[12px] text-on-surface/50 mt-1 leading-snug line-clamp-2">
                        {ingredientPreview.map((i) => i.name).filter(Boolean).join(', ')}
                        {(meal.ingredients?.length ?? 0) > 6 ? '…' : ''}
                      </p>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenModal(meal); }}
                  aria-label={`Edit ${meal.name}`}
                  className="absolute top-4 right-0 p-1.5 rounded-full text-on-surface/35 hover:text-emerald-600 hover:bg-emerald-50 transition-colors sm:opacity-0 sm:group-hover/row:opacity-100 focus:opacity-100"
                >
                  <Edit3 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/* ── Reusable bottom-sheet pickers ──
   These three sheets render the same kind of pop-up the rated view's
   City / Cuisine / Price / Sort pills open. Extracted so the wishlist
   (and any future list view) can reuse them with its own state. */

const FilterListSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  placeholder: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}> = ({ open, onClose, title, placeholder, options, selected, onToggle }) => {
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  const q = search.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={cn(
              'fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden',
              phoneMode ? 'max-h-[92vh]' : 'max-h-[70vh]',
            )}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/[0.06] flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">{title}</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            <div className="px-5 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input
                  type="text"
                  placeholder={placeholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {filtered.length === 0 ? (
                <p className="text-center py-8 text-sm text-on-surface/40">No matches</p>
              ) : filtered.map((opt) => {
                const isSelected = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() => onToggle(opt)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-3 border-b border-on-surface/[0.05] text-left transition-colors',
                      isSelected ? 'text-primary bg-primary/[0.03]' : 'text-on-surface/70 hover:bg-on-surface/[0.03]',
                    )}
                  >
                    <span className="text-sm font-medium">{opt}</span>
                    {isSelected && <Check size={16} className="text-primary" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const PricePickerSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (v: string | null) => void;
}> = ({ open, onClose, value, onChange }) => {
  const { phoneMode } = useSettings();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl"
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="px-5 pt-3 pb-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif font-bold text-base">Price Range</h3>
                <button onClick={onClose} className="w-7 h-7 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={14} className="text-on-surface/60" />
                </button>
              </div>
              <div className="flex gap-2">
                {['$', '$$', '$$$', '$$$$'].map((p) => (
                  <button
                    key={p}
                    onClick={() => { onChange(value === p ? null : p); onClose(); }}
                    className={cn(
                      'flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2',
                      value === p ? 'border-primary bg-primary/[0.05] text-primary' : 'border-on-surface/10 text-on-surface/50 hover:border-on-surface/20',
                    )}
                  >{p}</button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const SortPickerSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}> = ({ open, onClose, value, onChange, options }) => {
  const { phoneMode } = useSettings();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-[60]" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl"
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="px-5 pt-3 pb-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-serif font-bold text-base">Sort By</h3>
                <button onClick={onClose} className="w-7 h-7 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={14} className="text-on-surface/60" />
                </button>
              </div>
              <div className="space-y-1.5">
                {options.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { onChange(key); onClose(); }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-3 rounded-xl transition-colors text-left',
                      value === key ? 'bg-primary/5 text-primary' : 'text-on-surface/70 hover:bg-on-surface/[0.03]',
                    )}
                  >
                    <span className="text-sm font-medium">{label}</span>
                    {value === key && <Check size={16} className="text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── Combined Restaurants/Recipes tab + list-selector ──
   The active tab carries the current list info (emoji + name + count
   + chevron) and toggles a dropdown when clicked. The inactive tab
   just shows its category label and switches sections on click. */
const CombinedTabButton: React.FC<{
  isActive: boolean;
  inactiveLabel: string;
  activeEmoji: string;
  activeName: string;
  activeCount: number;
  dropdownOpen: boolean;
  onClick: () => void;
}> = ({ isActive, inactiveLabel, activeEmoji, activeName, activeCount, dropdownOpen, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-haspopup={isActive ? 'menu' : undefined}
    aria-expanded={isActive ? dropdownOpen : undefined}
    className={cn(
      'inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
      isActive
        ? 'bg-white text-on-surface shadow-sm'
        : 'text-on-surface/45 hover:text-on-surface/65',
    )}
  >
    {isActive ? (
      <>
        <span className="text-base leading-none">{activeEmoji}</span>
        <span>{activeName}</span>
        <span className="text-[11px] tabular-nums text-on-surface/40">{activeCount}</span>
        <ChevronDown
          size={13}
          className={cn('text-on-surface/45 transition-transform', dropdownOpen && 'rotate-180')}
        />
      </>
    ) : inactiveLabel}
  </button>
);

/* ── Reusable filter chip used in the rated-view toolbar ──
   One consistent chip token: rounded-full, neutral by default, primary
   tint when active, optional badge / icon / clear-X. Putting this in
   one component keeps the toolbar row visually uniform — all the
   filter buttons read as a cluster instead of five mismatched pills. */
const FilterPill: React.FC<{
  onClick: () => void;
  label: string;
  active?: boolean;
  icon?: React.ReactNode;
  badge?: number;
  onClear?: () => void;
}> = ({ onClick, label, active = false, icon, badge, onClear }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 h-8 px-3 rounded-full transition-colors text-[12px] font-semibold flex-shrink-0',
      active
        ? 'bg-primary/[0.10] text-primary hover:bg-primary/[0.14]'
        : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/[0.08] hover:text-on-surface',
    )}
  >
    {icon}
    <span>{label}</span>
    {badge !== undefined && (
      <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold">
        {badge}
      </span>
    )}
    {onClear ? (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onClear(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClear(); } }}
        aria-label="Clear"
        className="ml-0.5 text-current/70 hover:text-current"
      >
        <X size={10} />
      </span>
    ) : (
      <ChevronDown size={10} className="opacity-60" />
    )}
  </button>
);

/* ── Anchored pill + popover (desktop) ──
   Dropdowns that hang under the pill button instead of sliding up
   from the bottom of the screen. The phone version (sheet) is still
   used when phoneMode is on. Shared shell handles outside-click +
   Escape so each callsite just renders content. */

const AnchoredPopover: React.FC<{
  open: boolean;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}> = ({ open, onClose, width = 'w-[280px]', children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -4 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'absolute top-full left-0 mt-2 z-50 bg-surface rounded-2xl',
            'shadow-[0_18px_48px_-12px_rgba(0,0,0,0.22)] ring-1 ring-on-surface/[0.06]',
            'overflow-hidden',
            width,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Wraps the FilterPill button + an anchored popover. Handles outside-
// click. Each pill type passes its own dropdown content via children.
const AnchoredPill: React.FC<{
  pill: {
    icon?: React.ReactNode;
    label: string;
    active?: boolean;
    badge?: number;
    onClear?: () => void;
  };
  popoverWidth?: string;
  children: (close: () => void) => React.ReactNode;
}> = ({ pill, popoverWidth, children }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={wrapRef} className="relative inline-flex flex-shrink-0">
      <FilterPill
        onClick={() => setOpen((o) => !o)}
        icon={pill.icon}
        label={pill.label}
        active={pill.active}
        badge={pill.badge}
        onClear={pill.onClear}
      />
      <AnchoredPopover open={open} onClose={() => setOpen(false)} width={popoverWidth}>
        {children(() => setOpen(false))}
      </AnchoredPopover>
    </div>
  );
};

// Compact $/$$/$$$/$$$$ row — drop-in for the anchored Price pill.
const PricePickerContent: React.FC<{
  value: string | null;
  onChange: (v: string | null) => void;
}> = ({ value, onChange }) => (
  <div className="p-3">
    <div className="flex gap-1.5">
      {['$', '$$', '$$$', '$$$$'].map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(value === p ? null : p)}
          className={cn(
            'flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-all border-2',
            value === p
              ? 'border-primary bg-primary/[0.05] text-primary'
              : 'border-on-surface/[0.10] text-on-surface/55 hover:border-on-surface/25',
          )}
        >{p}</button>
      ))}
    </div>
  </div>
);

// Vertical list of sort options — drop-in for the anchored Sort pill.
const SortPickerContent: React.FC<{
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="p-2">
    {options.map(([key, label]) => (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left',
          value === key ? 'bg-primary/[0.06] text-primary' : 'text-on-surface/75 hover:bg-on-surface/[0.04]',
        )}
      >
        <span className="text-[13px] font-medium">{label}</span>
        {value === key && <Check size={14} className="text-primary" />}
      </button>
    ))}
  </div>
);

// Searchable scrollable list — used inside CityPill + CuisinePill
// popovers. Lighter chrome than FilterListSheet (no big header bar).
const SearchableMultiSelect: React.FC<{
  placeholder: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}> = ({ placeholder, options, selected, onToggle }) => {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  return (
    <div className="flex flex-col max-h-[340px]">
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
          <input
            autoFocus
            type="text"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-on-surface/[0.05] rounded-xl py-2 pl-9 pr-3 text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {filtered.length === 0 ? (
          <p className="text-center py-6 text-[13px] text-on-surface/40">No matches</p>
        ) : filtered.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors',
                isSelected ? 'bg-primary/[0.06] text-primary' : 'text-on-surface/75 hover:bg-on-surface/[0.04]',
              )}
            >
              <span className="text-[13px] font-medium truncate pr-2">{opt}</span>
              {isSelected && <Check size={14} className="text-primary flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ── Desktop list switcher row ── */
const SwitcherRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ icon, label, count, active, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors text-left',
      active
        ? 'bg-on-surface/[0.06] text-on-surface font-bold'
        : 'text-on-surface/70 hover:text-on-surface hover:bg-on-surface/[0.04] font-medium',
    )}
  >
    <span className="flex-shrink-0 w-5 inline-flex justify-center items-center">{icon}</span>
    <span className="flex-1 truncate">{label}</span>
    <span className="text-[11px] tabular-nums text-on-surface/40">{count}</span>
  </button>
);

export const Pantry: React.FC = () => {
  const [selectedList, setSelectedList] = useState<CustomList | null>(null);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  // Which tab the create-list sheet was opened from — controls which presets
  // appear and whether a custom list is tagged as a recipe list.
  const [createSheetKind, setCreateSheetKind] = useState<'restaurants' | 'recipes'>('restaurants');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [pantryTab, setPantryTab] = useState<PantryTab>('restaurants');
  const [showTrips, setShowTrips] = useState(false);
  const [showHomeCooking, setShowHomeCooking] = useState(false);
  const [homeCookingSelectedMealId, setHomeCookingSelectedMealId] = useState<string | null>(null);
  // Set to true when the user taps the rated "Your canvas" tile from the
  // landing card grid — drops into the existing rated-list rendering.
  const [showAllRated, setShowAllRated] = useState(false);
  const [createTripFromList, setCreateTripFromList] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { phoneMode, setHideBottomNav } = useSettings();
  const { setScopedSearch, bumpFocus, scopedSearch } = usePageSearch();
  const { setOverride: setPageAddAction } = usePageAddAction();

  // Spotlight-style search popup — opened by the desktop header's
  // "Add Rating" button. Mode determines what the popup shows:
  //   - 'rate-new'        Main rated page. Search-only, picking a place
  //                       opens the Add Rating modal so the user can rate
  //                       it on the spot.
  //   - 'add-to-list'     Custom restaurant list / Wishlist. Shows your
  //                       rated restaurants up top (one-tap to add to
  //                       the list, no rating modal — already rated)
  //                       plus search results below (pick → adds to list
  //                       AND opens the Add Rating modal).
  const [searchPopupOpen, setSearchPopupOpen] = useState(false);
  const [searchPopupMode, setSearchPopupMode] = useState<'rate-new' | 'add-to-list'>('rate-new');

  // On phone, always use list view
  const effectiveViewMode = phoneMode ? 'list' : viewMode;

  // Filters
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [cuisineFilter, setCuisineFilter] = useState<string[]>([]);
  const [priceFilter, setPriceFilter] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'added' | 'custom'>('highest');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Quick filter dropdowns
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cuisineDropdownOpen, setCuisineDropdownOpen] = useState(false);
  const [priceDropdownOpen, setPriceDropdownOpen] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  const closeAllDropdowns = () => { setCityDropdownOpen(false); setCuisineDropdownOpen(false); setPriceDropdownOpen(false); setSortDropdownOpen(false); };

  const sortLabels: Record<string, string> = { recent: 'Recent', highest: 'Highest', lowest: 'Lowest', added: 'Date Added', custom: 'Custom' };

  // Main search
  const [mainSearchQuery, setMainSearchQuery] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // ── Scoped header search ──
  // Clicking "Search this list" hijacks the desktop header input so the
  // page can be filtered without an in-page search bar. The page owns
  // the query state (mainSearchQuery for the rated view); we mirror it
  // back into the context so the header shows the live value, and the
  // header calls setMainSearchQuery on every keystroke.
  const activateRatedScope = useCallback(() => {
    setScopedSearch({
      scopeName: 'All Rated',
      placeholder: 'Search this list…',
      query: mainSearchQuery,
      setQuery: setMainSearchQuery,
      onDismiss: () => setMainSearchQuery(''),
    });
    bumpFocus();
  }, [mainSearchQuery, setScopedSearch, bumpFocus]);

  // Keep the scope's query field in lockstep with mainSearchQuery so the
  // header input always shows the current filter text. Guard against an
  // update loop by only re-setting when the values actually differ.
  useEffect(() => {
    if (scopedSearch && scopedSearch.scopeName === 'All Rated' && scopedSearch.query !== mainSearchQuery) {
      setScopedSearch({ ...scopedSearch, query: mainSearchQuery });
    }
  }, [mainSearchQuery, scopedSearch, setScopedSearch]);

  // The rated-view scope only makes sense on the rated landing — drop
  // it the moment the user picks a sub-view or specific list.
  useEffect(() => {
    if (scopedSearch?.scopeName === 'All Rated' && (selectedList || showHomeCooking || showTrips)) {
      setScopedSearch(null);
    }
  }, [selectedList, showHomeCooking, showTrips, scopedSearch, setScopedSearch]);

  // Desktop list switcher — replaces the sidebar's old Pantry tray. The
  // button shows the current view ("All Rated", "All Recipes", "Wishlist"),
  // and a popover lists every other list grouped by Restaurants / Recipes
  // so the user can jump between them without leaving the page.
  const [listSwitcherOpen, setListSwitcherOpen] = useState(false);
  const listSwitcherRef = useRef<HTMLDivElement>(null);

  // Close more menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    };
    if (moreMenuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!listSwitcherOpen) return;
    const handle = (e: MouseEvent) => {
      if (listSwitcherRef.current && !listSwitcherRef.current.contains(e.target as Node)) {
        setListSwitcherOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [listSwitcherOpen]);

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

  // Hide bottom nav when filter/city/cuisine sheets are open, or when we're
  // viewing a home meal detail page (it has its own back button / actions).
  useEffect(() => {
    const anyOpen = filtersOpen || cityDropdownOpen || cuisineDropdownOpen || priceDropdownOpen || sortDropdownOpen || homeCookingSelectedMealId !== null;
    setHideBottomNav(anyOpen);
    return () => setHideBottomNav(false);
  }, [filtersOpen, cityDropdownOpen, cuisineDropdownOpen, priceDropdownOpen, sortDropdownOpen, homeCookingSelectedMealId, setHideBottomNav]);

  const {
    lists, createList,
    ratings, openAddRestaurantModal, removeRating,
    wishlist,
    getListsForRestaurant,
    trips, createTrip, updateTrip, deleteTrip,
    addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip,
    addHotelToTrip, updateHotel, removeHotelFromTrip,
    rateRestaurant, cacheRestaurantMeta, addToList,
    customOrder, setCustomOrder,
    homeMeals, createHomeMeal, updateHomeMeal, deleteHomeMeal, openHomeMealModal,
    openAddRecipeModal,
  } = useLists();

  /**
   * URL-driven view selection. The desktop sidebar navigates between
   * lists by setting query params:
   *   ?list=__wishlist__   → synthetic Wishlist view
   *   ?list=<custom-id>    → user-created list
   *   ?view=home-cooking   → Home Cooking grid
   *   ?view=trips          → Trips planner
   *   ?new-list=1          → opens the create-list sheet, then strips
   *                          the param so a refresh doesn't re-open it
   * Plain `/pantry` resets back to the main lists overview.
   *
   * Crucially this effect's deps are URL-only — `lists` lives in a
   * sibling effect below. Mixing them caused a regression where any
   * list mutation (e.g. addToList) re-ran this effect, found no URL
   * params (because the user had navigated via state, not URL), and
   * blew selectedList back to null — i.e. dumped the user back to the
   * rated view mid-action.
   */
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const listId = sp.get('list');
    const view = sp.get('view');
    const newList = sp.get('new-list');

    // Open the create-list sheet from the sidebar's "+ New List" entry.
    // Strip the param right away so the sheet doesn't re-open if the
    // user closes it without leaving the page.
    if (newList === '1') {
      setCreateSheetOpen(true);
      sp.delete('new-list');
      navigate({ pathname: location.pathname, search: sp.toString() ? `?${sp.toString()}` : '' }, { replace: true });
      return;
    }

    if (view === 'home-cooking') {
      setShowHomeCooking(true);
      setShowTrips(false);
      setSelectedList(null);
      return;
    }
    if (view === 'trips') {
      setShowTrips(true);
      setShowHomeCooking(false);
      setSelectedList(null);
      return;
    }

    if (listId) {
      setShowTrips(false);
      setShowHomeCooking(false);
      if (listId === '__wishlist__') {
        // Synthetic list — Pantry rebuilds wishlistIds from the regular
        // wishlist below, so any object with this id flows through the
        // same code path the pill row used.
        setSelectedList({
          id: '__wishlist__', name: 'Wishlist', emoji: '❤️',
          restaurantIds: [], wishlistIds: [], createdAt: 0,
        } as CustomList);
      } else {
        // Stash the id; the lists-driven effect below will fill in the
        // real list object once data is available.
        setSelectedList((prev) => prev?.id === listId
          ? prev
          : ({ id: listId, name: '', emoji: '', restaurantIds: [], wishlistIds: [], createdAt: 0 } as CustomList));
      }
      return;
    }

    // Plain /pantry — clear any sub-view state.
    setSelectedList(null);
    setShowHomeCooking(false);
    setShowTrips(false);
  }, [location.pathname, location.search, navigate]);

  // Reconcile selectedList against fresh `lists` data. Runs on every
  // lists update (e.g. after addToList) and re-points selectedList at
  // the latest object so the page renders fresh contents — without
  // triggering the URL effect, which would otherwise wipe state.
  useEffect(() => {
    if (!selectedList || selectedList.id === '__wishlist__') return;
    const found = lists.find((l) => l.id === selectedList.id);
    if (found && found !== selectedList) setSelectedList(found);
  }, [lists, selectedList]);

  const listScrollRef = useRef<HTMLDivElement>(null);

  // Clear drag on global pointer up
  useEffect(() => {
    const up = () => setDragIdx(null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

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

    if (sortBy === 'custom') {
      const orderMap = new Map(customOrder.map((id, i) => [id, i]));
      result.sort((a, b) => {
        const ai = orderMap.get(a.restaurantId) ?? Infinity;
        const bi = orderMap.get(b.restaurantId) ?? Infinity;
        return ai - bi;
      });
    } else if (sortBy === 'highest') result.sort((a, b) => b.score - a.score);
    else if (sortBy === 'lowest') result.sort((a, b) => a.score - b.score);
    else if (sortBy === 'added') result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return result;
  }, [ratings, mainSearchQuery, cityFilter, cuisineFilter, priceFilter, scoreRange, sortBy, customOrder]);

  // Drag-to-reorder for custom sort
  const moveRating = useCallback((from: number, to: number) => {
    if (from === to) return;
    const ids = filteredRatings.map((r) => r.restaurantId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const fullOrder = [...ids, ...customOrder.filter((id) => !ids.includes(id))];
    setCustomOrder(fullOrder);
  }, [filteredRatings, customOrder, setCustomOrder]);

  const regularRatingsCount = useMemo(() => ratings.filter((r) => r.cuisine !== 'Hotel Breakfast').length, [ratings]);
  const regularWishlist = useMemo(() => wishlist.filter((w) => w.cuisine !== 'Hotel Breakfast'), [wishlist]);

  const activeFilterCount = (cityFilter.length > 0 ? 1 : 0) + (cuisineFilter.length > 0 ? 1 : 0) + (priceFilter ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (sortBy !== 'recent' && sortBy !== 'custom' && sortBy !== 'highest' ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  // Seed custom order from current sort if empty when switching to custom
  const handleSortBy = useCallback((v: typeof sortBy) => {
    if (v === 'custom' && customOrder.length === 0) {
      const sorted = [...ratings.filter((r) => r.cuisine !== 'Hotel Breakfast')].sort((a, b) => b.score - a.score);
      setCustomOrder(sorted.map((r) => r.restaurantId));
    }
    setSortBy(v);
  }, [customOrder, ratings, setCustomOrder]);

  const handleResetFilters = () => {
    setCityFilter([]); setCuisineFilter([]); setPriceFilter(null);
    setScoreRange([0, 10]); setSortBy('highest');
  };

  const toggleCityFilter = (city: string) => setCityFilter((prev) => prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]);
  const toggleCuisineFilter = (cuisine: string) => setCuisineFilter((prev) => prev.includes(cuisine) ? prev.filter((c) => c !== cuisine) : [...prev, cuisine]);

  // Keep selectedList in sync
  const currentList = selectedList
    ? selectedList.id === '__wishlist__'
      ? { ...selectedList, wishlistIds: regularWishlist.map((w) => w.restaurantId) } as CustomList
      : lists.find((l) => l.id === selectedList.id) ?? null
    : null;

  // The card-grid landing is phone-only — desktop lands on the rated list
  // directly and uses the on-page list switcher to jump between lists.
  // Hide the top More menu on that phone landing — the import/export/
  // reorder actions live on the rated list where they make sense.
  const onPhoneCardHome =
    phoneMode && !currentList && !showHomeCooking && !showTrips && !showAllRated;
  const hideTopBar =
    (showHomeCooking && homeCookingSelectedMealId !== null) || onPhoneCardHome;

  // ── Override the desktop header's Add CTA per view ──
  // Phone keeps the default behavior. On desktop, the button label and
  // click handler swap based on which list is open:
  //   • Recipe view (All Recipes or a custom recipe list) → "Add Recipe",
  //     opens the right recipe modal directly (HomeMeal modal for All
  //     Recipes; AddRecipeModal scoped to the list otherwise).
  //   • Custom restaurant list / Wishlist → "Add Rating", opens the
  //     SearchPopup in 'add-to-list' mode (rated section + search).
  //   • Rated list → "Add Rating", opens the SearchPopup in 'rate-new'
  //     mode (search-only — your rated places are already on the page).
  //   • Trips / phone card landing → fall through to the default
  //     /search/main route.
  useEffect(() => {
    if (phoneMode || onPhoneCardHome) {
      setPageAddAction(null);
      return;
    }
    if (showTrips) {
      setPageAddAction(null);
      return;
    }
    if (showHomeCooking) {
      setPageAddAction({
        label: 'Add Recipe',
        onClick: () => openHomeMealModal(),
      });
      return;
    }
    if (selectedList && selectedList.type === 'home-cooking') {
      setPageAddAction({
        label: 'Add Recipe',
        onClick: () => openAddRecipeModal(selectedList.id),
      });
      return;
    }
    if (selectedList) {
      // Wishlist or custom restaurant list → SearchPopup with rated
      // section so the user can one-tap their already-rated places into
      // the list.
      setPageAddAction({
        label: 'Add Rating',
        onClick: () => { setSearchPopupMode('add-to-list'); setSearchPopupOpen(true); },
      });
      return;
    }
    // Default rated view (with or without showAllRated): search-only popup.
    setPageAddAction({
      label: 'Add Rating',
      onClick: () => { setSearchPopupMode('rate-new'); setSearchPopupOpen(true); },
    });
  }, [phoneMode, onPhoneCardHome, showTrips, showHomeCooking, selectedList, openHomeMealModal, openAddRecipeModal, setPageAddAction]);

  // Reset the override when Pantry unmounts so other pages start clean.
  useEffect(() => {
    return () => { setPageAddAction(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which top-level desktop tab is the user currently on? Derived so any
  // path into a recipe-y view (cookbook, recipe sub-list) lights up the
  // Recipes tab; everything else (rated, wishlist, restaurant sub-list)
  // sits under Restaurants.
  const activeDesktopTab: 'restaurants' | 'recipes' = showHomeCooking
    ? 'recipes'
    : (selectedList && selectedList.type === 'home-cooking')
      ? 'recipes'
      : 'restaurants';

  // Tab clicks reset to that tab's default landing. Trips is its own
  // top-level mode — clicking either tab leaves it.
  const goToRestaurantsTab = () => {
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList(null); setShowAllRated(false);
    if (location.search) navigate('/pantry');
  };
  const goToRecipesTab = () => {
    setSelectedList(null); setShowTrips(false); setShowAllRated(false);
    setShowHomeCooking(true);
  };

  // Identity of the currently visible top-level view, used to label the
  // list switcher button. Now that the tab pill also persists when a
  // sub-list is open, derive from selectedList first so opening
  // Wishlist or "Best Pizza" updates the active tab's label/count
  // instead of stranding "All Rated" up there.
  const currentViewLabel = (() => {
    if (selectedList) {
      if (selectedList.id === '__wishlist__') {
        return { emoji: '❤️', name: 'Wishlist', count: regularWishlist.length };
      }
      const isRecipeList = selectedList.type === 'home-cooking';
      const count = isRecipeList
        ? (selectedList.recipes?.length || 0)
        : selectedList.restaurantIds.length + (selectedList.wishlistIds?.length || 0);
      return { emoji: selectedList.emoji, name: selectedList.name, count };
    }
    if (showHomeCooking) return { emoji: '🍳', name: 'All Recipes', count: homeMeals.length };
    if (showTrips) return { emoji: '✈️', name: 'Trips', count: trips.length };
    return { emoji: '⭐', name: 'All Rated', count: regularRatingsCount };
  })();

  // Restaurant + recipe lists split for the popover sections.
  const restaurantListsForSwitcher = useMemo(
    () => lists.filter((l) => l.type !== 'home-cooking'),
    [lists],
  );
  const recipeListsForSwitcher = useMemo(
    () => lists.filter((l) => l.type === 'home-cooking'),
    [lists],
  );

  // Helpers to drive the switcher's destinations through the existing
  // showHomeCooking / showTrips / selectedList state machine.
  const switchToRated = () => {
    setListSwitcherOpen(false);
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList(null); setShowAllRated(false);
    if (location.pathname !== '/pantry' || location.search) navigate('/pantry');
  };
  const switchToWishlist = () => {
    setListSwitcherOpen(false);
    setShowHomeCooking(false); setShowTrips(false);
    setShowAllRated(false);
    setSelectedList({
      id: '__wishlist__', name: 'Wishlist', emoji: '❤️',
      restaurantIds: [], wishlistIds: regularWishlist.map((w) => w.restaurantId),
      createdAt: 0,
    } as CustomList);
  };
  const switchToList = (list: CustomList) => {
    setListSwitcherOpen(false);
    setShowHomeCooking(false); setShowTrips(false); setShowAllRated(false);
    setSelectedList(list);
  };
  const switchToAllRecipes = () => {
    setListSwitcherOpen(false);
    setSelectedList(null); setShowTrips(false); setShowAllRated(false);
    setShowHomeCooking(true);
  };
  const switchToTrips = () => {
    setListSwitcherOpen(false);
    setSelectedList(null); setShowHomeCooking(false); setShowAllRated(false);
    setShowTrips(true);
  };

  return (
    <div className="pb-32">
      {/* Combined tabs + list selector — desktop only.
          The tab pill IS the list selector: each tab shows the active
          list within its section (emoji + name + count + chevron).
          Click the active tab → dropdown of that section's lists.
          Click the inactive tab → switch to it. The dropdown adapts
          to whichever tab is active so Restaurants only sees
          restaurant lists, and Recipes only sees recipe lists.
          Now shows even when a sub-list is selected so navigation
          stays consistent — opening Wishlist or a custom list keeps
          the same chrome and just swaps the list content below.
          Hidden on phone (card landing handles it) and in trips. */}
      {!hideTopBar && (
        <div className="flex items-center justify-between gap-3 px-3 pt-4 pb-5">
          {!phoneMode && !showTrips ? (
            <div className="relative" ref={listSwitcherRef}>
              <div className="inline-flex bg-on-surface/[0.06] rounded-full p-1">
                <CombinedTabButton
                  isActive={activeDesktopTab === 'restaurants'}
                  inactiveLabel="Restaurants"
                  activeEmoji={currentViewLabel.emoji}
                  activeName={currentViewLabel.name}
                  activeCount={currentViewLabel.count}
                  dropdownOpen={listSwitcherOpen}
                  onClick={() => {
                    if (activeDesktopTab === 'restaurants') {
                      setListSwitcherOpen((o) => !o);
                    } else {
                      goToRestaurantsTab();
                      setListSwitcherOpen(false);
                    }
                  }}
                />
                <CombinedTabButton
                  isActive={activeDesktopTab === 'recipes'}
                  inactiveLabel="Recipes"
                  activeEmoji={currentViewLabel.emoji}
                  activeName={currentViewLabel.name}
                  activeCount={currentViewLabel.count}
                  dropdownOpen={listSwitcherOpen}
                  onClick={() => {
                    if (activeDesktopTab === 'recipes') {
                      setListSwitcherOpen((o) => !o);
                    } else {
                      goToRecipesTab();
                      setListSwitcherOpen(false);
                    }
                  }}
                />
              </div>

              <AnimatePresence>
                {listSwitcherOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, scale: 0.97, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: -4 }}
                    transition={{ duration: 0.14, ease: 'easeOut' }}
                    className="absolute left-0 top-full mt-2 w-72 max-h-[70vh] overflow-y-auto bg-surface rounded-2xl shadow-xl border border-on-surface/[0.08] z-50 py-2"
                  >
                    {activeDesktopTab === 'restaurants' ? (
                      <>
                        <SwitcherRow
                          icon={<span className="text-base leading-none">⭐</span>}
                          label="All Rated"
                          count={regularRatingsCount}
                          active={!showHomeCooking && !showTrips && !selectedList}
                          onClick={switchToRated}
                        />
                        <SwitcherRow
                          icon={<Heart size={14} className="text-red-400 fill-red-400" />}
                          label="Wishlist"
                          count={regularWishlist.length}
                          active={selectedList?.id === '__wishlist__'}
                          onClick={switchToWishlist}
                        />
                        {restaurantListsForSwitcher.map((l) => (
                          <SwitcherRow
                            key={l.id}
                            icon={<span className="text-base leading-none">{l.emoji}</span>}
                            label={l.name}
                            count={l.restaurantIds.length + (l.wishlistIds?.length || 0)}
                            active={selectedList?.id === l.id}
                            onClick={() => switchToList(l)}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => { setListSwitcherOpen(false); setCreateSheetKind('restaurants'); setCreateSheetOpen(true); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold text-primary hover:bg-primary/[0.06] transition-colors"
                        >
                          <Plus size={14} />
                          <span>New restaurant list</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <SwitcherRow
                          icon={<ChefHat size={14} className="text-emerald-600" />}
                          label="All Recipes"
                          count={homeMeals.length}
                          active={showHomeCooking}
                          onClick={switchToAllRecipes}
                        />
                        {recipeListsForSwitcher.map((l) => (
                          <SwitcherRow
                            key={l.id}
                            icon={<span className="text-base leading-none">{l.emoji}</span>}
                            label={l.name}
                            count={l.recipes?.length || 0}
                            active={selectedList?.id === l.id}
                            onClick={() => switchToList(l)}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => { setListSwitcherOpen(false); setCreateSheetKind('recipes'); setCreateSheetOpen(true); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold text-primary hover:bg-primary/[0.06] transition-colors"
                        >
                          <Plus size={14} />
                          <span>New recipe list</span>
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : <div />}

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
                  <button onClick={() => { setMoreMenuOpen(false); navigate('/reorder'); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/3 transition-colors text-left border-t border-on-surface/5">
                    <ArrowUpDown size={16} className="text-on-surface/40" />
                    <span className="text-sm font-medium text-on-surface/70">Reorder ratings</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <main className="px-3">
        {currentList ? (
          <ListDetailView list={currentList} viewMode={effectiveViewMode} onViewModeChange={setViewMode} onBack={() => navigate('/pantry')} />
        ) : showHomeCooking ? (
          <HomeCookingTab
            meals={homeMeals}
            onCreateMeal={createHomeMeal}
            onUpdateMeal={updateHomeMeal}
            onDeleteMeal={deleteHomeMeal}
            onOpenModal={openHomeMealModal}
            onBack={() => { setHomeCookingSelectedMealId(null); navigate("/pantry"); }}
            selectedMealId={homeCookingSelectedMealId}
            onSelectMeal={setHomeCookingSelectedMealId}
            // On desktop the page-level Restaurants/Recipes tabs already
            // own the chrome — drop HomeCookingTab's local header so we
            // don't render duplicate titles + back arrows.
            hideHeader={!phoneMode && homeCookingSelectedMealId === null}
          />
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
            onBack={() => navigate("/pantry")}
            autoCreate={createTripFromList}
            onAutoCreateHandled={() => setCreateTripFromList(false)}
          />
        ) : phoneMode && !showAllRated ? (
          // Phone-only card landing. Tapping Wishlist, "Your canvas", or
          // "All Recipes" routes back into the existing list / rated /
          // cookbook views. The "+ New" cards on each tab open the
          // create-list sheet seeded with the right kind so a custom
          // list lands on the correct tab. Desktop skips this and goes
          // straight to the rated-list view (with on-page list switcher).
          <PhonePantryHome
            lists={lists}
            ratedCount={regularRatingsCount}
            ratedTopScores={ratings
              .filter((r) => r.cuisine !== 'Hotel Breakfast')
              .map((r) => r.score)
              .sort((a, b) => b - a)
              .slice(0, 3)}
            wishlistCount={regularWishlist.length}
            homeMeals={homeMeals}
            tab={pantryTab}
            onTabChange={setPantryTab}
            onOpenList={setSelectedList}
            onOpenWishlist={() =>
              setSelectedList({
                id: '__wishlist__',
                name: 'Wishlist',
                emoji: '❤️',
                restaurantIds: [],
                wishlistIds: regularWishlist.map((w) => w.restaurantId),
                createdAt: 0,
              } as CustomList)
            }
            onOpenRated={() => setShowAllRated(true)}
            onCreateRestaurantList={() => { setCreateSheetKind('restaurants'); setCreateSheetOpen(true); }}
            onOpenAllRecipes={() => setShowHomeCooking(true)}
            onCreateRecipeList={() => { setCreateSheetKind('recipes'); setCreateSheetOpen(true); }}
          />
        ) : (
          <>
            {/* When we entered the rated view from the card landing,
                 surface a back button so the user can return to the cards. */}
            {showAllRated && (
              <button
                onClick={() => setShowAllRated(false)}
                className="flex items-center gap-1 text-sm text-on-surface/55 hover:text-on-surface mb-3 -ml-1 px-1 py-1"
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}

            {/* ── Page chrome ──
                Phone keeps the existing stack of three rows (search bar
                → filter pills → summary). Desktop folds everything into
                a single editorial toolbar below a thin divider line:
                  ┌──────────────────────────────────────────────────┐
                  │ [🔍 Search this list]  •  [Filters] [City] [..] │
                  │                                  63 places · 8.0│
                  │                                            ⊞ ▦ │
                  └──────────────────────────────────────────────────┘
                The pills inherit a single muted token ("chip") look so
                the row reads as one cluster instead of five floating
                buttons in random colors. */}
            {phoneMode ? (
              <>
                <div className="mb-4">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30 pointer-events-none" />
                    <input
                      type="text"
                      value={mainSearchQuery}
                      onChange={(e) => setMainSearchQuery(e.target.value)}
                      placeholder="Search by name, cuisine, location..."
                      className="w-full bg-on-surface/[0.04] rounded-xl py-2.5 pl-9 pr-9 text-sm font-medium text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-on-surface/[0.06] transition-all"
                    />
                    {mainSearchQuery && (
                      <button
                        onClick={() => setMainSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30 hover:text-on-surface/60 transition-colors"
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                  <FilterPill onClick={() => { setFiltersOpen(true); closeAllDropdowns(); }}
                    icon={<SlidersHorizontal size={12} />} label="Filters" active={activeFilterCount > 0}
                    badge={activeFilterCount > 0 ? activeFilterCount : undefined} />
                  <FilterPill onClick={() => setCityDropdownOpen(true)}
                    icon={<MapPin size={11} />}
                    label={cityFilter.length > 0 ? `City (${cityFilter.length})` : 'City'}
                    active={cityFilter.length > 0}
                    onClear={cityFilter.length > 0 ? () => setCityFilter([]) : undefined} />
                  <FilterPill onClick={() => setCuisineDropdownOpen(true)}
                    label={cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine'}
                    active={cuisineFilter.length > 0}
                    onClear={cuisineFilter.length > 0 ? () => setCuisineFilter([]) : undefined} />
                  <FilterPill onClick={() => setPriceDropdownOpen(true)}
                    label={priceFilter || 'Price'} active={!!priceFilter}
                    onClear={priceFilter ? () => setPriceFilter(null) : undefined} />
                  <FilterPill onClick={() => setSortDropdownOpen(true)}
                    icon={<ArrowUpDown size={11} />}
                    label={sortBy !== 'highest' && sortBy !== 'recent' ? sortLabels[sortBy] : 'Sort'}
                    active={sortBy !== 'highest' && sortBy !== 'recent'}
                    onClear={(sortBy !== 'highest' && sortBy !== 'recent') ? () => setSortBy('highest') : undefined} />
                  {hasActiveFilters && (
                    <button onClick={handleResetFilters}
                      className="flex items-center gap-1 px-3 h-8 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0">
                      <X size={10} /><span>Clear</span>
                    </button>
                  )}
                </div>

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
                  </div>
                )}
              </>
            ) : (
              <div className="mb-5 pb-4 border-b border-on-surface/[0.06]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                  {/* Primary action: search this list */}
                  <button
                    type="button"
                    onClick={activateRatedScope}
                    className={cn(
                      'inline-flex items-center gap-2 h-8 px-3.5 rounded-full transition-colors text-[13px] font-semibold flex-shrink-0',
                      mainSearchQuery
                        ? 'bg-primary/[0.10] text-primary hover:bg-primary/[0.14]'
                        : 'bg-on-surface/[0.05] text-on-surface/75 hover:bg-on-surface/[0.08] hover:text-on-surface',
                    )}
                    aria-label="Search this list"
                  >
                    <Search size={13} />
                    <span>Search this list</span>
                    {mainSearchQuery && (
                      <span className="inline-flex items-center gap-1 ml-0.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-[11px] font-bold">
                        <span className="truncate max-w-[100px]">"{mainSearchQuery}"</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setMainSearchQuery(''); setScopedSearch(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setMainSearchQuery(''); setScopedSearch(null); } }}
                          aria-label="Clear list search"
                          className="text-primary/70 hover:text-primary"
                        >
                          <X size={11} />
                        </span>
                      </span>
                    )}
                  </button>

                  {/* Visual divider between primary action and filter cluster */}
                  <span className="w-px h-5 bg-on-surface/[0.10] flex-shrink-0 mx-1" aria-hidden="true" />

                  {/* Filter cluster — Filters opens the full sheet;
                      City / Cuisine / Price / Sort each drop an
                      anchored popover under the pill instead of
                      sliding a bottom sheet up. */}
                  <FilterPill onClick={() => { setFiltersOpen(true); }}
                    icon={<SlidersHorizontal size={12} />} label="Filters" active={activeFilterCount > 0}
                    badge={activeFilterCount > 0 ? activeFilterCount : undefined} />
                  <AnchoredPill
                    pill={{
                      icon: <MapPin size={11} />,
                      label: cityFilter.length > 0 ? `City (${cityFilter.length})` : 'City',
                      active: cityFilter.length > 0,
                      onClear: cityFilter.length > 0 ? () => setCityFilter([]) : undefined,
                    }}
                    popoverWidth="w-[280px]"
                  >
                    {() => (
                      <SearchableMultiSelect
                        placeholder="Search cities..."
                        options={allCities}
                        selected={cityFilter}
                        onToggle={toggleCityFilter}
                      />
                    )}
                  </AnchoredPill>
                  <AnchoredPill
                    pill={{
                      label: cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine',
                      active: cuisineFilter.length > 0,
                      onClear: cuisineFilter.length > 0 ? () => setCuisineFilter([]) : undefined,
                    }}
                    popoverWidth="w-[280px]"
                  >
                    {() => (
                      <SearchableMultiSelect
                        placeholder="Search cuisines..."
                        options={allCuisines}
                        selected={cuisineFilter}
                        onToggle={toggleCuisineFilter}
                      />
                    )}
                  </AnchoredPill>
                  <AnchoredPill
                    pill={{
                      label: priceFilter || 'Price',
                      active: !!priceFilter,
                      onClear: priceFilter ? () => setPriceFilter(null) : undefined,
                    }}
                    popoverWidth="w-[240px]"
                  >
                    {(close) => (
                      <PricePickerContent
                        value={priceFilter}
                        onChange={(v) => { setPriceFilter(v); close(); }}
                      />
                    )}
                  </AnchoredPill>
                  <AnchoredPill
                    pill={{
                      icon: <ArrowUpDown size={11} />,
                      label: sortBy !== 'highest' && sortBy !== 'recent' ? sortLabels[sortBy] : 'Sort',
                      active: sortBy !== 'highest' && sortBy !== 'recent',
                      onClear: (sortBy !== 'highest' && sortBy !== 'recent') ? () => setSortBy('highest') : undefined,
                    }}
                    popoverWidth="w-[240px]"
                  >
                    {(close) => (
                      <SortPickerContent
                        value={sortBy}
                        options={[
                          ['recent', 'Recent'],
                          ['highest', 'Highest Score'],
                          ['lowest', 'Lowest Score'],
                          ['added', 'Date Added'],
                          ['custom', 'Custom Order'],
                        ]}
                        onChange={(v) => { handleSortBy(v as typeof sortBy); close(); }}
                      />
                    )}
                  </AnchoredPill>
                  {hasActiveFilters && (
                    <button
                      onClick={handleResetFilters}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-semibold text-red-500/80 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <X size={11} /><span>Clear all</span>
                    </button>
                  )}

                  {/* Right side: live result count + avg score + view toggle */}
                  <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                    {regularRatingsCount > 0 && (
                      <p className="text-[12px] text-on-surface/50 whitespace-nowrap tabular-nums">
                        <span className="font-bold text-on-surface">{filteredRatings.length}</span>
                        {filteredRatings.length !== regularRatingsCount && (
                          <span className="text-on-surface/35"> / {regularRatingsCount}</span>
                        )}
                        {filteredRatings.length > 0 && (
                          <>
                            <span className="text-on-surface/25 mx-1.5">·</span>
                            <span>Avg <span className="font-bold text-on-surface">{(filteredRatings.reduce((sum, r) => sum + r.score, 0) / filteredRatings.length).toFixed(1)}</span></span>
                          </>
                        )}
                      </p>
                    )}
                    <ViewModeToggle mode={effectiveViewMode} onChange={setViewMode} />
                  </div>
                </div>
              </div>
            )}

            {/* ── Restaurant list ── */}
            {regularRatingsCount === 0 ? (
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
                  <div className={(sortBy !== 'custom' && effectiveViewMode === 'grid') ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6" : "divide-y divide-on-surface/[0.06]"}>
                    {filteredRatings.map((r, idx) => {
                      const inLists = getListsForRestaurant(r.restaurantId);
                      const isCustom = sortBy === 'custom';
                      return (sortBy !== 'custom' && effectiveViewMode === 'grid') ? (
                        <RestaurantGridCard
                          key={r.restaurantId}
                          restaurantId={r.restaurantId}
                          name={r.name}
                          image={r.image}
                          cuisine={r.cuisine}
                          price={r.price}
                          address={r.address}
                          notes={r.notes}
                          score={r.score}
                          onEdit={() => openAddRestaurantModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                          onRemove={() => removeRating(r.restaurantId)}
                        />
                      ) : (
                        <div key={r.restaurantId} className="flex items-center gap-2">
                          {isCustom && (
                            <>
                              <div className="flex flex-col items-center w-7 shrink-0">
                                {idx === 0 ? (
                                  <Crown size={18} className="text-amber-500 fill-amber-500" />
                                ) : (
                                  <span className="text-xs font-bold text-on-surface/35">#{idx + 1}</span>
                                )}
                              </div>
                              <button
                                className="touch-none shrink-0 w-7 h-10 flex items-center justify-center cursor-grab active:cursor-grabbing text-on-surface/25 hover:text-on-surface/50 transition-colors"
                                onPointerDown={() => setDragIdx(idx)}
                                onPointerUp={() => {
                                  if (dragIdx !== null && dragIdx !== idx) moveRating(dragIdx, idx);
                                  setDragIdx(null);
                                }}
                                onPointerEnter={() => {
                                  if (dragIdx !== null && dragIdx !== idx) {
                                    moveRating(dragIdx, idx);
                                    setDragIdx(idx);
                                  }
                                }}
                              >
                                <GripVertical size={16} />
                              </button>
                            </>
                          )}
                          <div className="flex-1 min-w-0">
                            <RestaurantRow
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
                          </div>
                        </div>
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
        onSortBy={handleSortBy}
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

      {/* Spotlight-style search popup — opened by the desktop header's
          Add Rating button (PageAddAction override above). In
          add-to-list mode it surfaces your rated restaurants up top
          with checkboxes so you can batch-add several at once via the
          Done button; search results stay single-pick (each one drops
          into the rating modal). */}
      <SearchPopup
        open={searchPopupOpen}
        onClose={() => setSearchPopupOpen(false)}
        title={searchPopupMode === 'add-to-list' && currentList
          ? (currentList.id === '__wishlist__' ? 'Add to Wishlist' : `Add to ${currentList.name}`)
          : undefined}
        placeholder={searchPopupMode === 'add-to-list'
          ? 'Pick rated places or search for a new one…'
          : 'Search for a restaurant…'}
        ratedRestaurants={searchPopupMode === 'add-to-list'
          ? ratings.filter((r) => r.cuisine !== 'Hotel Breakfast')
          : undefined}
        excludeIds={searchPopupMode === 'add-to-list' && currentList
          ? new Set([
              ...currentList.restaurantIds,
              ...(currentList.wishlistIds || []),
            ])
          : undefined}
        multiSelectRated={searchPopupMode === 'add-to-list' && !!currentList && currentList.id !== '__wishlist__'}
        onCommitRated={(picked) => {
          if (!currentList || currentList.id === '__wishlist__') return;
          // Add every picked restaurant to the list. No rating modal
          // since these are already rated. Cache meta on each so rows
          // render instantly without an extra fetch.
          picked.forEach((rating) => {
            cacheRestaurantMeta({
              id: rating.restaurantId, name: rating.name, image: rating.image,
              cuisine: rating.cuisine, price: rating.price, address: rating.address,
            });
            addToList(currentList.id, rating.restaurantId);
          });
          setSearchPopupOpen(false);
        }}
        onPickRated={(rating) => {
          // Single-select fallback path (e.g. wishlist context). Adds
          // and closes immediately — no rating modal needed.
          if (!currentList) return;
          if (currentList.id === '__wishlist__') {
            setSearchPopupOpen(false);
            return;
          }
          cacheRestaurantMeta({
            id: rating.restaurantId, name: rating.name, image: rating.image,
            cuisine: rating.cuisine, price: rating.price, address: rating.address,
          });
          addToList(currentList.id, rating.restaurantId);
          setSearchPopupOpen(false);
        }}
        onPickPlace={(place) => {
          const meta: RestaurantMeta = {
            id: place.id, name: place.name, image: place.photoUrl || '',
            cuisine: getCuisineLabel(place.types || []),
            price: '',
            address: place.fullAddress || place.address,
          };
          setSearchPopupOpen(false);
          if (searchPopupMode === 'add-to-list' && currentList && currentList.id !== '__wishlist__') {
            // Add to the list immediately and open the rating modal so
            // the user can score it. The cache write makes the row show
            // up without waiting for the rating to be saved.
            cacheRestaurantMeta(meta);
            addToList(currentList.id, place.id);
          }
          openAddRestaurantModal(meta);
        }}
      />

      {/* Create list bottom sheet */}
      <CreateListSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreate={(name, emoji, type) => {
          createList(name, emoji, type);
          // Land the user on the matching tab so the new list is visible.
          setPantryTab(type === 'home-cooking' ? 'recipes' : 'restaurants');
        }}
        existingListNames={lists.map((l) => l.name)}
        onCreateTrip={() => { setShowTrips(true); setCreateTripFromList(true); }}
        kind={createSheetKind}
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
                  {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['added', 'Date Added'], ['custom', 'Custom Order']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => { handleSortBy(key); setSortDropdownOpen(false); }}
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
