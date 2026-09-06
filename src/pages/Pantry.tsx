import { DeleteConfirmation as ConfirmDeleteDialog } from '../components/DeleteConfirmation';
import { SwipeActionTray, useSwipeActions } from '../components/SwipeActions';
import { CardActionMenu, useCardLongPress } from '../components/CardActionMenu';
import { usePageBack } from '../lib/usePageBack';
import '../components/LibraryDesign.css';
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import { Star, ChevronRight, Plus, Trash2, ArrowLeft, ListPlus, MapPin, SlidersHorizontal, X, ChevronDown, Bookmark, Upload, Search, Check, Edit3, Globe, Lock, LayoutGrid, List, ArrowUpDown, MoreHorizontal, Download, Plane, StickyNote, CalendarDays, Tag, Image, Loader2, Building2, ChevronLeft, GripVertical, Crown, ChefHat, UtensilsCrossed, Clock, Flame, Users, Hash, FileText, Sparkles } from 'lucide-react';
import { ShareIcon } from '../components/icons/ShareIcon';
import { ShareDialog } from '../components/ShareDialog';
import type { SharedRecipe } from '../contexts/ChatContext';
import { cn, localISODate } from '../lib/utils';
import { usePaywall } from '../contexts/PaywallContext';
import { moveWithinCustomOrder } from '../lib/customOrder';
import { MAPBOX_TOKEN } from '../lib/keys';
import { processPhoto } from '../lib/images';
import { shareExternally } from '../lib/native-share';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { OwnScoreBadge, ScoreBadge } from '../components/ScoreBadge';
import { SCORE_UNLOCK_THRESHOLD } from '../lib/scoreUnlock';
import { ScoreRing } from '../components/cards';
import { getOpenStatus, useBackfillLocationComponents } from '../lib/useRestaurantLocationLabel';
import { hasFreshHours } from '../lib/useWarmHours';
import { useDistanceFromHome } from '../contexts/HomeLocationContext';
import { formatDuration, formatDurationCompact, getMealCoverUrl, scaleQuantity, extractStepMinutes, StepTimer, PhotoLightbox, matchesTimeBand } from '../lib/recipe-display';
import { getHomeMealReviews, summarizeReviews, type HomeMealReview } from '../lib/supabase-home-meal-reviews';
import { getProfilesByIds, getFriends, type UserProfile } from '../lib/supabase-community';
import { useLists, DEFAULT_WANT_TO_COOK_ID, DEFAULT_COOKED_ID, type CustomList, type PhotoItem, type Trip, type TripRestaurant, type RestaurantRating, type RestaurantMeta, type HomeMeal, type Recipe } from '../contexts/ListsContext';
import { PantryPhoneHeader } from '../components/PantryPhoneHeader';
import { PantryListSwitcherDrawer, type DrawerSection } from '../components/PantryListSwitcherDrawer';
import { useSharedLists } from '../contexts/SharedListsContext';
import { SharedListView } from '../components/shared-lists/SharedListView';
import { CreateSharedListSheet } from '../components/shared-lists/CreateSharedListSheet';
import type { SharedList } from '../lib/supabase-shared-lists';
import { SearchPopup } from '../components/SearchPopup';
import { useSettings } from '../contexts/SettingsContext';
import { usePageAddAction } from '../contexts/PageAddActionContext';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { searchPlacesByText, extractCityState, formatLocationLabel, type PlaceResult } from '../lib/places';
import { cityFromAddress } from '../lib/city';
import { getCuisineLabel } from './useRestaurantDetail';
import { useMichelinMatch, useMichelinIndexReady } from '../lib/useMichelinMatch';
import { passesMichelinFilter } from '../lib/michelin';
import { MichelinDistinctionFilter, MichelinDrillSection } from '../components/MichelinDistinctionFilter';
import { MichelinMark } from '../components/MichelinBadge';
import { FilterSheet as FilterSheetShell } from '../components/FilterSheet';
import { FilterSortSection, FilterSection, PillRow, Pill, Segment, SegmentItem, RangeSlider, FilterDrillSection, HoursFilterSection } from '../components/filterPrimitives';
import { passesHoursFilter, isHoursFilterActive, emptyHoursFilter, type HoursFilter, restaurantLocalNow } from '../lib/hours';
import { useWarmHoursForFilter } from '../lib/useWarmHours';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, Calendar } from '../components/RatingShared';
import { RecommendationsBrowser } from '../components/RecommendationsBrowser';
import { useBottomSheet } from '../lib/useBottomSheet';
import { SheetGrabArea } from '../components/SheetGrabArea';
import { Collapse } from '../components/Collapse';
import { GlassButton } from '../lib/glass-buttons';
import { SearchField } from '../components/SearchField';
import { useHeaderFade } from '../lib/useHeaderFade';

/** Pill-shaped inline search input for the desktop toolbars. Replaces the
 *  old "Search this list" pill that hijacked the (since removed) global
 *  desktop header input — the filter field now lives right in the toolbar. */
const ToolbarSearchInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder = 'Search this list…' }) => (
  <label
    className={cn(
      'inline-flex items-center gap-2 h-8 pl-3.5 pr-2 rounded-full transition-colors text-[13px] font-semibold flex-shrink-0 cursor-text',
      value
        ? 'bg-primary/[0.10] text-primary'
        : 'bg-on-surface/[0.05] text-on-surface/75 hover:bg-on-surface/[0.08] focus-within:bg-on-surface/[0.08]',
    )}
  >
    <Search size={13} className="flex-shrink-0" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-transparent outline-none border-none w-[130px] focus:w-[190px] transition-[width] duration-200 text-[13px] font-medium text-on-surface placeholder:text-on-surface/45"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        aria-label="Clear search"
        className="text-on-surface/40 hover:text-on-surface flex-shrink-0"
      >
        <X size={12} />
      </button>
    )}
  </label>
);

/** A recipe saved into a list from another user carries source-author
 *  attribution. Those copies are read-only — the original author owns the
 *  recipe — so we hide the Edit affordance (Delete/removal still allowed). */
function isSavedFromOtherUser(meal: HomeMeal): boolean {
  return !!(meal.sourceAuthorId || meal.sourceAuthorUsername || meal.sourceAuthorName);
}

/* ── Preset list suggestions ── */
interface PresetList { name: string; emoji: string; category: string; type?: 'home-cooking'; }

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

  // ─── Recipe presets — type: 'home-cooking' ───
  // These power the recipes-tab list picker. Grouped into seven
  // categories so the picker reads as a real cookbook index rather
  // than a single bucket.
  { name: 'Recipes', emoji: '🍳', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'Weeknight Dinners', emoji: '🍽️', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'Quick & Easy', emoji: '🏃', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: '30-Minute Meals', emoji: '⏱️', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'One-Pot Meals', emoji: '🍲', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'Sheet-Pan Dinners', emoji: '🍖', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'Slow Cooker', emoji: '🐢', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'Instant Pot', emoji: '⚡', category: 'Everyday & Weeknight', type: 'home-cooking' },
  { name: 'Meal Prep', emoji: '🥡', category: 'Everyday & Weeknight', type: 'home-cooking' },

  { name: 'Breakfast & Brunch', emoji: '🥞', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Lunches', emoji: '🥪', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Soups & Stews', emoji: '🍜', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Salads', emoji: '🥗', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Sides & Small Plates', emoji: '🥔', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Appetizers', emoji: '🧀', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Snacks & Bites', emoji: '🍿', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Drinks & Cocktails', emoji: '🍹', category: 'Meal Types', type: 'home-cooking' },
  { name: 'Sauces & Dressings', emoji: '🥫', category: 'Meal Types', type: 'home-cooking' },

  { name: 'Desserts', emoji: '🍰', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Cookies', emoji: '🍪', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Cakes', emoji: '🎂', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Pies & Tarts', emoji: '🥧', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Bread Baking', emoji: '🍞', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Pastries', emoji: '🥐', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Ice Cream & Frozen', emoji: '🍦', category: 'Sweet & Baking', type: 'home-cooking' },
  { name: 'Chocolate', emoji: '🍫', category: 'Sweet & Baking', type: 'home-cooking' },

  { name: 'Italian', emoji: '🍝', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Mexican', emoji: '🌮', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Asian', emoji: '🥢', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Chinese', emoji: '🥟', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Japanese', emoji: '🍣', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Korean', emoji: '🍱', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Thai', emoji: '🌶️', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Indian', emoji: '🍛', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'Mediterranean', emoji: '🫒', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'French', emoji: '🥂', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'American Comfort', emoji: '🍔', category: 'By Cuisine', type: 'home-cooking' },
  { name: 'BBQ & Grilling', emoji: '🔥', category: 'By Cuisine', type: 'home-cooking' },

  { name: 'Vegetarian', emoji: '🌿', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'Vegan', emoji: '🌱', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'Gluten-Free', emoji: '🌾', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'Dairy-Free', emoji: '🥛', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'Keto / Low-Carb', emoji: '🥩', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'High Protein', emoji: '💪', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'Whole 30 / Paleo', emoji: '🦴', category: 'Dietary & Lifestyle', type: 'home-cooking' },
  { name: 'Plant-Based', emoji: '🥦', category: 'Dietary & Lifestyle', type: 'home-cooking' },

  { name: 'Holiday Dinners', emoji: '🦃', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Thanksgiving', emoji: '🍂', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Christmas Cooking', emoji: '🎄', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Game Day', emoji: '🏈', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Date Night Cooking', emoji: '🕯️', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Cooking for a Crowd', emoji: '👥', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Cooking for Two', emoji: '💑', category: 'Occasion & Holiday', type: 'home-cooking' },
  { name: 'Birthdays & Celebrations', emoji: '🎉', category: 'Occasion & Holiday', type: 'home-cooking' },

  // "Want to Cook" is the built-in default recipe list (see
  // DEFAULT_WANT_TO_COOK_ID in ListsContext) — every user has it,
  // so it's intentionally not offered as a preset to avoid duplicates.
  { name: 'Tried & Loved', emoji: '❤️', category: 'Inspiration & Wishlist', type: 'home-cooking' },
  { name: 'Family Favorites', emoji: '👨‍👩‍👧', category: 'Inspiration & Wishlist', type: 'home-cooking' },
  { name: 'Restaurant Copycats', emoji: '🧑‍🍳', category: 'Inspiration & Wishlist', type: 'home-cooking' },
  { name: 'From My Travels', emoji: '✈️', category: 'Inspiration & Wishlist', type: 'home-cooking' },
  { name: 'Kid-Friendly Recipes', emoji: '👶', category: 'Inspiration & Wishlist', type: 'home-cooking' },
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
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, sheetScrollRef);

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
            ref={sheetRef as React.RefObject<HTMLDivElement>}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col", phoneMode ? "h-full rounded-none" : "h-full sm:h-auto sm:max-w-md sm:max-h-[75vh] rounded-none sm:rounded-3xl")}
          >
            <div className="flex items-center justify-between px-5 pt-safe-4 sm:pt-5 pb-3 flex-shrink-0">
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
                        selectedCategory === null ? "bg-primary text-on-primary" : "bg-transparent text-on-surface/50 hover:text-on-surface/70")}
                    >
                      All
                    </button>
                    {categoriesForKind.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={cn("px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors",
                          selectedCategory === cat ? "bg-primary text-on-primary" : "bg-transparent text-on-surface/50 hover:text-on-surface/70")}
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
                <div ref={sheetScrollRef} className="flex-1 overflow-y-auto px-5 pb-safe-5">
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
                  <button onClick={handleCreateCustom} disabled={!customName.trim()} className="flex-1 py-3 rounded-xl bg-primary text-on-primary text-sm font-semibold disabled:opacity-40 transition-colors">Create List</button>
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
  const { ratings, addToList, removeFromList, scoresUnlocked } = useLists();
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
            <div className="flex items-center justify-between px-5 pt-safe-4 sm:pt-5 pb-3 flex-shrink-0">
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
            <div className="flex-1 overflow-y-auto px-5 pb-safe-5 space-y-1.5">
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
                    {r.score > 0 && <OwnScoreBadge rating={r.score} unlocked={scoresUnlocked} size="xs" />}
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all flex-shrink-0", isInList ? "bg-primary border-primary text-on-primary" : "border-on-surface/15")}>
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
                          className="w-full py-3 bg-primary text-on-primary rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform">
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

// Find today's entry in a `weekdayDescriptions` array (Google Places).
// Strings look like "Monday: 10:00 AM – 10:00 PM" or "Monday: Closed";
// returns the right-hand side, or "" if today isn't published.
function formatTodayHours(hours: string[] | undefined): string {
  if (!hours || hours.length === 0) return '';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const line = hours.find((entry) => entry.startsWith(`${today}:`));
  if (!line) return '';
  return line.slice(today.length + 1).trim();
}

/* ── Restaurant row card ── */
/* ── Clean, centered confirmation dialog for destructive actions (swipe /
   menu Delete). Rendered through a portal so it's always viewport-centered,
   never clipped by a card's overflow or swipe transform. ── */
/* ── Open/Closed + today's-hours status line (Restaurant Cards Redesign).
   Dot + Open/Closed + the concise next boundary ("opens 5:00 PM" /
   "closes 10:00 PM") and an optional trailing value (distance). Always ONE
   line — the boundary truncates before anything wraps, and the full day
   schedule lives in the hover tooltip. ── */
const StatusLine: React.FC<{ hours?: string[]; trailing?: string; className?: string }> = ({ hours, trailing, className }) => {
  const s = getOpenStatus(hours);
  if (!s.label && !s.detail && !trailing) return null;
  return (
    <div
      className={cn('flex min-w-0 items-center gap-x-1.5 text-[12.5px] font-semibold', className)}
      title={s.schedule ? `Today: ${s.schedule}` : undefined}
    >
      {s.label && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: s.open ? 'var(--color-score-high)' : 'var(--color-score-low)' }} />
          <span className="font-bold" style={{ color: s.open ? 'var(--color-score-high-ink)' : 'var(--color-score-low-ink)' }}>{s.label}</span>
        </span>
      )}
      {s.detail && <span className="truncate font-medium text-on-surface/40">{s.detail}</span>}
      {trailing && (
        <>
          {(s.label || s.detail) && <span className="flex-shrink-0 text-on-surface/20">·</span>}
          <span className="flex-shrink-0 font-medium tabular-nums text-on-surface/55">{trailing}</span>
        </>
      )}
    </div>
  );
};

const RestaurantRow: React.FC<{
  restaurantId: string;
  name: string;
  cuisine: string;
  price: string;
  address: string;
  score?: number;
  /** Position in the list (1-based) — shown as the rank prefix/gutter. */
  rank?: number;
  onEdit?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  /** Show the Michelin distinction mark — only true while a Michelin filter
   *  is active, so it never appears unfiltered. */
  showMichelin?: boolean;
}> = ({ restaurantId, name, cuisine, price, address, score, rank, onEdit, onRemove, showMichelin = false }) => {
  const { phoneMode } = useSettings();
  const { restaurantMeta, scoresUnlocked } = useLists();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const swipe = useSwipeActions((onEdit ? 1 : 0) + (onRemove ? 1 : 0));
  const { tx, open, dragging, revealWidth, closeSwipe, onForegroundClick } = swipe;
  const actions = [
    ...(onEdit ? [{ label: 'Edit', icon: <Edit3 size={20} />, onClick: onEdit }] : []),
    ...(onRemove ? [{ label: 'Delete', icon: <Trash2 size={20} />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
  ];
  const contextMenu = swipe.menuRect && <CardActionMenu rect={swipe.menuRect} actions={actions} onClose={() => swipe.setMenuRect(null)} />;
  // Resolve a "City, ST" / "City, Country" label from the address. Use the
  // Beli-style hierarchical label — neighborhood + borough/city + state
  // when address components are cached, falls back to formatted-address
  // parsing for older saved restaurants.
  const meta = restaurantMeta[restaurantId];
  useBackfillLocationComponents(restaurantId, !!meta?.addressComponents && meta?.neighborhood !== undefined && hasFreshHours(meta));
  // Michelin override: starred restaurants show the Guide's cuisine + price
  // (and a star marker). Falls back to the saved values otherwise.
  const mich = useMichelinMatch(
    name,
    meta?.lat, meta?.lng, address || meta?.address, cuisine, price,
  );
  const location = address || meta?.address
    ? formatLocationLabel(meta?.addressComponents, address || meta?.address || '', meta?.neighborhood)
    : '';
  const metaTop = [mich.cuisine, mich.price].filter(Boolean).join('  ·  ');

  // Distance from the user's anchor location to the cached coords for
  // this place (populated by useRestaurantDetail). Renders inline next
  // to the city when available; otherwise the city stands alone.
  // Reactive: picking a new home location updates it without a remount.
  const distanceLabel = useDistanceFromHome(meta?.lat, meta?.lng);

  const handleDelete = () => {
    if (onRemove) {
      setDismissed(true);
      setTimeout(() => onRemove(), 300);
    }
  };

  if (dismissed) return null;

  const metaLoc = [location, distanceLabel].filter(Boolean).join('  ·  ');
  // ── Mobile: flat row, swipe left to reveal Edit (grey) + Delete (red) ──
  if (phoneMode) {
    return (
      <div ref={swipe.rowRef} className="library-restaurant-row relative overflow-hidden">
        <SwipeActionTray actions={actions} width={revealWidth} visible={tx < -5} onClose={closeSwipe} />
        <div
          {...swipe.foregroundProps}
          style={{
            transform: `translateX(${tx}px)`,
            transition: dragging ? 'none' : 'transform 0.38s cubic-bezier(0.2, 0.85, 0.25, 1)',
            touchAction: 'pan-y',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
          className="relative z-10 bg-surface"
        >
          <Link
            to={`/restaurant/${restaurantId}`}
            onClick={onForegroundClick}
            draggable={false}
            className="flex items-start gap-[15px] px-1 py-[18px]"
          >
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-serif text-[20px] font-bold leading-[1.15] tracking-[-0.01em]">
                {rank != null && <span className="text-[16px] text-on-surface/40">{rank}. </span>}{name}
              </h3>
              {metaTop && (
                <p className="mt-[5px] text-[13px] font-semibold leading-[1.3] text-on-surface/70">
                  {metaTop}
                  {showMichelin && mich.michelin && (
                    <span className="ml-1.5 inline-flex items-center align-middle"><MichelinMark michelin={mich.michelin} size={12} /></span>
                  )}
                </p>
              )}
              {metaLoc && <p className="mt-[3px] truncate text-[12.5px] font-medium leading-[1.3] text-on-surface/40">{metaLoc}</p>}
              <StatusLine hours={meta?.hours} className="mt-[9px]" />
            </div>
            <ScoreRing score={score} size={46} locked={!scoresUnlocked} className="mt-0.5" />
          </Link>
        </div>
        {contextMenu}
        {confirmDelete && (
          <ConfirmDeleteDialog
            name={name}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => { setConfirmDelete(false); handleDelete(); }}
          />
        )}
      </div>
    );
  }

  // ── Desktop: boxed list card with rank gutter + inset-ring score ──
  return (
    <div ref={swipe.rowRef} className="library-restaurant-row group relative" onContextMenu={swipe.foregroundProps.onContextMenu}>
      <Link
        to={`/restaurant/${restaurantId}`}
        className="card-surface card-surface-hover flex items-center gap-[22px] px-[26px] py-[22px] shadow-sm"
      >
        {rank != null && (
          <div className="min-w-[26px] flex-shrink-0 text-center text-[20px] font-bold leading-none tabular-nums text-on-surface/40">{rank}</div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-[22px] font-bold leading-[1.15] tracking-[-0.01em]">{name}</h3>
          {metaTop && (
            <p className="mt-1.5 text-[13px] font-semibold leading-[1.3] text-on-surface/70">
              {metaTop}
              {showMichelin && mich.michelin && (
                <span className="ml-1.5 inline-flex items-center align-middle"><MichelinMark michelin={mich.michelin} size={12} /></span>
              )}
            </p>
          )}
          {metaLoc && <p className="mt-[3px] truncate text-[12.5px] font-medium leading-[1.3] text-on-surface/40">{metaLoc}</p>}
          <StatusLine hours={meta?.hours} className="mt-[9px]" />
        </div>
        {(onEdit || onRemove) && (
          <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {onEdit && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }} aria-label="Edit"
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface/35 transition-colors hover:bg-primary/[0.06] hover:text-primary">
                <Edit3 size={15} />
              </button>
            )}
            {onRemove && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }} aria-label="Delete"
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface/25 transition-colors hover:bg-red-50 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
        <ScoreRing score={score} size={48} locked={!scoresUnlocked} />
      </Link>
      {contextMenu}
      {confirmDelete && (
        <ConfirmDeleteDialog
          name={name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); handleDelete(); }}
        />
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
  useBackfillLocationComponents(restaurantId, !!wlMeta?.addressComponents && wlMeta?.neighborhood !== undefined && hasFreshHours(wlMeta));
  const fullAddr = address || wlMeta?.address || '';
  const mich = useMichelinMatch(
    name,
    wlMeta?.lat, wlMeta?.lng, fullAddr, cuisine, price,
  );
  const location = fullAddr ? formatLocationLabel(wlMeta?.addressComponents, fullAddr, wlMeta?.neighborhood) : '';

  // Distance from the user's anchor location.
  const distanceLabel = useDistanceFromHome(wlMeta?.lat, wlMeta?.lng);

  // The rated row's shape, minus the score it doesn't have — a saved place
  // and a rated one should read the same way down the page.
  const wlMetaTop = [mich.cuisine, mich.price].filter(Boolean).join('  ·  ');
  const wlMetaLoc = [location, distanceLabel].filter(Boolean).join('  ·  ');

  return (
    <div className="group flex items-start gap-[15px] px-1 py-[18px]">
      <Link to={`/restaurant/${restaurantId}`} className="min-w-0 flex-1 block">
        <h3 className="truncate font-serif text-[20px] font-bold leading-[1.15] tracking-[-0.01em]">{name}</h3>
        {wlMetaTop && (
          <p className="mt-[5px] text-[13px] font-semibold leading-[1.3] text-on-surface/70">{wlMetaTop}</p>
        )}
        {wlMetaLoc && (
          <p className="mt-[3px] truncate text-[12.5px] font-medium leading-[1.3] text-on-surface/40">{wlMetaLoc}</p>
        )}
        <StatusLine hours={wlMeta?.hours} className="mt-[9px]" />
        {notes && (
          <p className="mt-[7px] truncate text-[12px] italic leading-[1.3] text-on-surface/40">&ldquo;{notes}&rdquo;</p>
        )}
      </Link>
      {onRemove && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          aria-label={`Remove ${name} from your wishlist`}
          className="mt-0.5 flex-none w-9 h-9 rounded-full border border-on-surface/20 text-primary flex items-center justify-center active:bg-on-surface/[0.06] transition-colors"
        >
          <Bookmark size={15} className="fill-current" />
        </button>
      )}
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
  const meta = restaurantMeta[restaurantId];
  const mich = useMichelinMatch(
    name,
    meta?.lat, meta?.lng, address || meta?.address, cuisine, price,
  );
  const cuisineLabel = mich.cuisine;
  const showPrice = !!mich.price;

  useBackfillLocationComponents(restaurantId, !!meta?.addressComponents && meta?.neighborhood !== undefined && hasFreshHours(meta));
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
  const distanceLabel = useDistanceFromHome(meta?.lat, meta?.lng);

  return (
    <div className="group relative">
      <Link
        to={`/restaurant/${restaurantId}`}
        className={cn(
          'block rounded-2xl bg-white border border-on-surface/[0.07]',
          'p-5 transition-all duration-200',
          'hover:border-on-surface/15 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.16)] hover:-translate-y-px',
          'flex flex-col',
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
              className="hit-44 flex-shrink-0 w-8 h-8 rounded-full bg-primary/[0.08] text-primary flex items-center justify-center hover:bg-primary/[0.14] active:scale-95 transition-all"
            >
              <Bookmark size={15} className="fill-primary" />
            </button>
          ) : (
            <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/[0.08] text-primary flex items-center justify-center">
              <Bookmark size={15} className="fill-primary" />
            </span>
          )}
        </div>

        {/* Cuisine · price */}
        {(cuisineLabel || showPrice) && (
          <p className="mt-1 text-[12.5px] text-on-surface/55 font-medium">
            {cuisineLabel}
            {cuisineLabel && showPrice ? ' · ' : ''}
            {showPrice && mich.price}
          </p>
        )}

        {/* Footer: pin + location (allowed to wrap to two lines so the
            full "Neighborhood, City, ST" doesn't get cut off), then a
            second muted line for the distance when we have one. */}
        <div className="mt-3 text-[12.5px] text-on-surface/55">
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
  /** User's notes / quote for this rating — rendered behind a
   *  collapsible "Notes" toggle on the no-image editorial variant. */
  notes?: string;
  onEdit?: () => void;
  /** Opens the rating modal jumped straight to the Notes sub-page so
   *  the user can author / replace the notes for this restaurant
   *  without scrolling through the rest of the score editor. */
  onEditNotes?: () => void;
  onRemove?: () => void;
  /** Show the Michelin distinction mark — only true while a Michelin filter
   *  is active, so it never appears unfiltered. */
  showMichelin?: boolean;
}> = ({ restaurantId, name, image, cuisine, price, score, address, notes, onEdit, onEditNotes, onRemove, showMichelin = false }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cardMenu, setCardMenu] = useState<DOMRect | null>(null);
  const cardPress = useCardLongPress<null>((_, target) => { if (onEdit || onRemove) setCardMenu(target.getBoundingClientRect()); });
  const cardMenuNode = cardMenu && <CardActionMenu rect={cardMenu} onClose={() => setCardMenu(null)} actions={[
    ...(onEdit ? [{ label: 'Edit', icon: <Edit3 size={18} />, onClick: onEdit }] : []),
    ...(onRemove ? [{ label: 'Delete', icon: <Trash2 size={18} />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
  ]} />;
  const [moreOpen, setMoreOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const { restaurantMeta, scoresUnlocked } = useLists();
  const trimmedNotes = notes?.trim() ?? '';
  const hasNotes = trimmedNotes.length > 0;
  const hasScore = score !== undefined && score > 0;

  // Resolve city/state for the footer line. Prefer the explicit address
  // prop (from the rating record) and fall back to whatever's cached on
  // the meta entry — that way we still show a location for restaurants
  // re-hydrated from cloud where the rating may not include an address.
  const meta = restaurantMeta[restaurantId];
  const mich = useMichelinMatch(
    name,
    meta?.lat, meta?.lng, address || meta?.address, cuisine, price,
  );
  const cuisineLabel = mich.cuisine;
  const showPrice = !!mich.price;
  useBackfillLocationComponents(restaurantId, !!meta?.addressComponents && meta?.neighborhood !== undefined && hasFreshHours(meta));
  const fullAddress = address || meta?.address || '';
  // Hierarchical Beli-style label — neighborhood + borough/city + state
  // when components are cached, falling back to the formatted address.
  const locationLabel = fullAddress
    ? formatLocationLabel(meta?.addressComponents, fullAddress, meta?.neighborhood)
    : '';

  // Distance in miles from the user's anchor location to the cached
  // place coordinates. Only renders when we have both, otherwise the
  // footer just shows the city.
  const distanceLabel = useDistanceFromHome(meta?.lat, meta?.lng);
  // Today's opening hours pulled from the cached Places weekday list.
  const todayHours = useMemo(() => formatTodayHours(meta?.hours), [meta?.hours]);

  // Close the more menu on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  // Text-only boxed card per the Restaurant Cards Redesign — no photo. Fixed
  // row structure so every card in a grid row is the same height: identity
  // (name + score ring, cuisine · price), then a facts block (location +
  // single-line Open/Closed · distance status), then a bottom-pinned footer
  // (notes affordance left, hover edit/more right).
  return (
    <div className="group relative h-full">
      <Link {...cardPress.getHandlers(null)} onClick={e => { if (cardPress.suppressClickRef.current) { e.preventDefault(); cardPress.suppressClickRef.current = false; } }}
        to={`/restaurant/${restaurantId}`}
        className="relative flex h-full flex-col rounded-[18px] border border-on-surface/[0.07] bg-white px-5 pb-3.5 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-on-surface/15 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
      >
        {/* Score — inset ring, top-right */}
        {hasScore && (
          <div className="absolute right-5 top-5"><ScoreRing score={score} size={44} locked={!scoresUnlocked} /></div>
        )}

        <h3 className="line-clamp-2 pr-14 font-serif text-[20px] font-bold leading-[1.15] tracking-[-0.01em] text-on-surface">
          {name}
        </h3>

        {(cuisineLabel || showPrice || (showMichelin && mich.michelin)) && (
          <p className="mt-1 pr-14 truncate text-[13px] font-semibold text-on-surface/60">
            {cuisineLabel}
            {cuisineLabel && showPrice ? ' · ' : ''}
            {showPrice && mich.price}
            {showMichelin && mich.michelin && (
              <span className="ml-1.5 inline-flex items-center align-middle">
                <MichelinMark michelin={mich.michelin} size={12} />
              </span>
            )}
          </p>
        )}

        {/* Facts — location + status share one tight block */}
        <div className="mt-3.5 space-y-1.5">
          {locationLabel && (
            <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-on-surface/55">
              <MapPin size={13} className="flex-shrink-0 text-on-surface/40" />
              <span className="truncate">{locationLabel}</span>
            </div>
          )}
          <StatusLine hours={meta?.hours} trailing={distanceLabel} />
        </div>

        {/* Footer — pinned to the card bottom: notes left, actions right */}
        <div className="mt-auto pt-3">
          <div className="flex min-h-[30px] items-center justify-between gap-2 border-t border-on-surface/[0.06] pt-2.5">
            {hasNotes ? (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNotesOpen((v) => !v); }}
                aria-expanded={notesOpen}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold transition-colors',
                  notesOpen
                    ? 'bg-on-surface/[0.07] text-on-surface'
                    : 'bg-on-surface/[0.04] text-on-surface/60 hover:bg-on-surface/[0.07] hover:text-on-surface',
                )}
              >
                <StickyNote size={12} />
                <span>Notes</span>
                <ChevronDown size={12} className={cn('transition-transform', notesOpen && 'rotate-180')} />
              </button>
            ) : onEditNotes ? (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEditNotes(); }}
                className="inline-flex h-7 items-center gap-1 rounded-full px-1.5 -ml-1.5 text-[11px] font-bold text-on-surface/40 transition-colors hover:text-primary"
              >
                <Plus size={13} />
                <span>Add notes</span>
              </button>
            ) : (
              <span aria-hidden className="h-7" />
            )}
            {(onEdit || onRemove) && (
              <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {onEdit && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                    aria-label="Edit"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface/35 transition-colors hover:bg-primary/[0.06] hover:text-primary"
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
                        'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                        moreOpen ? 'bg-on-surface/[0.06] text-on-surface' : 'text-on-surface/35 hover:bg-on-surface/[0.05] hover:text-on-surface',
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
                          className="absolute bottom-full right-0 origin-bottom-right z-30 mb-1.5 min-w-[140px] overflow-hidden rounded-xl border border-on-surface/[0.08] bg-white py-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.2)]"
                        >
                          <button
                            role="menuitem"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMoreOpen(false); setConfirmDelete(true); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-red-500 hover:bg-red-50"
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
          {/* Notes body — floats OVER the card as an absolutely-positioned
              panel above the footer. Expanding in flow grew this card's
              height, which re-laid-out the whole items-stretch grid row. */}
          <AnimatePresence initial={false}>
            {hasNotes && notesOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                className="absolute inset-x-2 bottom-14 z-10 rounded-xl border border-on-surface/[0.08] bg-paper px-3.5 py-3 shadow-[0_10px_28px_-10px_rgba(0,0,0,0.28)]"
              >
                <p className="max-h-36 overflow-y-auto text-[12px] italic leading-snug text-on-surface/70 whitespace-pre-wrap">
                  &ldquo;{trimmedNotes}&rdquo;
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Link>

      {cardMenuNode}
      {confirmDelete && (
        <ConfirmDeleteDialog
          name={name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); if (onRemove) onRemove(); }}
        />
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

/* ── List overflow menu ── */
// Shared ⋯ overflow menu used on phone list-page headers (All Rated,
// custom list, recipe list). Click the button to toggle a small
// outside-click-dismissable panel of actions anchored to the trigger's
// right edge.
const ListMoreMenu: React.FC<{
  items: { label: string; icon?: React.ReactNode; onClick: () => void; destructive?: boolean }[];
  /** Render the trigger as floating glass chrome (phone list headers). */
  glass?: boolean;
  /** Distinct per header — glass buttons register by id. */
  glassId?: string;
}> = ({ items, glass = false, glassId = 'list-more' }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (items.length === 0) return null;
  const triggerClass = glass
    ? 'hit-44 w-11 h-11 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform'
    : 'w-9 h-9 rounded-full flex items-center justify-center text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.06] transition-colors';
  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      {glass ? (
        <GlassButton
          id={glassId}
          symbol="ellipsis"
          label="More actions"
          onClick={() => setOpen((v) => !v)}
          className={triggerClass}
        >
          <MoreHorizontal size={18} />
        </GlassButton>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          className={triggerClass}
        >
          <MoreHorizontal size={18} />
        </button>
      )}
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 min-w-[180px] rounded-2xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-on-surface/[0.06] py-1.5 z-30"
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick(); }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold transition-colors',
                item.destructive
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-on-surface/85 hover:bg-on-surface/[0.04]',
              )}
            >
              {item.icon && <span className={cn('flex-shrink-0', item.destructive ? 'text-red-500' : 'text-on-surface/55')}>{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── List Detail View ── */
const ListDetailView: React.FC<{
  list: CustomList;
  viewMode: 'list' | 'grid';
  onViewModeChange: (m: 'list' | 'grid') => void;
  onBack: () => void;
  /** The page owns the phone chrome now — drop this view's own top bar. */
  hidePhoneHeader?: boolean;
  /** Phone: search + filters fold away behind the header's search toggle. */
  searchOpen?: boolean;
  /** Delete confirmation, driven from the page header's ⋯ menu. */
  confirmDelete?: boolean;
  onConfirmDeleteChange?: (open: boolean) => void;
}> = ({ list, viewMode, onViewModeChange, onBack, hidePhoneHeader = false, searchOpen = true, confirmDelete, onConfirmDeleteChange }) => {
  const { ratings, getRestaurantInfo, removeFromList, removeFromWishlistInList, openAddRestaurantModal, deleteList, wishlist, removeFromWishlist, addToList, setListRating, getListRating, getRecipes, openAddRecipeModal, openHomeMealModal, removeRecipe, removeRecipeFromCookedList, updateRecipe, restaurantMeta, scoresUnlocked } = useLists();
  const { phoneMode, twoDecimalScores } = useSettings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const pendingListRatingRef = useRef<{ restaurantId: string; openedAt: number } | null>(null);

  // Watch for the global rating being updated after we opened the modal for a list-specific rating
  useEffect(() => {
    const pending = pendingListRatingRef.current;
    if (!pending) return;
    const globalRating = ratings.find((r) => r.restaurantId === pending.restaurantId);
    // Compare against updatedAt (falling back to createdAt): createdAt is
    // "first rated" and re-rating only bumps updatedAt, so checking
    // createdAt alone made "Create New Rating" a silent no-op for any
    // restaurant that already had a global rating — the save landed
    // globally but never got copied into the list's own ratings.
    const touchedAt = globalRating ? (globalRating.updatedAt ?? globalRating.createdAt) : undefined;
    if (globalRating && touchedAt && touchedAt >= pending.openedAt) {
      // The rating was just saved/updated — move it to list-specific storage
      setListRating(list.id, globalRating);
      pendingListRatingRef.current = null;
    }
  }, [ratings, list.id, setListRating]);
  const [searchQuery, setSearchQuery] = useState('');
  const [localConfirmDelete, setLocalConfirmDelete] = useState(false);
  // Controlled by the page header when it owns the ⋯ menu; local otherwise.
  const confirmDeleteList = confirmDelete ?? localConfirmDelete;
  const setConfirmDeleteList = onConfirmDeleteChange ?? setLocalConfirmDelete;

  const isWishlistView = list.id === '__wishlist__';
  const isDefaultWantToCook = list.id === DEFAULT_WANT_TO_COOK_ID;
  // Both built-in recipe lists are permanent — can't be deleted/renamed.
  const isProtectedRecipeList = isDefaultWantToCook || list.id === DEFAULT_COOKED_ID;
  const isHomeCooking = list.type === 'home-cooking';

  // Display name used by the desktop toolbar's inline search placeholder.
  const scopeName = isWishlistView ? 'Wishlist' : list.name;

  // ── Wishlist-only filter state ─────────────────────────────────────
  // Lives on ListView (not the global page) so the sheet's selections
  // reset cleanly when the user closes the view.
  const [wishlistFilterOpen, setWishlistFilterOpen] = useState(false);
  const [wlFiltersInitialPage, setWlFiltersInitialPage] = useState<{ id: string; title: string } | null>(null);
  const openWlFiltersOn = (page: { id: string; title: string } | null) => {
    setWlFiltersInitialPage(page);
    setWishlistFilterOpen(true);
  };
  const [wishlistSort, setWishlistSort] = useState<WishlistSort>('recent');
  const [wishlistCuisineFilter, setWishlistCuisineFilter] = useState<string[]>([]);
  const [wishlistCityFilter, setWishlistCityFilter] = useState<string[]>([]);
  const [wishlistPriceFilter, setWishlistPriceFilter] = useState<string | null>(null);
  const [wishlistMichelinFilter, setWishlistMichelinFilter] = useState<string[]>([]);
  const [wishlistHoursFilter, setWishlistHoursFilter] = useState<HoursFilter>(emptyHoursFilter());
  const toggleWlMichelin = (d: string) =>
    setWishlistMichelinFilter((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  // Michelin dataset readiness — gates the distinction filter below so the
  // saved lists re-filter once the data lands.
  const wlMichelinReady = useMichelinIndexReady();
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
    (wishlistPriceFilter ? 1 : 0) +
    (wishlistMichelinFilter.length > 0 ? 1 : 0) +
    (isHoursFilterActive(wishlistHoursFilter) ? 1 : 0);
  const resetWishlistFilters = () => {
    setWishlistCuisineFilter([]);
    setWishlistCityFilter([]);
    setWishlistPriceFilter(null);
    setWishlistMichelinFilter([]);
    setWishlistHoursFilter(emptyHoursFilter());
    setWishlistSort('recent');
  };

  // ── Recipe-list filter state ─────────────────────────────────────
  // Mirrors the All Recipes (HomeCookingTab) filter shape: Cuisine /
  // Difficulty / Time / Sort. Lives on ListView so it resets when the
  // user closes the list. Restaurant lists ignore these — the gate
  // around the filter UI keeps things tidy.
  const [recipeFiltersOpen, setRecipeFiltersOpen] = useState(false);
  const [recipeCuisineFilter, setRecipeCuisineFilter] = useState<string[]>([]);
  const [recipeDifficultyFilter, setRecipeDifficultyFilter] = useState<Array<'Easy' | 'Medium' | 'Hard'>>([]);
  const [recipeTimeFilter, setRecipeTimeFilter] = useState<'fast' | 'medium' | 'slow' | null>(null);
  const [recipeSortBy, setRecipeSortBy] = useState<'recent' | 'highest' | 'lowest' | 'quickest'>('recent');
  const recipeSortLabels: Record<typeof recipeSortBy, string> = {
    recent: 'Recent', highest: 'Highest', lowest: 'Lowest', quickest: 'Quickest',
  };
  const recipeTimeLabel = (t: typeof recipeTimeFilter) =>
    t === 'fast' ? '<30 min' : t === 'medium' ? '30–60 min' : t === 'slow' ? '>60 min' : 'Time';
  const recipeActiveFilterCount =
    (recipeCuisineFilter.length > 0 ? 1 : 0) +
    (recipeDifficultyFilter.length > 0 ? 1 : 0) +
    (recipeTimeFilter ? 1 : 0);
  const resetRecipeFilters = () => {
    setRecipeCuisineFilter([]);
    setRecipeDifficultyFilter([]);
    setRecipeTimeFilter(null);
    setRecipeSortBy('recent');
  };

  const recipes = getRecipes(list.id);
  const allRecipeCuisines = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => { if (r.cuisine) set.add(r.cuisine); });
    return Array.from(set).sort();
  }, [recipes]);
  const filteredRecipes = useMemo(() => {
    let out = recipes;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      out = out.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (recipeCuisineFilter.length > 0) {
      out = out.filter((r) => r.cuisine && recipeCuisineFilter.includes(r.cuisine));
    }
    if (recipeDifficultyFilter.length > 0) {
      out = out.filter((r) => r.difficulty && recipeDifficultyFilter.includes(r.difficulty));
    }
    if (recipeTimeFilter) {
      out = out.filter((r) => matchesTimeBand((r.prepTime ?? 0) + (r.cookTime ?? 0), recipeTimeFilter));
    }
    const sorted = [...out];
    sorted.sort((a, b) => {
      switch (recipeSortBy) {
        case 'highest': return b.score - a.score;
        case 'lowest': return a.score - b.score;
        case 'quickest':
          return ((a.prepTime ?? 0) + (a.cookTime ?? 0)) - ((b.prepTime ?? 0) + (b.cookTime ?? 0));
        case 'recent':
        default: return b.createdAt - a.createdAt;
      }
    });
    return sorted;
  }, [recipes, searchQuery, recipeCuisineFilter, recipeDifficultyFilter, recipeTimeFilter, recipeSortBy]);

  // Truly unfiltered — stats/facets read this; search and pills apply in
  // the filtered `ratedRestaurants` below.
  const ratedRestaurantsRaw = list.restaurantIds.map((id) => {
    const info = getRestaurantInfo(id);
    // Prefer list-specific rating over global rating
    const listRating = getListRating(list.id, id);
    const globalRating = ratings.find((r) => r.restaurantId === id);
    const rating = listRating || globalRating;
    return { id, info, rating, hasListRating: !!listRating };
  });
  // Filtered version: the search input plus the toolbar's City/Cuisine/
  // Price pills. The same wishlist* filter state is reused (the names
  // are historical — they apply to any non-recipe list view now).
  const ratedRestaurants = useMemo(() => {
    let out = ratedRestaurantsRaw;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      out = out.filter(({ info }) =>
        info?.name.toLowerCase().includes(q) || info?.cuisine.toLowerCase().includes(q) || info?.address.toLowerCase().includes(q));
    }
    if (isWishlistView || isHomeCooking) return out;
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
    if (isHoursFilterActive(wishlistHoursFilter)) {
      out = out.filter(({ id }) => passesHoursFilter(restaurantMeta[id]?.hours, wishlistHoursFilter, restaurantLocalNow(restaurantMeta[id]?.lng)));
    }
    if (wishlistMichelinFilter.length > 0) {
      out = out.filter(({ info }) => info && passesMichelinFilter(
        wishlistMichelinFilter, info.name, info.lat, info.lng, info.address));
    }
    return out;
  }, [isWishlistView, isHomeCooking, ratedRestaurantsRaw, searchQuery, wishlistCuisineFilter, wishlistCityFilter, wishlistPriceFilter, wishlistHoursFilter, restaurantMeta, wishlistMichelinFilter, wlMichelinReady]);

  const wishlistedRestaurantsRaw = isWishlistView
    // Drive the global wishlist view directly off the wishlist array so
    // recently-toggled hearts show up immediately, in the order the user
    // added them. The synthetic list only has wishlistIds, which loses
    // the addedAt timestamp we need for sort.
    ? wishlist.map((w) => ({
        id: w.restaurantId,
        info: getRestaurantInfo(w.restaurantId) || { id: w.restaurantId, name: w.name, image: w.image, cuisine: w.cuisine, price: w.price, address: w.address },
        wishItem: w,
      }))
    : (list.wishlistIds || []).map((id) => {
        const wishItem = wishlist.find((w) => w.restaurantId === id);
        // Fall back to the saved row's own fields before giving up. This
        // used to drop the entry outright when getRestaurantInfo came back
        // empty, so a place you saved into a custom list could vanish from
        // it with nothing to say it had — the id is still in the list, it
        // just stopped being drawn.
        const info = getRestaurantInfo(id)
          || (wishItem
            ? { id, name: wishItem.name, image: wishItem.image, cuisine: wishItem.cuisine, price: wishItem.price, address: wishItem.address }
            : undefined);
        return { id, info, wishItem };
      }).filter(({ info }) => info);

  // Backfill hours for every candidate in this list while the hours filter
  // is active — the filter reads cached meta, and unknown hours never hide
  // a place, so without warming the filter is a no-op for unvisited spots.
  const listHoursWarmActive = isHoursFilterActive(wishlistHoursFilter);
  const listHoursWarmIds = useMemo(
    () => (listHoursWarmActive
      ? [...ratedRestaurantsRaw.map(({ id }) => id), ...wishlistedRestaurantsRaw.map(({ id }) => id)]
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listHoursWarmActive, ratedRestaurantsRaw, wishlistedRestaurantsRaw],
  );
  useWarmHoursForFilter(listHoursWarmIds, listHoursWarmActive);

  // Filter + sort options pulled from the list's actual contents, so
  // the dropdowns only ever offer cuisines / cities the user has on
  // this list. Recipe lists skip this — they have their own filters.
  // The names are historical (they used to be wishlist-only); they now
  // apply to any non-recipe list view (wishlist + custom restaurant).
  const wishlistAllCuisines = useMemo(() => {
    if (isHomeCooking) return [] as string[];
    const set = new Set<string>();
    wishlistedRestaurantsRaw.forEach(({ info }) => { if (info?.cuisine) set.add(info.cuisine); });
    ratedRestaurantsRaw.forEach(({ info }) => { if (info?.cuisine) set.add(info.cuisine); });
    return Array.from(set).sort();
  }, [isHomeCooking, wishlistedRestaurantsRaw, ratedRestaurantsRaw]);
  // How many places each option would keep. A filter page that lists forty
  // cuisines without saying which of them you have two of is asking you to
  // guess; the count is the whole reason to pick one over another.
  const cuisineCounts = useMemo(() => {
    const out: Record<string, number> = {};
    [...wishlistedRestaurantsRaw, ...ratedRestaurantsRaw].forEach(({ info }) => {
      if (info?.cuisine) out[info.cuisine] = (out[info.cuisine] || 0) + 1;
    });
    return out;
  }, [wishlistedRestaurantsRaw, ratedRestaurantsRaw]);
  const cityCounts = useMemo(() => {
    const out: Record<string, number> = {};
    [...wishlistedRestaurantsRaw, ...ratedRestaurantsRaw].forEach(({ info }) => {
      const c = extractCityState(info?.address || '', info?.address || '');
      if (c) out[c] = (out[c] || 0) + 1;
    });
    return out;
  }, [wishlistedRestaurantsRaw, ratedRestaurantsRaw]);
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
    if (isHoursFilterActive(wishlistHoursFilter)) {
      out = out.filter(({ id }) => passesHoursFilter(restaurantMeta[id]?.hours, wishlistHoursFilter, restaurantLocalNow(restaurantMeta[id]?.lng)));
    }
    if (wishlistMichelinFilter.length > 0) {
      out = out.filter(({ info }) => info && passesMichelinFilter(
        wishlistMichelinFilter, info.name, info.lat, info.lng, info.address));
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
  }, [isHomeCooking, wishlistedRestaurantsRaw, wishlistCuisineFilter, wishlistCityFilter, wishlistPriceFilter, wishlistHoursFilter, restaurantMeta, wishlistMichelinFilter, wlMichelinReady, wishlistSort]);

  // Apply the search input on top of the filter pipeline — for EVERY list
  // type. Custom lists used to skip this, leaving non-matching wishlist
  // rows visible under an unfiltered count while the rated section shrank.
  const wishlistedRestaurantsFinal = useMemo(() => {
    if (!searchQuery.trim()) return wishlistedRestaurants;
    const q = searchQuery.toLowerCase();
    return wishlistedRestaurants.filter(({ info }) =>
      (info?.name || '').toLowerCase().includes(q) ||
      (info?.cuisine || '').toLowerCase().includes(q) ||
      (info?.address || '').toLowerCase().includes(q),
    );
  }, [wishlistedRestaurants, searchQuery]);

  const totalCount = isHomeCooking
    ? recipes.length
    : isWishlistView
      ? wishlistedRestaurantsRaw.length
      // Count only RENDERABLE wishlist entries (raw already drops ids whose
      // getRestaurantInfo misses) so the header never claims rows the
      // section below can't show.
      : list.restaurantIds.length + wishlistedRestaurantsRaw.length;

  const handlePlusClick = () => {
    // New recipes always go through the full three-tab builder
    // (Basic / Advanced / AI); targetListId lands the result in this
    // list as well as the cookbook. The basic AddRecipeModal remains
    // only for EDITING this list's existing legacy entries.
    if (isHomeCooking) openHomeMealModal(undefined, { targetListId: list.id });
    else setAddSheetOpen(true);
  };

  // ── Editorial header derivations ──────────────────────────────────
  // Each list "kind" gets its own accent color, eyebrow, and icon so
  // the page title row reads as a cover for that list.
  const headerVariant: {
    eyebrow: string;
    icon: React.ReactNode;
    accent: string; // text class
    chipBg: string; // bg class for the icon tile
  } = isHomeCooking
    ? { eyebrow: 'Your kitchen', icon: <ChefHat size={26} className="text-emerald-600" strokeWidth={1.7} />, accent: 'text-emerald-600', chipBg: 'bg-emerald-50' }
    : isWishlistView
      ? { eyebrow: 'Your saved places', icon: <Bookmark size={24} className="text-primary fill-primary" />, accent: 'text-primary', chipBg: 'bg-primary/8' }
      : { eyebrow: 'Your collection', icon: <span className="text-2xl leading-none">{list.emoji}</span>, accent: 'text-primary', chipBg: 'bg-primary/8' };

  // Distinct city count for the stats row — describes the whole list, so
  // it reads the unfiltered arrays (search/pills must not change it).
  const cityCount = useMemo(() => {
    const set = new Set<string>();
    const items = isWishlistView
      ? wishlistedRestaurantsRaw.map(({ info }) => info?.address || '')
      : ratedRestaurantsRaw.map(({ info }) => info?.address || '');
    for (const a of items) {
      const c = extractCityState(a, a);
      if (c) set.add(c);
    }
    return set.size;
  }, [isWishlistView, ratedRestaurantsRaw, wishlistedRestaurantsRaw]);

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
      for (const { rating } of ratedRestaurantsRaw) {
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
  }, [isWishlistView, isHomeCooking, ratedRestaurantsRaw, wishlistedRestaurantsRaw, recipes]);

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
    // Custom restaurant list — combine rated and wishlist sections.
    // total/avg describe the WHOLE list (unfiltered); visible is what the
    // search + pills currently show, so "5 / 14" renders while filtering.
    const total = ratedRestaurantsRaw.length + wishlistedRestaurantsRaw.length;
    const visible = ratedRestaurants.length + wishlistedRestaurantsFinal.length;
    const scored = ratedRestaurantsRaw
      .map((r) => r.rating?.score)
      .filter((s): s is number => typeof s === 'number' && s > 0);
    const avg = scored.length > 0 ? scored.reduce((s, n) => s + n, 0) / scored.length : null;
    return { total, visible, avg };
  })();

  return (
    <div>
      {/* ── Phone-only top bar ─────────────────────────────────────────
          Back arrow, prominent Add button, and (for deletable lists) a
          trash icon. The standalone search-icon toggle is gone — phone
          now mounts an always-visible search input below this row,
          matching the All Rated layout. Desktop drops this entire row
          — Pantry's tab pill handles navigation, the toolbar below
          handles search, and delete moves to the More menu (⋯). */}
      {phoneMode && !hidePhoneHeader && (
        <div className="pt-safe-4 flex items-center gap-2.5 mb-3.5">
          <GlassButton
            id="list-back"
            symbol="chevron.left"
            label="Back"
            onClick={onBack}
            className="hit-44 flex-none w-11 h-11 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
          >
            <ChevronLeft size={18} strokeWidth={2.1} />
          </GlassButton>
          <div className="flex-1" />
          <div className="flex items-center gap-2.5">
            {!isHomeCooking && (
              <button
                type="button"
                onClick={() => navigate('/map', { state: { listView: { id: list.id } } })}
                aria-label="View this list on the map"
                className="flex-none inline-flex h-10 items-center gap-1.5 rounded-full border border-on-surface/20 text-on-surface px-3.5 active:bg-on-surface/[0.06] transition-colors"
                style={{ fontSize: '12px', fontWeight: 700 }}
              >
                <MapPin size={13} />
                Map
              </button>
            )}
            <GlassButton
              id="list-add"
              symbol="plus"
              tint="primary"
              label={isHomeCooking ? 'Add Recipe' : 'Add Rating'}
              onClick={handlePlusClick}
              className={cn(
                'hit-44 flex-none w-11 h-11 rounded-full text-white flex items-center justify-center active:scale-95 transition-transform',
                isHomeCooking ? 'bg-emerald-600' : 'bg-primary',
              )}
            >
              <Plus size={17} strokeWidth={2.4} />
            </GlassButton>
            <ListMoreMenu
              glass
              glassId="list-detail-more"
              items={isWishlistView || isProtectedRecipeList ? [] : [{
                label: 'Delete list',
                icon: <Trash2 size={14} />,
                destructive: true,
                onClick: () => setConfirmDeleteList(true),
              }]}
            />
          </div>
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
            {/* Search this list — inline filter input */}
            <ToolbarSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={`Search ${scopeName.toLowerCase()}…`}
            />

            {!isHomeCooking && (
              <button
                type="button"
                onClick={() => navigate('/map', { state: { listView: { id: list.id } } })}
                aria-label="View this list on the map"
                className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full bg-on-surface/[0.05] text-on-surface/75 hover:bg-on-surface/[0.08] hover:text-on-surface transition-colors text-[13px] font-semibold flex-shrink-0"
              >
                <MapPin size={13} />
                <span>View on map</span>
              </button>
            )}

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
                    label: wishlistMichelinFilter.length > 0 ? `Michelin (${wishlistMichelinFilter.length})` : 'Michelin',
                    active: wishlistMichelinFilter.length > 0,
                    onClear: wishlistMichelinFilter.length > 0 ? () => setWishlistMichelinFilter([]) : undefined,
                  }}
                  popoverWidth="w-[260px]"
                >
                  {() => (
                    <div className="p-1">
                      <MichelinDistinctionFilter selected={wishlistMichelinFilter} onToggle={toggleWlMichelin} />
                    </div>
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
                  {listStats.avg !== null && scoresUnlocked && (
                    <>
                      <span className="text-on-surface/25 mx-1.5">·</span>
                      <span>Avg <span className="font-bold text-on-surface">{listStats.avg.toFixed(twoDecimalScores ? 2 : 1)}</span></span>
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

      {/* Search input — phone only. Folds away behind the page header's
          search toggle so three rows of chrome aren't permanently parked
          above the list. Desktop uses its "Search this list" button. */}
      {phoneMode && (
        <Collapse open={searchOpen}>
          <div className="pb-4">
            <SearchField
              glassId="list-detail-search"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by name, cuisine, location…"
              aria-label="Search this list"
            />
          </div>
        </Collapse>
      )}

      {/* Delete list confirmation */}
      <Collapse open={confirmDeleteList} className="mb-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-600 font-medium">Delete "{list.name}" list?</p>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => setConfirmDeleteList(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                <button onClick={() => { deleteList(list.id); onBack(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
              </div>
            </div>
      </Collapse>

      {/* ── Phone-only filter pill row ─────────────────────────────────
          Same chrome as the All Rated phone view: Filters / City /
          Cuisine / Price / Sort. Each pill opens the combined filter
          bottom sheet (Sort + Price + Cuisine + City sections), so
          phone users get the same filter surface as desktop without
          juggling four separate sheets. Recipe lists skip this row —
          they have their own filter chrome inside the home-cooking
          branch below. */}
      {phoneMode && !isHomeCooking && totalCount > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* Same rule as the rated list: a chip opens the page its own
              filter owns, so the bar and Filters are one control rather
              than two spellings of it. Every chip landed on the sheet's
              top before, which meant Michelin was three taps from a chip
              labelled Michelin. */}
          <FilterPill onClick={() => openWlFiltersOn(null)}
            icon={<SlidersHorizontal size={12} />} label="Filters"
            active={wishlistActiveFilterCount > 0}
            badge={wishlistActiveFilterCount > 0 ? wishlistActiveFilterCount : undefined} />
          <FilterPill onClick={() => openWlFiltersOn({ id: 'city', title: 'City / Location' })}
            icon={<MapPin size={11} />}
            label={wishlistCityFilter.length > 0 ? `City (${wishlistCityFilter.length})` : 'City'}
            active={wishlistCityFilter.length > 0}
            onClear={wishlistCityFilter.length > 0 ? () => setWishlistCityFilter([]) : undefined} />
          <FilterPill onClick={() => openWlFiltersOn({ id: 'cuisine', title: 'Cuisine' })}
            label={wishlistCuisineFilter.length > 0 ? `Cuisine (${wishlistCuisineFilter.length})` : 'Cuisine'}
            active={wishlistCuisineFilter.length > 0}
            onClear={wishlistCuisineFilter.length > 0 ? () => setWishlistCuisineFilter([]) : undefined} />
          <FilterPill onClick={() => openWlFiltersOn(null)}
            label={wishlistPriceFilter || 'Price'}
            active={!!wishlistPriceFilter}
            onClear={wishlistPriceFilter ? () => setWishlistPriceFilter(null) : undefined} />
          <FilterPill onClick={() => openWlFiltersOn({ id: 'michelin', title: 'Michelin' })}
            label={wishlistMichelinFilter.length > 0 ? `Michelin (${wishlistMichelinFilter.length})` : 'Michelin'}
            active={wishlistMichelinFilter.length > 0}
            onClear={wishlistMichelinFilter.length > 0 ? () => setWishlistMichelinFilter([]) : undefined} />
          <FilterPill onClick={() => openWlFiltersOn(null)}
            icon={<ArrowUpDown size={11} />}
            label={wishlistSort !== 'recent' ? wlSortLabels[wishlistSort] : 'Sort'}
            active={wishlistSort !== 'recent'}
            onClear={wishlistSort !== 'recent' ? () => setWishlistSort('recent') : undefined} />
          {(wishlistActiveFilterCount > 0 || wishlistSort !== 'recent') && (
            <button onClick={resetWishlistFilters}
              className="flex items-center gap-1 px-3 h-8 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0">
              <X size={10} /><span>Clear</span>
            </button>
          )}
        </div>
      )}

      {/* ── Phone-only filter pill row for recipe lists ────────────────
          Mirrors the All Recipes (HomeCookingTab) chrome on desktop:
          Filters / Cuisine / Difficulty / Time / Sort. Each pill opens
          the unified RecipeFilterSheet bottom sheet that already
          handles every section. */}
      {phoneMode && isHomeCooking && totalCount > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          <FilterPill onClick={() => setRecipeFiltersOpen(true)}
            icon={<SlidersHorizontal size={12} />} label="Filters"
            active={recipeActiveFilterCount > 0}
            badge={recipeActiveFilterCount > 0 ? recipeActiveFilterCount : undefined} />
          <FilterPill onClick={() => setRecipeFiltersOpen(true)}
            label={recipeCuisineFilter.length > 0 ? `Cuisine (${recipeCuisineFilter.length})` : 'Cuisine'}
            active={recipeCuisineFilter.length > 0}
            onClear={recipeCuisineFilter.length > 0 ? () => setRecipeCuisineFilter([]) : undefined} />
          <FilterPill onClick={() => setRecipeFiltersOpen(true)}
            label={recipeDifficultyFilter.length > 0 ? `Difficulty (${recipeDifficultyFilter.length})` : 'Difficulty'}
            active={recipeDifficultyFilter.length > 0}
            onClear={recipeDifficultyFilter.length > 0 ? () => setRecipeDifficultyFilter([]) : undefined} />
          <FilterPill onClick={() => setRecipeFiltersOpen(true)}
            icon={<Clock size={11} />}
            label={recipeTimeFilter ? recipeTimeLabel(recipeTimeFilter) : 'Time'}
            active={!!recipeTimeFilter}
            onClear={recipeTimeFilter ? () => setRecipeTimeFilter(null) : undefined} />
          <FilterPill onClick={() => setRecipeFiltersOpen(true)}
            icon={<ArrowUpDown size={11} />}
            label={recipeSortBy !== 'recent' ? recipeSortLabels[recipeSortBy] : 'Sort'}
            active={recipeSortBy !== 'recent'}
            onClear={recipeSortBy !== 'recent' ? () => setRecipeSortBy('recent') : undefined} />
          {(recipeActiveFilterCount > 0 || recipeSortBy !== 'recent') && (
            <button onClick={resetRecipeFilters}
              className="flex items-center gap-1 px-3 h-8 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0">
              <X size={10} /><span>Clear</span>
            </button>
          )}
        </div>
      )}

      {isHomeCooking ? (
        /* ── Home Cooking: Recipe list ── */
        recipes.length === 0 ? (
          <div className="px-1 pt-10 flex flex-col items-start gap-2.5">
            <p className="font-serif text-[18px] font-bold tracking-[-0.028em] text-on-surface">Nothing here yet</p>
            <p className="text-[13.5px] leading-relaxed text-on-surface/55 max-w-[270px]" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              Add the recipe you're thinking of and it lands on this list.
            </p>
            <button onClick={() => openHomeMealModal(undefined, { targetListId: list.id })}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-[15px] py-[11px] text-[12.5px] font-bold text-white active:opacity-85 transition-opacity">
              <Plus size={14} strokeWidth={2.4} />Add recipe
            </button>
          </div>
        ) : (
          <>
            <div className={phoneMode ? 'divide-y divide-on-surface/[0.06]' : 'space-y-2.5'}>
              {filteredRecipes.map((recipe) => {
                const cardData = recipeToCardData(recipe);
                // On the built-in Cooked list, the card's cover prefers the
                // user's private cook photo. Tapping any recipe card opens the
                // recipe detail page; editing lives behind swipe/long-press.
                const isCookedList = list.id === DEFAULT_COOKED_ID;
                const cookPhotos = isCookedList
                  ? (((restaurantMeta as Record<string, unknown>).__cook_photos__ as Record<string, PhotoItem[]> | undefined)?.[recipe.id])
                  : undefined;
                const detailOwner = recipe.sourceAuthorId || user?.id || '';
                const openDetails = () => { if (detailOwner) navigate(`/meal/${detailOwner}/${recipe.id}`); };
                return (
                  <RecipeRow
                    key={recipe.id}
                    {...cardData}
                    coverPhoto={cookPhotos?.[0]?.url || cardData.coverPhoto}
                    isPrivate={recipe.isPrivate}
                    onToggleVisibility={isCookedList || recipe.sourceAuthorId ? undefined : () => {
                      // Public requires a cover photo — open the editor to add one.
                      if (recipe.isPrivate && !recipe.coverPhoto) {
                        showToast('Add a cover photo to make this recipe public');
                        openAddRecipeModal(list.id, recipe);
                        return;
                      }
                      updateRecipe(list.id, recipe.id, { isPrivate: !recipe.isPrivate });
                    }}
                    onClick={openDetails}
                    onEdit={() => openAddRecipeModal(list.id, recipe)}
                    onDelete={isCookedList ? () => removeRecipeFromCookedList(recipe.id) : () => removeRecipe(list.id, recipe.id)}
                  />
                );
              })}
            </div>
            {/* Add more button — phone only. On desktop the header's
                "Add Recipe" CTA replaces this footer. */}
            {phoneMode && (
              <button onClick={() => openHomeMealModal(undefined, { targetListId: list.id })}
                className="mt-3 w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
                <Plus size={16} /><span className="text-sm font-semibold">Add Recipe</span>
              </button>
            )}
          </>
        )
      ) : totalCount === 0 ? (
        <div className="text-center py-16">
          <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">This list is empty</p>
          <p className="text-xs text-on-surface/30 mt-1">Add restaurants from your rated collection</p>
          <button onClick={() => setAddSheetOpen(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-on-primary text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
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
              <div className={viewMode === 'grid' ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-stretch" : phoneMode ? "divide-y divide-on-surface/[0.06]" : "space-y-2.5"}>
                {ratedRestaurants.map(({ id, info, rating }, idx) => viewMode === 'grid' ? (
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
                    onEditNotes={info ? () => openAddRestaurantModal({ id, name: info.name, image: info.image, cuisine: info.cuisine, price: info.price, address: info.address }, 'notes') : undefined}
                    onRemove={() => removeFromList(list.id, id)}
                  />
                ) : (
                  <RestaurantRow
                    key={id}
                    restaurantId={id}
                    rank={idx + 1}
                    name={info?.name ?? id}
                    cuisine={info?.cuisine ?? ''}
                    price={info?.price ?? ''}
                    address={info?.address ?? ''}
                    score={rating?.score}
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
              <div className="w-14 h-14 rounded-full bg-primary/[0.08] text-primary flex items-center justify-center mx-auto mb-4">
                <Bookmark size={20} />
              </div>
              <p className="text-base font-serif font-bold text-on-surface mb-1">Your wishlist is empty</p>
              <p className="text-sm text-on-surface/50 max-w-xs mx-auto">Tap the bookmark on any restaurant card to save it here for later.</p>
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
                <Bookmark size={14} className="text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Wishlist ({wishlistedRestaurantsFinal.length}{wishlistedRestaurantsFinal.length !== wishlistedRestaurantsRaw.length ? ` of ${wishlistedRestaurantsRaw.length}` : ''})</h3>
              </div>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-stretch">
                  {wishlistedRestaurantsFinal.map(({ id, info, wishItem }) => (
                    <RestaurantGridCard
                      key={id}
                      restaurantId={id}
                      name={info?.name ?? id}
                      image={info?.image ?? ''}
                      cuisine={info?.cuisine ?? ''}
                      price={info?.price ?? ''}
                      address={info?.address}
                      notes={wishItem?.notes}
                      onRemove={() => isWishlistView ? removeFromWishlist(id) : removeFromWishlistInList(list.id, id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-on-surface/[0.06]">
                  {wishlistedRestaurantsFinal.map(({ id, info, wishItem }) => (
                    <RestaurantRow
                      key={id}
                      restaurantId={id}
                      name={info?.name ?? id}
                      cuisine={info?.cuisine ?? ''}
                      price={info?.price ?? ''}
                      address={info?.address}
                      onRemove={() => isWishlistView ? removeFromWishlist(id) : removeFromWishlistInList(list.id, id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {/* The dashed "Add Restaurants" footer that used to sit here
              is gone — the prominent top Add button in the phone header
              now covers that affordance, and keeping a duplicate at the
              bottom just clutters the list. Desktop never had this
              footer. */}
        </div>
      )}

      <AddFromRatedSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} listId={list.id} listRestaurantIds={list.restaurantIds}
        onCreateNewRating={(restaurantId, meta) => {
          pendingListRatingRef.current = { restaurantId, openedAt: Date.now() };
          addToList(list.id, restaurantId);
          openAddRestaurantModal(meta);
        }}
      />
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
          hoursFilter={wishlistHoursFilter}
          onHoursFilter={setWishlistHoursFilter}
          michelinFilter={wishlistMichelinFilter}
          onMichelinToggle={toggleWlMichelin}
          allCuisines={wishlistAllCuisines}
          allCities={wishlistAllCities}
          counts={{ cuisine: cuisineCounts, city: cityCounts }}
          initialPage={wlFiltersInitialPage}
          onReset={resetWishlistFilters}
          activeCount={wishlistActiveFilterCount}
        />
      )}

      {isHomeCooking && (
        <RecipeFilterSheet
          open={recipeFiltersOpen}
          onClose={() => setRecipeFiltersOpen(false)}
          sortBy={recipeSortBy}
          onSortBy={(v) => setRecipeSortBy(v as typeof recipeSortBy)}
          cuisineFilter={recipeCuisineFilter}
          onCuisineFilter={setRecipeCuisineFilter}
          difficultyFilter={recipeDifficultyFilter}
          onDifficultyFilter={setRecipeDifficultyFilter}
          timeFilter={recipeTimeFilter}
          onTimeFilter={setRecipeTimeFilter}
          allCuisines={allRecipeCuisines}
          onReset={resetRecipeFilters}
          activeCount={recipeActiveFilterCount}
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
  hoursFilter: HoursFilter;
  onHoursFilter: (v: HoursFilter) => void;
  michelinFilter: string[];
  onMichelinToggle: (d: string) => void;
  allCities: string[];
  allCuisines: string[];
  /** Per-option counts for the Cuisine / City pages. */
  counts?: { cuisine: Record<string, number>; city: Record<string, number> };
  /** Open straight onto one filter's own page (from a chip in the bar). */
  initialPage?: { id: string; title: string } | null;
  onReset: () => void;
}> = ({ open, onClose, sortBy, onSortBy, scoreRange, onScoreRange, cityFilter, onCityFilter, cuisineFilter, onCuisineFilter, priceFilter, onPriceFilter, hoursFilter, onHoursFilter, michelinFilter, onMichelinToggle, allCities, allCuisines, counts, initialPage, onReset }) => {
  return (
    <FilterSheetShell open={open} onClose={onClose} title="Filters" onReset={onReset} initialPage={initialPage}>
      <FilterSortSection>
        <PillRow>
          {([['recent', 'Recent'], ['highest', 'Highest Score'], ['lowest', 'Lowest Score'], ['added', 'Date Added'], ['custom', 'Custom Order']] as const).map(([key, label]) => (
            <Pill key={key} active={sortBy === key} onClick={() => onSortBy(key)}>{label}</Pill>
          ))}
        </PillRow>
      </FilterSortSection>

      <FilterSection
        label="Score"
        value={`${scoreRange[0]} – ${scoreRange[1]}`}
        isSet={scoreRange[0] > 0 || scoreRange[1] < 10}
      >
        <RangeSlider min={0} max={10} value={scoreRange} onChange={onScoreRange} ariaLabelMin="Minimum score" ariaLabelMax="Maximum score" />
        <div className="fs-slider-range"><span>0</span><span>10</span></div>
      </FilterSection>

      <FilterSection label="Price">
        <Segment>
          <SegmentItem active={priceFilter === null} onClick={() => onPriceFilter(null)}>Any</SegmentItem>
          {['$', '$$', '$$$', '$$$$'].map((p) => (
            <SegmentItem key={p} active={priceFilter === p} onClick={() => onPriceFilter(priceFilter === p ? null : p)}>{p}</SegmentItem>
          ))}
        </Segment>
      </FilterSection>

      <HoursFilterSection value={hoursFilter} onChange={onHoursFilter} />

      <MichelinDrillSection selected={michelinFilter} onToggle={onMichelinToggle} />

      <FilterDrillSection
          id="cuisine"
          label="Cuisine"
          options={allCuisines.map((c) => ({ value: c, label: c }))}
          counts={counts?.cuisine}
          selected={cuisineFilter}
          onToggle={(v) => onCuisineFilter(cuisineFilter.includes(v) ? cuisineFilter.filter((x) => x !== v) : [...cuisineFilter, v])}
          emptyLabel="Any"
          searchPlaceholder="Search cuisines"
        />

      <FilterDrillSection
          id="city"
          label="City / Location"
          options={allCities.map((c) => ({ value: c, label: c }))}
          counts={counts?.city}
          selected={cityFilter}
          onToggle={(v) => onCityFilter(cityFilter.includes(v) ? cityFilter.filter((x) => x !== v) : [...cityFilter, v])}
          emptyLabel="Any"
          searchPlaceholder="Search locations"
        />
    </FilterSheetShell>
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
  hoursFilter: HoursFilter;
  onHoursFilter: (v: HoursFilter) => void;
  michelinFilter: string[];
  onMichelinToggle: (d: string) => void;
  allCuisines: string[];
  allCities: string[];
  /** Per-option counts for the Cuisine / City pages. */
  counts?: { cuisine: Record<string, number>; city: Record<string, number> };
  /** Open straight onto one filter's own page (from a chip in the bar). */
  initialPage?: { id: string; title: string } | null;
  onReset: () => void;
  activeCount: number;
}> = ({ open, onClose, sortBy, onSortBy, cuisineFilter, onCuisineFilter, cityFilter, onCityFilter, priceFilter, onPriceFilter, hoursFilter, onHoursFilter, michelinFilter, onMichelinToggle, allCuisines, allCities, counts, initialPage, onReset, activeCount }) => {
  return (
    <FilterSheetShell
      open={open}
      onClose={onClose}
      title="Filter wishlist"
      titleIcon={<SlidersHorizontal size={15} />}
      subtitle={activeCount > 0 ? `${activeCount} active filter${activeCount === 1 ? '' : 's'}` : undefined}
      onReset={onReset}
      applyLabel={activeCount > 0 ? 'Show results' : 'Done'}
      zIndex={120}
      initialPage={initialPage}
    >
      <FilterSortSection>
        <PillRow>
          {([
            ['recent', 'Recently Added'],
            ['oldest', 'Oldest First'],
            ['name-asc', 'Name A–Z'],
            ['name-desc', 'Name Z–A'],
          ] as const).map(([key, label]) => (
            <Pill key={key} active={sortBy === key} onClick={() => onSortBy(key)}>{label}</Pill>
          ))}
        </PillRow>
      </FilterSortSection>

      <FilterSection label="Price">
        <Segment>
          <SegmentItem active={priceFilter === null} onClick={() => onPriceFilter(null)}>Any</SegmentItem>
          {['$', '$$', '$$$', '$$$$'].map((p) => (
            <SegmentItem key={p} active={priceFilter === p} onClick={() => onPriceFilter(priceFilter === p ? null : p)}>{p}</SegmentItem>
          ))}
        </Segment>
      </FilterSection>

      <HoursFilterSection value={hoursFilter} onChange={onHoursFilter} />

      <MichelinDrillSection selected={michelinFilter} onToggle={onMichelinToggle} />

      <FilterDrillSection
          id="cuisine"
          label="Cuisine"
          options={allCuisines.map((c) => ({ value: c, label: c }))}
          counts={counts?.cuisine}
          selected={cuisineFilter}
          onToggle={(v) => onCuisineFilter(cuisineFilter.includes(v) ? cuisineFilter.filter((x) => x !== v) : [...cuisineFilter, v])}
          emptyLabel="Any"
          searchPlaceholder="Search cuisines"
        />

      <FilterDrillSection
          id="city"
          label="City / Location"
          options={allCities.map((c) => ({ value: c, label: c }))}
          counts={counts?.city}
          selected={cityFilter}
          onToggle={(v) => onCityFilter(cityFilter.includes(v) ? cityFilter.filter((x) => x !== v) : [...cityFilter, v])}
          emptyLabel="Any"
          searchPlaceholder="Search locations"
        />
    </FilterSheetShell>
  );
};

/* ── Main Page ── */
// Synthetic ids for the views that aren't a real CustomList, so the header
// chips and the switcher drawer can mark exactly one row active whatever is
// on screen. Custom lists use their own id; cuisines are namespaced.
const VIEW_RATED = 'rated';
const VIEW_COOKBOOK = 'cookbook';
const VIEW_WISHLIST = '__wishlist__';
const cuisineViewId = (name: string) => `cuisine:${name}`;

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
type AddNightPage = 'select' | 'from-rated' | 'search-new';
const MEAL_TYPES: TripRestaurant['mealType'][] = ['breakfast', 'lunch', 'drinks', 'dinner', 'snack'];

const AddToNightSheet: React.FC<{
  open: boolean;
  nightIndex: number;
  nightDate: string;
  tripId: string;
  tripLat: number;
  tripLng: number;
  /** Trip destination string ("Tokyo") — geocoded on demand when the trip
   *  was created without coordinates, so search isn't biased to nowhere. */
  tripDestination: string;
  /** Cache on-demand geocoded coords back onto the trip. */
  onDestinationResolved: (lat: number, lng: number) => void;
  existingRestaurantIds: Set<string>;
  ratings: RestaurantRating[];
  addRestaurantToTrip: (tripId: string, restaurant: TripRestaurant) => void;
  openAddRestaurantModal: (restaurant: RestaurantMeta, initialPage?: string) => void;
  onClose: () => void;
}> = ({ open, nightIndex, nightDate, tripId, tripLat, tripLng, tripDestination, onDestinationResolved, existingRestaurantIds, ratings, addRestaurantToTrip, openAddRestaurantModal, onClose }) => {
  const { phoneMode } = useSettings();
  const { scoresUnlocked } = useLists();
  // The full-screen sheet's swipe-down. Handle-only (an invisible strip in
  // the status-bar band) because the pages inside scroll and search.
  const { dragProps: nightDragProps, startDrag: startNightDrag } = useBottomSheet(open, onClose);
  const [page, setPage] = useState<AddNightPage>('select');
  const [mealType, setMealType] = useState<TripRestaurant['mealType']>('dinner');
  const [reservationTime, setReservationTime] = useState('');
  const [ratedSearch, setRatedSearch] = useState('');
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPage('select');
      setMealType('dinner');
      setReservationTime('');
      setRatedSearch('');
      setPlaceSearch('');
      setPlaceResults([]);
      setJustAdded(null);
    }
  }, [open]);

  // Trips created by typing a destination without picking a suggestion store
  // destinationLat/Lng 0 — a hardcoded fallback here used to quietly search
  // Manhattan for a Tokyo trip. Geocode the destination string on demand
  // instead (cached back onto the trip via onDestinationResolved); if that
  // fails too, search with no location bias at all.
  const resolvedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const resolveTripCoords = async (): Promise<{ lat: number; lng: number } | null> => {
    if (tripLat && tripLng) return { lat: tripLat, lng: tripLng };
    if (resolvedCoordsRef.current) return resolvedCoordsRef.current;
    if (!tripDestination.trim() || !MAPBOX_TOKEN) return null;
    try {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(tripDestination)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality&language=en&limit=1`);
      const data = await res.json();
      const center = data?.features?.[0]?.center;
      if (Array.isArray(center) && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
        const coords = { lat: center[1], lng: center[0] };
        resolvedCoordsRef.current = coords;
        onDestinationResolved(coords.lat, coords.lng);
        return coords;
      }
    } catch { /* fall through to unbiased search */ }
    return null;
  };

  const handleSearchPlaces = async () => {
    if (!placeSearch.trim()) return;
    setPlaceLoading(true);
    try {
      const coords = await resolveTripCoords();
      const res = await searchPlacesByText(placeSearch, coords?.lat ?? null, coords?.lng ?? null);
      setPlaceResults(res);
    } catch { setPlaceResults([]); }
    finally { setPlaceLoading(false); }
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
    const cuisine = getCuisineLabel(place);
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

  const filteredRatings = ratedSearch.trim()
    ? ratings.filter((r) => r.name.toLowerCase().includes(ratedSearch.toLowerCase()) || r.cuisine.toLowerCase().includes(ratedSearch.toLowerCase()))
    : ratings;

  // Gate INSIDE AnimatePresence — an early `return null` unmounted the sheet
  // the instant `open` flipped, skipping the slide-down exit entirely.
  return (
    <AnimatePresence>
      {open && (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
          phoneMode ? "items-end" : "items-end sm:items-center")}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          {...nightDragProps}
          onClick={(e) => e.stopPropagation()}
          className={cn("relative bg-surface w-full overflow-hidden flex flex-col",
            phoneMode ? "h-full rounded-none" : "h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl")}
        >
          {phoneMode && <SheetGrabArea onPointerDown={startNightDrag} />}

          <AnimatePresence mode="wait">
            {/* ═══ PAGE 1: SELECT MODE ═══ */}
            {page === 'select' && (
              <motion.div key="select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                className="flex flex-col flex-1 min-h-0">
                <div className="relative z-10 px-5 pt-safe-4 pb-3 flex items-center justify-between flex-shrink-0">
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
                </div>
              </motion.div>
            )}

            {/* ═══ PAGE 2A: FROM MY RATINGS ═══ */}
            {page === 'from-rated' && (
              <motion.div key="from-rated" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="flex flex-col h-full">
                <div className="relative z-10 px-5 pt-safe-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
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
                            {r.score > 0 && <OwnScoreBadge rating={r.score} unlocked={scoresUnlocked} size="xs" />}
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
                  <button onClick={onClose} className="w-full py-3 bg-primary text-on-primary rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">Done</button>
                </div>
              </motion.div>
            )}

            {/* ═══ PAGE 2B: SEARCH NEW RESTAURANT ═══ */}
            {page === 'search-new' && (
              <motion.div key="search-new" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                className="flex flex-col h-full">
                <div className="relative z-10 px-5 pt-safe-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
                  <button onClick={() => setPage('select')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40"><ChevronLeft size={22} /></button>
                  <h2 className="font-serif font-bold text-lg flex-1">Search Restaurant</h2>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSearchPlaces(); }} className="px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={placeSearch} onChange={(e) => setPlaceSearch(e.target.value)} placeholder="Restaurant name..."
                      autoFocus className="w-full pl-10 pr-20 py-2.5 bg-on-surface/5 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    <button type="submit" disabled={placeLoading || !placeSearch.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-30 transition-opacity">
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
                              <p className="text-[10px] text-on-surface/40">{[getCuisineLabel(place), place.rating > 0 ? `★ ${place.rating}` : ''].filter(Boolean).join(' · ')}</p>
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
          </AnimatePresence>
        </motion.div>
      </motion.div>
      )}
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
  openAddRestaurantModal: (restaurant: RestaurantMeta, initialPage?: string) => void;
  cacheRestaurantMeta: (meta: RestaurantMeta) => void;
  ratings: RestaurantRating[];
  onBack: () => void;
  autoCreate?: boolean;
  onAutoCreateHandled?: () => void;
}> = ({ trips, createTrip, updateTrip, deleteTrip, addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip, openAddRestaurantModal, cacheRestaurantMeta, ratings, onBack, autoCreate, onAutoCreateHandled }) => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const { scoresUnlocked: scoresUnlockedForTrips } = useLists();
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
    const now = localISODate();
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
    const completedRestaurants = selectedTrip.restaurants.filter((r) => r.status === 'completed');
    const completedCount = completedRestaurants.length;
    const plannedCount = selectedTrip.restaurants.filter((r) => r.status === 'planned').length;
    // Trip entries never store a rating of their own — read each completed
    // restaurant's score live from the user's global ratings (always fresh;
    // `r.rating` kept as a legacy fallback) and average over the RATED ones
    // only. Dividing by completedCount showed "0.0" the moment anything
    // unrated was checked off.
    const ratedScores = completedRestaurants
      .map((r) => ratings.find((g) => g.restaurantId === r.restaurantId)?.score ?? r.rating?.score)
      .filter((s): s is number => typeof s === 'number' && s > 0);
    const avgRating = ratedScores.length > 0 && scoresUnlockedForTrips
      ? (ratedScores.reduce((sum, s) => sum + s, 0) / ratedScores.length).toFixed(1)
      : '—';
    const totalRestaurants = selectedTrip.restaurants.length;

    // Check for tonight's reminder
    const today = new Date();
    const tripStart = new Date(selectedTrip.startDate + 'T00:00:00');
    const currentNight = Math.floor((today.getTime() - tripStart.getTime()) / 86400000);
    const tonightDinner = selectedTrip.restaurants.find((r) => r.night === currentNight && r.mealType === 'dinner' && r.status === 'planned');

    return (
      <div className={cn('pb-8', phoneMode && 'pt-safe-4')}>
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
                              MEAL_COLORS[r.mealType] || 'bg-on-surface/[0.08] text-on-surface/70'
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
                              className="hit-44 w-6 h-6 rounded-full flex items-center justify-center text-on-surface/15 hover:text-red-400 hover:bg-red-50 transition-colors">
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
            void shareExternally({ text }).then((result) => {
              if (result === 'copied') alert('Itinerary copied to clipboard!');
            });
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
          tripDestination={selectedTrip.destination}
          onDestinationResolved={(lat, lng) => updateTrip(selectedTrip.id, { destinationLat: lat, destinationLng: lng })}
          existingRestaurantIds={new Set(selectedTrip.restaurants.filter((r) => r.night === addNightIndex).map((r) => r.restaurantId))}
          ratings={ratings}
          addRestaurantToTrip={addRestaurantToTrip}
          openAddRestaurantModal={openAddRestaurantModal}
          onClose={() => setAddNightSheetOpen(false)}
        />
      </div>
    );
  }

  // ── Index view ──
  return (
    <div className="relative">
      {/* Standard phone top-bar layout — same row structure as the other
          list views (back at the left, title, primary action right). */}
      <div className="pt-safe-4 flex items-center gap-2 mb-3">
        <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors flex-shrink-0">
          <ArrowLeft size={20} />
        </button>
        <h2 className="font-serif font-bold text-xl">Trips</h2>
        {sortedTrips.length > 0 && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity flex-shrink-0"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>New Trip</span>
          </button>
        )}
      </div>

      {sortedTrips.length === 0 ? (
        <div className="text-center py-16">
          <Plane size={48} className="text-on-surface/10 mx-auto mb-4" />
          <h3 className="font-serif font-bold text-lg text-on-surface/60 mb-1">Plan Your First Trip</h3>
          <p className="text-sm text-on-surface/30 mb-6 max-w-[240px] mx-auto">Organize restaurants by night and share your itinerary</p>
          <button onClick={() => setCreateOpen(true)}
            className="px-6 py-3 bg-primary text-on-primary rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity">
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
                      "bg-primary/80 text-on-primary"
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

      {/* FAB — bottom offset includes the home-indicator inset so it
          doesn't sit half behind the bar on notched iPhones. */}
      {sortedTrips.length > 0 && (
        <button onClick={() => setCreateOpen(true)} aria-label="Create trip"
          className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-6 z-40 w-14 h-14 bg-primary text-on-primary rounded-full shadow-xl shadow-primary/30 flex items-center justify-center hover:scale-105 transition-transform">
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
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locQuery)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality&language=en&limit=5`);
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
      restaurants: trip?.restaurants || [],
      notes: notes || undefined,
      status,
    });
  };

  const nightCount = startDate && endDate ? getNightCount(startDate, endDate) : 0;

  // Same open-inside-AnimatePresence gate as AddToNightSheet — the early
  // `return null` hard-popped the sheet away with no slide-down.
  return (
    <AnimatePresence>
      {open && (
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
          <div className="px-5 pt-safe-5 pb-3 flex items-center justify-between flex-shrink-0">
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
              className="w-full py-3.5 bg-primary text-on-primary rounded-2xl font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity disabled:opacity-40">
              {trip ? 'Save Changes' : 'Create Trip'}
            </button>
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Home Cooking Tab ── */
const HOME_MEAL_TAGS = ['Comfort Food', 'Healthy', 'Quick & Easy', 'Baking', 'Date Night', 'Meal Prep', 'Grill', 'Pasta', 'Asian', 'Mexican', 'Italian', 'Dessert', 'Breakfast', 'Soup', 'Salad', 'Seafood', 'Vegetarian', 'New Recipe'];

const HomeCookingTab: React.FC<{
  meals: HomeMeal[];
  onUpdateMeal: (id: string, updates: Partial<HomeMeal>) => void;
  onDeleteMeal: (id: string) => void;
  onOpenModal: (meal?: HomeMeal) => void;
  onBack: () => void;
  selectedMealId: string | null;
  onSelectMeal: (id: string | null) => void;
  // When the page's own tabs render this view, the chrome already exists
  // above it — skip the local back button + duplicate header to avoid two
  // layers of it.
  hideHeader?: boolean;
  /** Phone: search + filters fold away behind the header's search toggle. */
  searchOpen?: boolean;
  /** Lifted to the page so the switcher's cuisine rows can drive it. */
  cuisineFilter?: string[];
  onCuisineFilterChange?: (next: string[]) => void;
}> = ({ meals, onUpdateMeal, onDeleteMeal, onOpenModal, onBack, selectedMealId, onSelectMeal, hideHeader = false, searchOpen = true, cuisineFilter: cuisineFilterProp, onCuisineFilterChange }) => {
  const { phoneMode, twoDecimalScores } = useSettings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'quickest'>('recent');
  // Recipe filters — these are recipe-specific and mirror the
  // restaurant filter shape (Cuisine / Difficulty / Time / Sort).
  const [localCuisineFilter, setLocalCuisineFilter] = useState<string[]>([]);
  const cuisineFilter = cuisineFilterProp ?? localCuisineFilter;
  const setCuisineFilter = ((next) => {
    const resolved = typeof next === 'function'
      ? (next as (p: string[]) => string[])(cuisineFilter)
      : next;
    (onCuisineFilterChange ?? setLocalCuisineFilter)(resolved);
  }) as React.Dispatch<React.SetStateAction<string[]>>;
  const [difficultyFilter, setDifficultyFilter] = useState<Array<'Easy' | 'Medium' | 'Hard'>>([]);
  const [timeFilter, setTimeFilter] = useState<'fast' | 'medium' | 'slow' | null>(null);
  const [recipeFiltersOpen, setRecipeFiltersOpen] = useState(false);
  const [recipeViewMode, setRecipeViewMode] = useState<'list' | 'grid'>('list');
  const effectiveRecipeViewMode = phoneMode ? 'list' : recipeViewMode;
  // "Saved" — recipes saved from other people's cookbooks, the header
  // pill's one-tap filter (the reference's Saved toggle, wired to the
  // flag the rows already carry).
  const [savedOnly, setSavedOnly] = useState(false);
  // The reference bar: chips stay put while the search field folds away
  // once the list is actually scrolling.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!phoneMode || hideHeader) return;
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [phoneMode, hideHeader]);

  const allRecipeCuisines = useMemo(() => {
    const set = new Set<string>();
    meals.forEach((m) => { if (m.cuisine) set.add(m.cuisine); });
    return Array.from(set).sort();
  }, [meals]);

  const savedFromOthersCount = useMemo(() => meals.filter(isSavedFromOtherUser).length, [meals]);

  const recipeActiveFilterCount =
    (cuisineFilter.length > 0 ? 1 : 0) +
    (difficultyFilter.length > 0 ? 1 : 0) +
    (timeFilter ? 1 : 0);
  const resetRecipeFilters = () => {
    setCuisineFilter([]); setDifficultyFilter([]); setTimeFilter(null); setSortBy('recent');
  };
  const toggleCuisine = (c: string) =>
    setCuisineFilter((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  const toggleDifficulty = (d: 'Easy' | 'Medium' | 'Hard') =>
    setDifficultyFilter((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const recipeSortLabels: Record<typeof sortBy, string> = {
    recent: 'Recent', highest: 'Highest', lowest: 'Lowest', quickest: 'Quickest',
  };
  const timeLabel = (t: typeof timeFilter) => t === 'fast' ? '<30 min' : t === 'medium' ? '30–60 min' : t === 'slow' ? '>60 min' : 'Time';

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
        m.tags.some((t) => t.toLowerCase().includes(q)) ||
        (m.cuisine?.toLowerCase().includes(q) ?? false)
      );
    }

    if (cuisineFilter.length > 0) {
      result = result.filter((m) => m.cuisine && cuisineFilter.includes(m.cuisine));
    }
    if (difficultyFilter.length > 0) {
      result = result.filter((m) => m.difficulty && difficultyFilter.includes(m.difficulty));
    }
    if (timeFilter) {
      result = result.filter((m) => matchesTimeBand((m.prepTime || 0) + (m.cookTime || 0), timeFilter));
    }
    if (savedOnly) {
      result = result.filter(isSavedFromOtherUser);
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
  }, [meals, searchQuery, sortBy, cuisineFilter, difficultyFilter, timeFilter, savedOnly]);

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

    // Same header geometry as MealRecipePage (the recipe view reached
    // from Discover) so the two pages feel like one product. Owner-only
    // affordances (Edit / Delete) replace the read-only author label
    // that MealRecipePage uses.
    const actionsHeader = (
      <div className="flex items-center gap-3">
        <button onClick={() => onSelectMeal(null)} className="p-2 -ml-2 text-on-surface/50 hover:text-on-surface transition-colors" aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1" />
        <button onClick={() => setShareRecipeData(buildSharedRecipe())}
          className="p-2 text-on-surface/40 hover:text-emerald-600 rounded-full transition-colors" title="Share recipe">
          <ShareIcon size={20} />
        </button>
        {!isSavedFromOtherUser(selectedMeal) && (
          <button onClick={() => onOpenModal(selectedMeal)}
            className="p-2 text-on-surface/40 hover:text-primary rounded-full transition-colors" title="Edit meal">
            <Edit3 size={20} />
          </button>
        )}
        <button onClick={() => setConfirmDeleteId(selectedMeal.id)}
          className="p-2 -mr-2 text-on-surface/40 hover:text-red-500 rounded-full transition-colors" title="Delete meal">
          <Trash2 size={20} />
        </button>
      </div>
    );

    const communitySummary = summarizeReviews(communityReviews);

    const titleBlock = (
      <header>
        <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-on-surface/40 font-medium mb-1">
          {/* date-only strings parse as UTC midnight — anchor to local time
              so US timezones don't render the previous day */}
          {new Date(selectedMeal.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
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
                      {selectedMeal.score.toFixed(twoDecimalScores ? 2 : 1)}
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
        {confirmDeleteId && <ConfirmDeleteDialog title="Delete this recipe?" onCancel={() => setConfirmDeleteId(null)} onConfirm={() => { onDeleteMeal(confirmDeleteId); setConfirmDeleteId(null); onSelectMeal(null); }} />}
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
      <ShareDialog
        open={!!shareRecipeData}
        payload={shareRecipeData ? { sharedRecipe: shareRecipeData } : null}
        onClose={() => setShareRecipeData(null)}
      />
    );

    // ── Phone layout: full-width hero + fully stacked sections ──
    if (phoneMode) {
      return (
        // -mx-3 breaks out of the parent <main className="px-3"> so the
        // hero photo runs edge-to-edge, matching MealRecipePage from
        // Discover. pb-32 + the pt-safe-4 header row below also mirror
        // that page's geometry exactly.
        <div className="-mx-3 pb-32">
          <div className="px-4 pt-safe-4 pb-2">{actionsHeader}</div>

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
      {hideHeader && !phoneMode ? (
        // Desktop toolbar — same shape as the rated view + list detail.
        // Search this list pill on the left, then Filters + anchored
        // recipe-specific pills (Cuisine / Difficulty / Time / Sort),
        // then count + avg + view toggle on the right.
        <div className="mb-5 pb-4 border-b border-on-surface/[0.06]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <ToolbarSearchInput value={searchQuery} onChange={setSearchQuery} />

            <span className="w-px h-5 bg-on-surface/[0.10] flex-shrink-0 mx-1" aria-hidden="true" />

            {/* Filters button — opens the full Spotlight-style recipe
                filter sheet (defined just below this component). */}
            <FilterPill
              onClick={() => setRecipeFiltersOpen(true)}
              icon={<SlidersHorizontal size={12} />}
              label="Filters"
              active={recipeActiveFilterCount > 0}
              badge={recipeActiveFilterCount > 0 ? recipeActiveFilterCount : undefined}
            />
            <AnchoredPill
              pill={{
                label: cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine',
                active: cuisineFilter.length > 0,
                onClear: cuisineFilter.length > 0 ? () => setCuisineFilter([]) : undefined,
              }}
              popoverWidth="w-[260px]"
            >
              {() => (
                <SearchableMultiSelect
                  placeholder="Search cuisines..."
                  options={allRecipeCuisines}
                  selected={cuisineFilter}
                  onToggle={toggleCuisine}
                />
              )}
            </AnchoredPill>
            <AnchoredPill
              pill={{
                label: difficultyFilter.length > 0 ? `Difficulty (${difficultyFilter.length})` : 'Difficulty',
                active: difficultyFilter.length > 0,
                onClear: difficultyFilter.length > 0 ? () => setDifficultyFilter([]) : undefined,
              }}
              popoverWidth="w-[200px]"
            >
              {() => (
                <div className="p-2">
                  {(['Easy', 'Medium', 'Hard'] as const).map((d) => {
                    const isSelected = difficultyFilter.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDifficulty(d)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-left',
                          isSelected ? 'bg-primary/[0.06] text-primary' : 'text-on-surface/75 hover:bg-on-surface/[0.04]',
                        )}
                      >
                        <span className="text-[13px] font-medium">{d}</span>
                        {isSelected && <Check size={14} className="text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </AnchoredPill>
            <AnchoredPill
              pill={{
                icon: <Clock size={11} />,
                label: timeFilter ? timeLabel(timeFilter) : 'Time',
                active: !!timeFilter,
                onClear: timeFilter ? () => setTimeFilter(null) : undefined,
              }}
              popoverWidth="w-[220px]"
            >
              {(close) => (
                <SortPickerContent
                  value={timeFilter ?? ''}
                  options={[
                    ['fast', 'Under 30 min'],
                    ['medium', '30 to 60 min'],
                    ['slow', 'Over 60 min'],
                  ]}
                  onChange={(v) => { setTimeFilter(v as 'fast' | 'medium' | 'slow'); close(); }}
                />
              )}
            </AnchoredPill>
            <AnchoredPill
              pill={{
                icon: <ArrowUpDown size={11} />,
                label: sortBy !== 'recent' ? recipeSortLabels[sortBy] : 'Sort',
                active: sortBy !== 'recent',
                onClear: sortBy !== 'recent' ? () => setSortBy('recent') : undefined,
              }}
              popoverWidth="w-[220px]"
            >
              {(close) => (
                <SortPickerContent
                  value={sortBy}
                  options={[
                    ['recent', 'Recent'],
                    ['highest', 'Highest score'],
                    ['lowest', 'Lowest score'],
                    ['quickest', 'Quickest'],
                  ]}
                  onChange={(v) => { setSortBy(v as typeof sortBy); close(); }}
                />
              )}
            </AnchoredPill>
            {(recipeActiveFilterCount > 0 || sortBy !== 'recent') && (
              <button
                onClick={resetRecipeFilters}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-semibold text-red-500/80 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
              >
                <X size={11} /><span>Clear all</span>
              </button>
            )}

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
                      <span>Avg <span className="font-bold text-on-surface">{visibleAvg.toFixed(twoDecimalScores ? 2 : 1)}</span></span>
                    </>
                  )}
                </p>
              )}
              <ViewModeToggle mode={effectiveRecipeViewMode} onChange={setRecipeViewMode} />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Reference bar — glass back, the Saved toggle, a green add
              circle. The whole block sticks; the search field folds away
              once the list scrolls so the chips ride just under the bar.
              When the page owns the chrome (hideHeader) the sticky wrapper
              and the action row drop out — only search + chips remain. */}
          <div className={hideHeader ? undefined : cn(
            'sticky top-0 z-30 -mx-3 px-3 bg-surface/[0.94] backdrop-blur-lg border-b transition-colors duration-300',
            scrolled ? 'border-on-surface/[0.10]' : 'border-transparent',
          )}>
            <div className={cn('pt-safe-4 flex items-center gap-2', hideHeader && 'hidden')}>
              <GlassButton
                id="cooking-back"
                symbol="chevron.left"
                label="Back"
                onClick={onBack}
                className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface bg-on-surface/[0.05] active:scale-95 transition-transform"
              >
                <ArrowLeft size={18} />
              </GlassButton>
              <div className="flex-1" />
              {savedFromOthersCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSavedOnly((v) => !v)}
                  aria-pressed={savedOnly}
                  className={cn(
                    'flex-none inline-flex items-center gap-1.5 rounded-full border px-3 py-[9px] text-[12px] font-bold transition-colors',
                    savedOnly
                      ? 'bg-on-surface border-on-surface text-cream'
                      : 'border-on-surface/20 text-on-surface active:bg-on-surface/[0.06]',
                  )}
                >
                  <Bookmark size={13} strokeWidth={1.9} className={cn(savedOnly && 'fill-current')} />
                  Saved {savedFromOthersCount}
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenModal()}
                aria-label="Add a recipe"
                className="flex-none w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center active:opacity-85 transition-opacity"
              >
                <Plus size={17} strokeWidth={2.4} />
              </button>
            </div>

            {/* Collapsing search — the native glass field hides itself when
                the wrapper folds (opacity 0 → the mirror resigns + hides).
                With the page header in charge it folds on the header's
                toggle instead of on scroll. */}
            <div
              className="overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={
                hideHeader
                  ? { maxHeight: searchOpen ? 64 : 0, opacity: searchOpen ? 1 : 0 }
                  : { maxHeight: scrolled ? 0 : 64, opacity: scrolled ? 0 : 1 }
              }
              aria-hidden={(hideHeader ? !searchOpen : scrolled) || undefined}
            >
              <div className="pt-3">
                <SearchField
                  glassId="cooking-search"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Dish, cuisine, ingredient"
                  aria-label="Search your recipes"
                />
              </div>
            </div>

            {meals.length > 0 && (
              <div
                className="flex gap-2 pt-3 pb-3 overflow-x-auto scrollbar-hide -mx-3 px-3"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                <FilterPill onClick={() => setRecipeFiltersOpen(true)}
                  icon={<SlidersHorizontal size={12} />} label="Filters"
                  active={recipeActiveFilterCount > 0}
                  badge={recipeActiveFilterCount > 0 ? recipeActiveFilterCount : undefined} />
                <FilterPill onClick={() => setRecipeFiltersOpen(true)}
                  label={cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine'}
                  active={cuisineFilter.length > 0}
                  onClear={cuisineFilter.length > 0 ? () => setCuisineFilter([]) : undefined} />
                <FilterPill onClick={() => setRecipeFiltersOpen(true)}
                  label={difficultyFilter.length > 0 ? `Difficulty (${difficultyFilter.length})` : 'Difficulty'}
                  active={difficultyFilter.length > 0}
                  onClear={difficultyFilter.length > 0 ? () => setDifficultyFilter([]) : undefined} />
                <FilterPill onClick={() => setRecipeFiltersOpen(true)}
                  icon={<Clock size={11} />}
                  label={timeFilter ? timeLabel(timeFilter) : 'Time'}
                  active={!!timeFilter}
                  onClear={timeFilter ? () => setTimeFilter(null) : undefined} />
                <FilterPill onClick={() => setRecipeFiltersOpen(true)}
                  icon={<ArrowUpDown size={11} />}
                  label={sortBy !== 'recent' ? recipeSortLabels[sortBy] : 'Sort'}
                  active={sortBy !== 'recent'}
                  onClear={sortBy !== 'recent' ? () => setSortBy('recent') : undefined} />
              </div>
            )}
          </div>

          {/* The count line — recomputes with every control above. */}
          {meals.length > 0 && (!phoneMode || recipeActiveFilterCount > 0 || sortBy !== 'recent' || savedOnly || searchQuery.trim()) && (
            <div className="flex items-center justify-between px-1 pt-3.5">
              <span className="text-[12px] text-on-surface/55 tabular-nums">
                {filteredMeals.length} recipe{filteredMeals.length === 1 ? '' : 's'}
                {savedOnly ? ' saved' : ''}
                {filteredMeals.length !== meals.length ? ` · of ${meals.length}` : ''}
              </span>
              {(recipeActiveFilterCount > 0 || sortBy !== 'recent' || savedOnly) && (
                <button
                  type="button"
                  onClick={() => { resetRecipeFilters(); setSavedOnly(false); }}
                  className="text-[11.5px] font-bold text-primary active:opacity-70"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Meal cards — list or grid based on the toolbar's view toggle.
          Cards mirror the restaurant card style: cover image (or chef-
          hat placeholder) + name + cuisine/difficulty/time meta + score
          chip on the right. */}
      {filteredMeals.length === 0 ? (
        (searchQuery.trim() || recipeActiveFilterCount > 0 || savedOnly) ? (
          <div className="px-1 pt-10 flex flex-col items-start gap-2.5">
            <p className="font-serif text-[18px] font-bold tracking-[-0.028em] text-on-surface">Nothing matches that</p>
            <p className="text-[13.5px] leading-relaxed text-on-surface/55 max-w-[270px]" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              Try a different filter, or add the recipe you're thinking of.
            </p>
            <button
              type="button"
              onClick={() => { resetRecipeFilters(); setSavedOnly(false); setSearchQuery(''); }}
              className="mt-1.5 rounded-full border border-on-surface/20 px-[15px] py-[11px] text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.06] transition-colors"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="px-1 pt-10 flex flex-col items-start gap-2.5">
            <p className="font-serif text-[18px] font-bold tracking-[-0.028em] text-on-surface">No recipes yet</p>
            <p className="text-[13.5px] leading-relaxed text-on-surface/55 max-w-[270px]" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              Log your first home-cooked meal and it lands here — cookbook, scores and all.
            </p>
            <button
              type="button"
              onClick={() => onOpenModal()}
              className="mt-1.5 rounded-full bg-emerald-600 px-[15px] py-[11px] text-[12.5px] font-bold text-white active:opacity-85 transition-opacity"
            >
              Log a meal
            </button>
          </div>
        )
      ) : effectiveRecipeViewMode === 'grid' ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 items-start">
          {filteredMeals.map((meal) => (
            <RecipeGridCard
              key={meal.id}
              {...homeMealToCardData(meal)}
              onClick={() => { if (user?.id) navigate(`/recipe/${user.id}/${meal.id}`); }}
              onEdit={() => onOpenModal(meal)}
              onDelete={() => onDeleteMeal(meal.id)}
            />
          ))}
        </div>
      ) : (
        <div className={phoneMode ? 'divide-y divide-on-surface/[0.06]' : 'space-y-2.5'}>
          {filteredMeals.map((meal) => (
            <RecipeRow
              key={meal.id}
              {...homeMealToCardData(meal)}
              isPrivate={!meal.isPublic}
              onToggleVisibility={() => {
                // Public requires a cover photo. If there isn't one, open the
                // editor so the user can add one before publishing.
                if (!meal.isPublic && !meal.coverPhoto) {
                  showToast('Add a cover photo to make this recipe public');
                  onOpenModal(meal);
                  return;
                }
                onUpdateMeal(meal.id, { isPublic: !meal.isPublic });
              }}
              onClick={() => { if (user?.id) navigate(`/recipe/${user.id}/${meal.id}`); }}
              onEdit={() => onOpenModal(meal)}
              onDelete={() => onDeleteMeal(meal.id)}
            />
          ))}
        </div>
      )}

      {/* Recipe filter sheet — Spotlight popup on desktop, bottom sheet
          on phone. Same chrome as the restaurant FilterSheet. */}
      <RecipeFilterSheet
        open={recipeFiltersOpen}
        onClose={() => setRecipeFiltersOpen(false)}
        sortBy={sortBy}
        onSortBy={(v) => setSortBy(v as typeof sortBy)}
        cuisineFilter={cuisineFilter}
        onCuisineFilter={setCuisineFilter}
        difficultyFilter={difficultyFilter}
        onDifficultyFilter={setDifficultyFilter}
        timeFilter={timeFilter}
        onTimeFilter={setTimeFilter}
        allCuisines={allRecipeCuisines}
        onReset={resetRecipeFilters}
        activeCount={recipeActiveFilterCount}
      />
    </div>
  );
};

/* ── Recipe meta string ──
   Builds the "Cuisine · 45 min · Easy" line shared by every recipe
   card. Falls back to a dish count when there's no time/difficulty so
   the line never reads empty. */
/** The reference's time pill: fast reads green, an hour neutral, a long
 *  project reads amber — the score-tint tokens, so dark mode holds. */
const timePillClass = (m: number): string =>
  m <= 30 ? 'bg-score-high-tint text-score-high-ink'
  : m <= 60 ? 'bg-on-surface/[0.06] text-on-surface/80'
  : 'bg-score-mid-tint text-score-mid-ink';

function recipeMetaText(opts: { cuisine?: string; totalTime?: number; difficulty?: string; dishCount?: number }): string {
  const { cuisine, totalTime = 0, difficulty, dishCount = 0 } = opts;
  return [
    cuisine || null,
    totalTime > 0 ? formatDuration(totalTime) : null,
    difficulty || null,
    dishCount > 0 && totalTime === 0 && !difficulty
      ? `${dishCount} dish${dishCount !== 1 ? 'es' : ''}`
      : null,
  ].filter(Boolean).join('  ·  ');
}

interface RecipeCardData {
  recipeId: string;
  name: string;
  coverPhoto?: string;
  cuisine?: string;
  totalTime?: number;
  difficulty?: string;
  dishCount?: number;
  score?: number;
  ingredientText?: string;
  ingredientOverflow?: boolean;
  byline?: string;
  /** Recipes saved from another user can't be edited — only removed. */
  canEdit?: boolean;
}

/** Adapt a saved home-cooked meal to the shared recipe-card shape. */
function homeMealToCardData(meal: HomeMeal): RecipeCardData {
  const ingredients = meal.ingredients ?? [];
  const preview = ingredients.slice(0, 3);
  return {
    recipeId: meal.id,
    name: meal.name,
    coverPhoto: getMealCoverUrl(meal),
    cuisine: meal.cuisine,
    totalTime: (meal.prepTime ?? 0) + (meal.cookTime ?? 0),
    difficulty: meal.difficulty,
    dishCount: meal.dishes?.length ?? 0,
    score: meal.score,
    ingredientText: preview.map((i) => i.name).filter(Boolean).join(' · '),
    ingredientOverflow: ingredients.length > preview.length,
    byline: (meal.sourceAuthorUsername || meal.sourceAuthorName)
      ? `by ${meal.sourceAuthorUsername ? `@${meal.sourceAuthorUsername}` : meal.sourceAuthorName}`
      : undefined,
    canEdit: !isSavedFromOtherUser(meal),
  };
}

/** Adapt a recipe saved into a recipe list to the shared card shape. */
function recipeToCardData(recipe: Recipe): RecipeCardData {
  const ingredients = recipe.ingredients ?? [];
  const preview = ingredients.slice(0, 3);
  return {
    recipeId: recipe.id,
    name: recipe.title,
    coverPhoto: recipe.coverPhoto || undefined,
    cuisine: recipe.cuisine,
    totalTime: (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0),
    difficulty: recipe.difficulty,
    score: recipe.score,
    ingredientText: preview.map((i) => i.name).filter(Boolean).join(' · '),
    ingredientOverflow: ingredients.length > preview.length,
    byline: (recipe.sourceAuthorUsername || recipe.sourceAuthorName)
      ? `by ${recipe.sourceAuthorUsername ? `@${recipe.sourceAuthorUsername}` : recipe.sourceAuthorName}`
      : undefined,
    canEdit: !(recipe.sourceAuthorUsername || recipe.sourceAuthorName),
  };
}

/* ── Recipe thumbnail / chef-hat placeholder ── */
const RecipeThumb: React.FC<{ coverPhoto?: string; name: string; size: number }> = ({ coverPhoto, name, size }) => (
  <div
    className="flex-shrink-0 overflow-hidden"
    style={{ width: size, height: size, borderRadius: 20, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}
  >
    {coverPhoto ? (
      <img src={coverPhoto} alt={name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
    ) : (
      /* Neutral, not the old mint tile — a missing photo shouldn't be the
         loudest thing in the row. */
      <div className="flex h-full w-full items-center justify-center bg-on-surface/[0.055]">
        <ChefHat size={Math.round(size * 0.4)} className="text-on-surface/30" strokeWidth={1.7} />
      </div>
    )}
  </div>
);

/* ── Recipe list row (Recipe Cards Redesign) ──
   Mobile: flat hairline-divided row, swipe left to reveal Edit (grey) +
   Delete (red), matching the restaurant rows. Desktop: boxed card that
   lifts on hover with inline edit/delete. Cover thumbnail on the left,
   serif title + clock-meta + ingredient preview in the middle, tiered
   ScoreRing on the right. */
const RecipeRow: React.FC<RecipeCardData & {
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Current visibility — drives the Publish/Private swipe action. */
  isPrivate?: boolean;
  onToggleVisibility?: () => void;
}> = ({
  name, coverPhoto, cuisine, totalTime = 0, difficulty, dishCount = 0,
  score, ingredientText, ingredientOverflow, byline, canEdit = true,
  isPrivate, onToggleVisibility,
  onClick, onEdit, onDelete,
}) => {
  const { phoneMode } = useSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const swipe = useSwipeActions((onToggleVisibility ? 1 : 0) + (onEdit && canEdit ? 1 : 0) + (onDelete ? 1 : 0));
  const { tx, open, dragging, revealWidth, closeSwipe } = swipe;
  const metaText = recipeMetaText({ cuisine, totalTime, difficulty, dishCount });
  // Phone meta line — time moved into its pill, so this is just the words.
  const smallMeta = [cuisine, difficulty].filter(Boolean).join(' · ')
    || (dishCount > 0 ? `${dishCount} dish${dishCount !== 1 ? 'es' : ''}` : '');
  const hasEdit = !!onEdit && canEdit;
  const hasRemove = !!onDelete;

  const handleDelete = () => {
    if (!onDelete) return;
    setDismissed(true);
    setTimeout(() => onDelete(), 300);
  };

  if (dismissed) return null;

  const hasVisibility = !!onToggleVisibility;
  const actions = [
    ...(hasVisibility ? [{ label: isPrivate ? 'Publish' : 'Private', icon: isPrivate ? <Globe size={20} /> : <Lock size={20} />, onClick: () => onToggleVisibility?.() }] : []),
    ...(hasEdit ? [{ label: 'Edit', icon: <Edit3 size={20} />, onClick: () => onEdit?.() }] : []),
    ...(hasRemove ? [{ label: 'Delete', icon: <Trash2 size={20} />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
  ];
  const onForegroundClick = (e: React.MouseEvent) => { if (!swipe.onForegroundClick(e)) onClick(); };
  const contextMenu = swipe.menuRect && <CardActionMenu rect={swipe.menuRect} actions={actions} onClose={() => swipe.setMenuRect(null)} />;

  // ── Mobile: flat row, swipe left to reveal Edit + Delete ──
  if (phoneMode) {
    return (
      <div ref={swipe.rowRef} className="library-recipe-row relative overflow-hidden">
        <SwipeActionTray actions={actions} width={revealWidth} visible={tx < -5} onClose={closeSwipe} />
        <div
          {...swipe.foregroundProps}
          style={{
            transform: `translateX(${tx}px)`,
            transition: dragging ? 'none' : 'transform 0.38s cubic-bezier(0.2, 0.85, 0.25, 1)',
            touchAction: 'pan-y',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
          className="relative z-10 bg-surface"
        >
          <button
            onClick={onForegroundClick}
            className="flex w-full items-start gap-3.5 px-1 py-[15px] text-left"
          >
            <RecipeThumb coverPhoto={coverPhoto} name={name} size={90} />
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-[16px] font-bold leading-[1.2] tracking-[-0.025em] text-on-surface line-clamp-2">{name}</h3>
              {(totalTime > 0 || smallMeta) && (
                <div className="mt-[7px] flex items-center gap-[7px] min-w-0">
                  {totalTime > 0 && (
                    <span className={cn('flex-none rounded-full px-[9px] py-1.5 text-[11px] font-bold tabular-nums', timePillClass(totalTime))}>
                      {formatDuration(totalTime)}
                    </span>
                  )}
                  {smallMeta && <span className="text-[12px] text-on-surface/55 truncate">{smallMeta}</span>}
                </div>
              )}
              {ingredientText && (
                <p className="mt-[7px] text-[12px] leading-snug text-on-surface/45 truncate">
                  {ingredientText}
                </p>
              )}
              {byline && <p className="mt-1 truncate text-[11px] italic text-on-surface/45">{byline}</p>}
            </div>
            <ScoreRing score={score} size={44} className="mt-0.5" />
          </button>
        </div>
        {confirmDelete && (
          <ConfirmDeleteDialog
            name={name}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => { setConfirmDelete(false); handleDelete(); }}
          />
        )}
        {contextMenu}
      </div>
    );
  }

  // ── Desktop: boxed list card with hover edit/delete + inset-ring score ──
  // The clickable surface is a role="button" div (not a <button>) so the
  // inline Edit/Delete buttons can nest without invalid-DOM warnings.
  return (
    <div ref={swipe.rowRef} className="library-recipe-row group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        onContextMenu={swipe.foregroundProps.onContextMenu}
        className="card-surface card-surface-hover flex w-full cursor-pointer items-center gap-5 px-[22px] py-[18px] text-left shadow-sm"
      >
        <RecipeThumb coverPhoto={coverPhoto} name={name} size={76} />
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[20px] font-bold leading-[1.15] tracking-[-0.01em] text-on-surface line-clamp-2">{name}</h3>
          {metaText && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-on-surface/70">
              {totalTime > 0 && <Clock size={13} className="flex-shrink-0 text-on-surface/40" />}
              <span className="truncate">{metaText}</span>
            </p>
          )}
          {ingredientText && (
            <p className="mt-[7px] text-[13px] font-medium leading-[1.5] text-on-surface/40 line-clamp-2">
              {ingredientText}{ingredientOverflow ? '…' : ''}
            </p>
          )}
          {byline && <p className="mt-1 truncate text-[11px] italic text-on-surface/45">{byline}</p>}
        </div>
        {(hasVisibility || hasEdit || hasRemove) && (
          <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {hasVisibility && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleVisibility?.(); }} aria-label={isPrivate ? `Publish ${name}` : `Make ${name} private`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface/35 transition-colors hover:bg-secondary/10 hover:text-secondary" title={isPrivate ? 'Private — tap to publish' : 'Public — tap to make private'}>
                {isPrivate ? <Globe size={15} /> : <Lock size={15} />}
              </button>
            )}
            {hasEdit && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit?.(); }} aria-label={`Edit ${name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface/35 transition-colors hover:bg-primary/[0.06] hover:text-primary">
                <Edit3 size={15} />
              </button>
            )}
            {hasRemove && (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }} aria-label={`Delete ${name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface/25 transition-colors hover:bg-red-50 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
        <ScoreRing score={score} size={46} />
      </div>
      {confirmDelete && (
        <ConfirmDeleteDialog
          name={name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); handleDelete(); }}
        />
      )}
      {contextMenu}
    </div>
  );
};

/* ── Recipe grid card (Recipe Cards Redesign) ──
   Desktop editorial tile: 4:3 cover (or soft chef-hat placeholder) with
   the tiered ScoreRing overlaid bottom-left, serif title + clock-meta
   below. Hover lifts the surface and reveals Edit / Delete. */
const RecipeGridCard: React.FC<RecipeCardData & {
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}> = ({
  name, coverPhoto, cuisine, totalTime = 0, difficulty, dishCount = 0,
  score, byline, canEdit = true, onClick, onEdit, onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cardMenu, setCardMenu] = useState<DOMRect | null>(null);
  const cardPress = useCardLongPress<null>((_, target) => { if ((onEdit && canEdit) || onDelete) setCardMenu(target.getBoundingClientRect()); });
  const cardMenuNode = cardMenu && <CardActionMenu rect={cardMenu} onClose={() => setCardMenu(null)} actions={[
    ...(onEdit && canEdit ? [{ label: 'Edit', icon: <Edit3 size={18} />, onClick: onEdit }] : []),
    ...(onDelete ? [{ label: 'Delete', icon: <Trash2 size={18} />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
  ]} />;
  const metaText = recipeMetaText({ cuisine, totalTime, difficulty, dishCount });
  const hasEdit = !!onEdit && canEdit;
  const hasRemove = !!onDelete;
  return (
    <div className="group relative">
      <button {...cardPress.getHandlers(null)}
        onClick={() => { if (cardPress.suppressClickRef.current) { cardPress.suppressClickRef.current = false; return; } onClick(); }}
        className="w-full text-left card-surface card-surface-hover active:scale-[0.99]"
      >
        {/* Cover image / placeholder */}
        <div className="relative aspect-[4/3] overflow-hidden bg-emerald-50">
          {coverPhoto ? (
            <img src={coverPhoto} alt={name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ChefHat size={46} className="text-emerald-500" strokeWidth={1.5} />
            </div>
          )}
          <ScoreRing score={score} size={44} onPhoto className="absolute bottom-3 left-3" />
        </div>

        {/* Body */}
        <div className="px-[18px] pb-[17px] pt-[15px]">
          <h3 className="font-serif text-[19px] font-bold leading-[1.15] tracking-[-0.01em] text-on-surface line-clamp-2">
            {name}
          </h3>
          {metaText && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-on-surface/70">
              {totalTime > 0 && <Clock size={13} className="flex-shrink-0 text-on-surface/40" />}
              <span className="truncate">{metaText}</span>
            </p>
          )}
          {byline && (
            <p className="mt-1 truncate text-[11px] italic text-on-surface/45">{byline}</p>
          )}
        </div>
      </button>
      {/* Hover actions: Edit + Delete, stacked top-left so they don't
          crowd the score overlay on the bottom-left or the title. */}
      {(hasEdit || hasRemove) && (
        <div className="absolute right-2 top-2 flex flex-col gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {hasEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
              aria-label={`Edit ${name}`}
              className="h-7 w-7 rounded-full bg-white/90 text-on-surface/55 shadow-sm backdrop-blur-sm transition-colors hover:bg-white hover:text-emerald-600"
            >
              <Edit3 size={13} className="mx-auto" />
            </button>
          )}
          {hasRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              aria-label={`Delete ${name}`}
              className="h-7 w-7 rounded-full bg-white/90 text-on-surface/55 shadow-sm backdrop-blur-sm transition-colors hover:bg-white hover:text-red-600"
            >
              <Trash2 size={13} className="mx-auto" />
            </button>
          )}
        </div>
      )}
      {cardMenuNode}
      {confirmDelete && (
        <ConfirmDeleteDialog
          name={name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); onDelete?.(); }}
        />
      )}
    </div>
  );
};

/* ── Recipe filter sheet ──
   Spotlight-style centered popup on desktop, drag-to-dismiss bottom
   sheet on phone. Sections: Sort / Cuisine / Difficulty / Time. */
const RecipeFilterSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  sortBy: string;
  onSortBy: (v: string) => void;
  cuisineFilter: string[];
  onCuisineFilter: (v: string[]) => void;
  difficultyFilter: Array<'Easy' | 'Medium' | 'Hard'>;
  onDifficultyFilter: (v: Array<'Easy' | 'Medium' | 'Hard'>) => void;
  timeFilter: 'fast' | 'medium' | 'slow' | null;
  onTimeFilter: (v: 'fast' | 'medium' | 'slow' | null) => void;
  allCuisines: string[];
  onReset: () => void;
  activeCount: number;
}> = ({ open, onClose, sortBy, onSortBy, cuisineFilter, onCuisineFilter, difficultyFilter, onDifficultyFilter, timeFilter, onTimeFilter, allCuisines, onReset, activeCount }) => {
  return (
    <FilterSheetShell
      open={open}
      onClose={onClose}
      title="Filter recipes"
      titleIcon={<SlidersHorizontal size={15} />}
      subtitle={activeCount > 0 ? `${activeCount} active filter${activeCount === 1 ? '' : 's'}` : undefined}
      onReset={onReset}
      applyLabel={activeCount > 0 ? 'Show recipes' : 'Done'}
      zIndex={120}
    >
      <FilterSortSection>
        <PillRow>
          {([['recent', 'Recent'], ['highest', 'Highest score'], ['lowest', 'Lowest score'], ['quickest', 'Quickest']] as const).map(([key, label]) => (
            <Pill key={key} active={sortBy === key} onClick={() => onSortBy(key)}>{label}</Pill>
          ))}
        </PillRow>
      </FilterSortSection>

      <FilterSection label="Difficulty">
        <PillRow>
          {(['Easy', 'Medium', 'Hard'] as const).map((d) => {
            const isSelected = difficultyFilter.includes(d);
            return (
              <Pill
                key={d}
                active={isSelected}
                onClick={() => onDifficultyFilter(isSelected ? difficultyFilter.filter((x) => x !== d) : [...difficultyFilter, d])}
              >
                {d}
              </Pill>
            );
          })}
        </PillRow>
      </FilterSection>

      <FilterSection label="Total time">
        <Segment>
          {([['fast', 'Under 30 min'], ['medium', '30–60 min'], ['slow', 'Over 60 min']] as const).map(([key, label]) => (
            <SegmentItem key={key} active={timeFilter === key} onClick={() => onTimeFilter(timeFilter === key ? null : key)}>{label}</SegmentItem>
          ))}
        </Segment>
      </FilterSection>

      <FilterDrillSection
          id="cuisine"
          label="Cuisine"
          options={allCuisines.map((c) => ({ value: c, label: c }))}
          selected={cuisineFilter}
          onToggle={(v) => onCuisineFilter(cuisineFilter.includes(v) ? cuisineFilter.filter((x) => x !== v) : [...cuisineFilter, v])}
          emptyLabel="Any"
          searchPlaceholder="Search cuisines"
        />
    </FilterSheetShell>
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
  /* Outlined, not filled. A row of grey slabs reads as five disabled
     buttons; an outline says "control" and leaves the ink for the one
     that's actually on, which fills solid. */
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'library-filter hit-44-y inline-flex items-center gap-1.5 rounded-full border px-[13px] py-[9px] flex-shrink-0 active:opacity-80 transition-colors',
      active
        ? 'bg-on-surface border-on-surface text-cream'
        : 'bg-transparent border-on-surface/20 text-on-surface',
    )}
    style={{ fontSize: '12px', fontWeight: 700 }}
  >
    {icon}
    <span>{label}</span>
    {badge !== undefined && (
      <span
        className={cn(
          'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full',
          active ? 'bg-cream text-on-surface' : 'bg-primary text-on-primary',
        )}
        style={{ fontSize: '9.5px', fontWeight: 700 }}
      >
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
        className="ml-0.5 p-2 -m-1.5 opacity-70"
      >
        <X size={10} />
      </span>
    ) : (
      <ChevronDown size={11} className="opacity-55" />
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
            'absolute top-full left-0 origin-top-left mt-2 z-50 bg-surface rounded-2xl',
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
// popovers. Lighter chrome than a full bottom sheet (no big header bar).
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
  const navigate = useNavigate();
  const goBack = usePageBack('/pantry');
  const location = useLocation();
  // Read URL params synchronously on first render so the initial state
  // matches the URL — fixes the flicker (and worse, the visible "back-
  // to-All-Rated" jump) when remounting at /pantry?list=<id> after
  // navigating to a restaurant detail and back. Without this the URL
  // effect runs only after the first render commits, briefly showing
  // the rated view before snapping into the right list.
  const initialUrlState = (() => {
    const sp = new URLSearchParams(location.search);
    return {
      listId: sp.get('list'),
      view: sp.get('view'),
    };
  })();
  const [selectedList, setSelectedList] = useState<CustomList | null>(() => {
    const id = initialUrlState.listId;
    if (!id) return null;
    if (id === '__wishlist__') {
      return {
        id: '__wishlist__', name: 'Want to try', emoji: '🔖',
        restaurantIds: [], wishlistIds: [], createdAt: 0,
      } as CustomList;
    }
    // Stub matches the URL effect's behavior — the lists-driven effect
    // below fills in the real list object once data is available.
    return {
      id, name: '', emoji: '',
      restaurantIds: [], wishlistIds: [], createdAt: 0,
    } as CustomList;
  });
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  // Which tab the create-list sheet was opened from — controls which presets
  // appear and whether a custom list is tagged as a recipe list.
  const [createSheetKind, setCreateSheetKind] = useState<'restaurants' | 'recipes'>('restaurants');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showTrips, setShowTrips] = useState<boolean>(() => initialUrlState.view === 'trips');
  const [showHomeCooking, setShowHomeCooking] = useState<boolean>(() => initialUrlState.view === 'home-cooking');
  const [homeCookingSelectedMealId, setHomeCookingSelectedMealId] = useState<string | null>(null);
  const [createTripFromList, setCreateTripFromList] = useState(false);
  // Phone chrome: the search + filter row folds away by default (three rows
  // of header above a list you came here to read is enough), and the title
  // opens the list switcher.
  const [pantrySearchOpen, setPantrySearchOpen] = useState(false);
  const [listDrawerOpen, setListDrawerOpen] = useState(false);
  // ── Shared lists ── selected by id from ?shared=; the view itself lives in
  // components/shared-lists so this page only routes to it.
  const { sharedLists, entriesFor: sharedEntriesFor } = useSharedLists();
  const [selectedSharedId, setSelectedSharedId] = useState<string | null>(null);
  const [createSharedOpen, setCreateSharedOpen] = useState(false);
  const { requirePro } = usePaywall();
  // Shared lists: the owner needs Pro, the people they invite don't.
  const openCreateShared = () => {
    if (!requirePro('shared-lists', { onUnlocked: () => setCreateSharedOpen(true) })) return;
    setCreateSharedOpen(true);
  };
  const selectedShared = selectedSharedId ? (sharedLists.find((l) => l.id === selectedSharedId) ?? null) : null;
  // Lifted out of HomeCookingTab / ListDetailView so the page header's
  // cuisine rows and ⋯ menu can drive them.
  const [recipeCuisineFilter, setRecipeCuisineFilter] = useState<string[]>([]);
  const [confirmDeletePageList, setConfirmDeletePageList] = useState(false);
  const { phoneMode, setHideBottomNav, twoDecimalScores } = useSettings();
  const { user } = useAuth();
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
  const [michelinFilter, setMichelinFilter] = useState<string[]>([]);
  const toggleMichelinFilter = (d: string) =>
    setMichelinFilter((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  const michelinReady = useMichelinIndexReady();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The list header scrolls away and hands off to a pinned glass cluster.
  const listFade = useHeaderFade({ enabled: phoneMode, windowScroll: true });
  // Which page Filters should land on. A chip in the bar opens the page
  // that chip's filter owns; the Filters chip itself opens the top.
  const [filtersInitialPage, setFiltersInitialPage] = useState<{ id: string; title: string } | null>(null);
  const openFiltersOn = (page: { id: string; title: string } | null) => {
    setFiltersInitialPage(page);
    setFiltersOpen(true);
  };
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>(emptyHoursFilter());
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest' | 'added' | 'custom'>('highest');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Quick filter dropdowns
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cuisineDropdownOpen, setCuisineDropdownOpen] = useState(false);
  const [priceDropdownOpen, setPriceDropdownOpen] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  // Controlled search text for the phone city/cuisine picker sheets — DOM
  // reads during render don't re-render, so the lists never filtered.
  const [cityPickerSearch, setCityPickerSearch] = useState('');
  const [cuisinePickerSearch, setCuisinePickerSearch] = useState('');

  const closeAllDropdowns = () => { setCityDropdownOpen(false); setCuisineDropdownOpen(false); setPriceDropdownOpen(false); setSortDropdownOpen(false); setCityPickerSearch(''); setCuisinePickerSearch(''); };

  const sortLabels: Record<string, string> = { recent: 'Recent', highest: 'Highest', lowest: 'Lowest', added: 'Date Added', custom: 'Custom' };

  // Main search
  const [mainSearchQuery, setMainSearchQuery] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Ranked recommendations popup ("For you").
  const [recsOpen, setRecsOpen] = useState(false);

  // Desktop list switcher — replaces the sidebar's old Pantry tray. The
  // button shows the current view ("Your rankings", "All Recipes", "Wishlist"),
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
    // cityFromAddress knows to drop trailing country / "STATE ZIP" tokens —
    // the last comma segment of a full address is usually the COUNTRY.
    const items = filteredRatings.map((r) => ({
      name: r.name, address: r.address, city: cityFromAddress(r.address),
      cuisine: r.cuisine, rating: r.score, notes: r.notes,
      date_visited: r.visitDate, is_wishlist: false, price_range: r.price.length,
    }));
    // Also add wishlist items
    wishlist.forEach((w) => {
      items.push({
        name: w.name, address: w.address, city: cityFromAddress(w.address),
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
    ratings, scoresUnlocked, openAddRestaurantModal, removeRating,
    wishlist, restaurantMeta,
    trips, createTrip, updateTrip, deleteTrip,
    addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip,
    cacheRestaurantMeta, addToList,
    customOrder, setCustomOrder,
    homeMeals, createHomeMeal, updateHomeMeal, deleteHomeMeal, openHomeMealModal,
  } = useLists();

  // Backfill hours for every rated restaurant while the hours filter is
  // active — the filter reads cached meta, and unknown hours never hide a
  // place, so without warming the filter is a no-op for unvisited spots.
  const ratedHoursWarmActive = isHoursFilterActive(hoursFilter);
  const ratedHoursWarmIds = useMemo(
    () => (ratedHoursWarmActive ? ratings.map((r) => r.restaurantId) : []),
    [ratedHoursWarmActive, ratings],
  );
  useWarmHoursForFilter(ratedHoursWarmIds, ratedHoursWarmActive);

  /**
   * URL-driven view selection. The desktop sidebar navigates between
   * lists by setting query params:
   *   ?list=__wishlist__   → synthetic Wishlist view
   *   ?list=<custom-id>    → user-created list
   *   ?view=home-cooking   → Home Cooking grid
   *   ?view=trips          → Trips planner
   *   ?new-list=1          → opens the create-list sheet, then strips
   *                          the param so a refresh doesn't re-open it
   * Plain `/pantry` resets back to the main lists overview — but only
   * when that's a real in-page back-step (e.g. popping out of a custom
   * list via the browser/swipe-back history). Pantry is a keep-alive tab
   * root, so the bottom nav's Lists tab always targets bare `/pantry`
   * too, and arriving there FROM ANOTHER ROUTE is a tab switch, not a
   * "go back to the overview" — it should land wherever you left off
   * (Recipes stays Recipes). `lastPathnameRef` is what tells the two
   * apart: unchanged (still '/pantry') means an internal transition,
   * changed means we just switched tabs.
   *
   * Crucially the URL-branches below are otherwise deps-only — `lists`
   * lives in a sibling effect. Mixing them caused a regression where any
   * list mutation (e.g. addToList) re-ran this effect, found no URL
   * params (because the user had navigated via state, not URL), and
   * blew selectedList back to null — i.e. dumped the user back to the
   * rated view mid-action.
   */
  const lastPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    const arrivedFromElsewhere = lastPathnameRef.current !== null && lastPathnameRef.current !== '/pantry';
    lastPathnameRef.current = location.pathname;

    // Pantry is a keep-alive tab root — it stays mounted (and this
    // `location` keeps updating) for the entire app session, including
    // while a completely different route is on screen. Without this guard,
    // navigating AWAY to e.g. Home ran this effect with pathname '/' and
    // fell straight through every branch below to "plain /pantry", wiping
    // showHomeCooking the instant the user left — not when they returned —
    // which is what made the Recipes tab forget itself in the first place.
    if (location.pathname !== '/pantry') return;

    const sp = new URLSearchParams(location.search);
    const listId = sp.get('list');
    const view = sp.get('view');
    const newList = sp.get('new-list');
    const sharedId = sp.get('shared');

    if (sharedId) {
      setShowTrips(false);
      setShowHomeCooking(false);
      setSelectedList(null);
      setSelectedSharedId(sharedId);
      return;
    }
    setSelectedSharedId(null);

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
          id: '__wishlist__', name: 'Want to try', emoji: '🔖',
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

    // Plain /pantry — clear any sub-view state, UNLESS we just switched
    // to this tab from a different route, in which case whatever
    // section/list was open before we left is still the right thing to
    // show (see the comment above this effect).
    if (arrivedFromElsewhere) return;
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

  // Extract unique cities from addresses. cityFromAddress drops trailing
  // country / "STATE ZIP" segments — the naive last-comma-segment version
  // filled this facet with "USA".
  const allCities = useMemo(() => {
    const cities = new Set<string>();
    ratings.forEach((r) => {
      const c = cityFromAddress(r.address);
      if (c) cities.add(c);
    });
    return Array.from(cities).sort();
  }, [ratings]);

  const allCuisines = useMemo(() => {
    const cuisines = new Set<string>();
    ratings.forEach((r) => { if (r.cuisine) cuisines.add(r.cuisine); });
    return Array.from(cuisines).sort();
  }, [ratings]);

  // Counts for the Cuisine / City filter pages — same evidence the list
  // sheets show, from the same ratings.
  const rootFilterCounts = useMemo(() => {
    const cuisine: Record<string, number> = {};
    const city: Record<string, number> = {};
    ratings.forEach((r) => {
      if (r.cuisine) cuisine[r.cuisine] = (cuisine[r.cuisine] || 0) + 1;
      const c = cityFromAddress(r.address);
      if (c) city[c] = (city[c] || 0) + 1;
    });
    return { cuisine, city };
  }, [ratings]);

  const allPrices = ['$', '$$', '$$$', '$$$$'];

  // Filter and sort rated restaurants
  const filteredRatings = useMemo(() => {
    // Copy before the in-place sorts below so the context array is never mutated.
    let result = [...ratings];

    if (mainSearchQuery.trim()) {
      const q = mainSearchQuery.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
    }
    if (cityFilter.length > 0) {
      result = result.filter((r) => cityFilter.includes(cityFromAddress(r.address)));
    }
    if (cuisineFilter.length > 0) result = result.filter((r) => cuisineFilter.includes(r.cuisine));
    if (priceFilter) result = result.filter((r) => r.price === priceFilter);
    if (michelinFilter.length > 0) {
      result = result.filter((r) => {
        const meta = restaurantMeta[r.restaurantId];
        return passesMichelinFilter(michelinFilter, r.name, meta?.lat, meta?.lng, r.address || meta?.address);
      });
    }
    result = result.filter((r) => r.score >= scoreRange[0] && r.score <= scoreRange[1]);
    if (isHoursFilterActive(hoursFilter)) result = result.filter((r) => passesHoursFilter(restaurantMeta[r.restaurantId]?.hours, hoursFilter, restaurantLocalNow(restaurantMeta[r.restaurantId]?.lng)));

    if (sortBy === 'custom') {
      const orderMap = new Map<string, number>(customOrder.map((id, i) => [id, i]));
      result.sort((a, b) => {
        const ai = orderMap.get(a.restaurantId) ?? Infinity;
        const bi = orderMap.get(b.restaurantId) ?? Infinity;
        return ai - bi;
      });
    } else if (sortBy === 'highest') result.sort((a, b) => b.score - a.score);
    else if (sortBy === 'lowest') result.sort((a, b) => a.score - b.score);
    else if (sortBy === 'added') result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return result;
  }, [ratings, mainSearchQuery, cityFilter, cuisineFilter, priceFilter, michelinFilter, michelinReady, restaurantMeta, scoreRange, hoursFilter, sortBy, customOrder]);

  // Drag-to-reorder for custom sort (desktop inline drag). Splices the
  // moved id WITHIN the full saved order — the old rebuild
  // ([...visibleIds, ...rest]) shoved every filtered-out restaurant behind
  // the visible ones, silently rewriting the global ranking whenever a
  // search/filter was active.
  const moveRating = useCallback((from: number, to: number) => {
    const next = moveWithinCustomOrder(customOrder, filteredRatings.map((r) => r.restaurantId), from, to);
    if (next) setCustomOrder(next);
  }, [filteredRatings, customOrder, setCustomOrder]);

  const regularRatingsCount = ratings.length;
  const regularWishlist = wishlist;

  // Sort is NOT a filter: it never counts into the Filters badge. The Sort
  // pill itself lights up for any non-default choice (see isNonDefaultSort)
  // — the old rules disagreed with each other ('recent' showed nothing
  // active while 'lowest'/'added' inflated the filter count).
  const activeFilterCount = (cityFilter.length > 0 ? 1 : 0) + (cuisineFilter.length > 0 ? 1 : 0) + (priceFilter ? 1 : 0) + (michelinFilter.length > 0 ? 1 : 0) + (scoreRange[0] > 0 || scoreRange[1] < 10 ? 1 : 0) + (isHoursFilterActive(hoursFilter) ? 1 : 0);
  const isNonDefaultSort = sortBy !== 'highest';
  const hasActiveFilters = activeFilterCount > 0 || isNonDefaultSort;

  // Seed custom order from current sort if empty when switching to custom
  const handleSortBy = useCallback((v: typeof sortBy) => {
    if (v === 'custom' && customOrder.length === 0) {
      const sorted = [...ratings].sort((a, b) => b.score - a.score);
      setCustomOrder(sorted.map((r) => r.restaurantId));
    }
    setSortBy(v);
  }, [customOrder, ratings, setCustomOrder]);

  const handleResetFilters = () => {
    setCityFilter([]); setCuisineFilter([]); setPriceFilter(null); setMichelinFilter([]);
    setScoreRange([0, 10]); setHoursFilter(emptyHoursFilter()); setSortBy('highest');
  };

  const toggleCityFilter = (city: string) => setCityFilter((prev) => prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]);
  const toggleCuisineFilter = (cuisine: string) => setCuisineFilter((prev) => prev.includes(cuisine) ? prev.filter((c) => c !== cuisine) : [...prev, cuisine]);

  // Keep selectedList in sync
  const currentList = selectedList
    ? selectedList.id === '__wishlist__'
      ? { ...selectedList, wishlistIds: regularWishlist.map((w) => w.restaurantId) } as CustomList
      : lists.find((l) => l.id === selectedList.id) ?? null
    : null;

  const hideTopBar = showHomeCooking && homeCookingSelectedMealId !== null;

  // Phone's page-level chrome (segment · title · chip rail) sits above the
  // whole view switch, so it has to stand down for the two things that are
  // their own screen rather than a list: a recipe's detail drill-down, and
  // Trips (which was never part of the list-switcher pattern on either
  // platform and keeps its own navigation).
  const showPhoneHeader =
    phoneMode && !showTrips && !(showHomeCooking && homeCookingSelectedMealId !== null);

  // ── The Add CTA for whichever view is open ──
  // The label and handler swap based on which list is showing:
  //   • Recipe view (All Recipes or a custom recipe list) → "Add Recipe",
  //     opens the three-tab recipe builder (targeted at the current
  //     list when one is selected).
  //   • Custom restaurant list / Wishlist → "Add Rating", opens the
  //     SearchPopup in 'add-to-list' mode (rated section + search).
  //   • Rated list → "Add Rating", opens the SearchPopup in 'rate-new'
  //     mode (search-only — your rated places are already on the page).
  //   • Trips → nothing; it isn't a list.
  // Computed as a value rather than pushed straight at the desktop header,
  // because phone's own header needs the same decision and can't read it
  // back out of usePageAddAction (that context only feeds the Sidebar).
  const pantryAddAction = useMemo<{ label: string; onClick: () => void } | null>(() => {
    if (showTrips) return null;
    if (showHomeCooking) {
      return { label: 'Add Recipe', onClick: () => openHomeMealModal() };
    }
    if (selectedList && selectedList.type === 'home-cooking') {
      return {
        label: 'Add Recipe',
        // Same three-tab builder as the cookbook — targetListId lands the
        // new recipe in this list too. (The basic AddRecipeModal is only
        // for editing a list's existing legacy entries.)
        onClick: () => openHomeMealModal(undefined, { targetListId: selectedList.id }),
      };
    }
    if (selectedList) {
      // Wishlist or custom restaurant list → SearchPopup with rated
      // section so the user can one-tap their already-rated places into
      // the list.
      return {
        label: 'Add Rating',
        onClick: () => { setSearchPopupMode('add-to-list'); setSearchPopupOpen(true); },
      };
    }
    return {
      label: 'Add Rating',
      onClick: () => { setSearchPopupMode('rate-new'); setSearchPopupOpen(true); },
    };
  }, [showTrips, showHomeCooking, selectedList, openHomeMealModal]);

  useEffect(() => {
    setPageAddAction(phoneMode ? null : pantryAddAction);
  }, [phoneMode, pantryAddAction, setPageAddAction]);

  // Reset the override when Pantry unmounts so other pages start clean.
  useEffect(() => {
    return () => { setPageAddAction(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which top-level desktop tab is the user currently on? Derived so any
  // path into a recipe-y view (cookbook, recipe sub-list) lights up the
  // Recipes tab; everything else (rated, wishlist, restaurant sub-list)
  // sits under Restaurants.
  const activePantrySection: 'restaurants' | 'recipes' = showHomeCooking
    ? 'recipes'
    : (selectedList && selectedList.type === 'home-cooking')
      ? 'recipes'
      : 'restaurants';

  // Tab clicks reset to that tab's default landing. Trips is its own
  // top-level mode — clicking either tab leaves it. Each handler also
  // updates the URL so the back button (e.g. from a restaurant detail
  // page) brings the user back to the same list, not All Rated.
  const goToRestaurantsTab = () => {
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList(null);
    if (location.pathname !== '/pantry' || location.search) navigate('/pantry');
  };
  const goToRecipesTab = () => {
    setSelectedList(null); setShowTrips(false);
    setShowHomeCooking(true);
    navigate('/pantry?view=home-cooking');
  };

  // Identity of the currently visible top-level view, used to label the
  // list switcher button. Now that the tab pill also persists when a
  // sub-list is open, derive from selectedList first so opening
  // Wishlist or "Best Pizza" updates the active tab's label/count
  // instead of stranding "All Rated" up there.
  const currentViewLabel = (() => {
    if (selectedShared) {
      return { emoji: selectedShared.emoji, name: selectedShared.name, count: sharedEntriesFor(selectedShared.id)?.length ?? 0 };
    }
    if (selectedList) {
      if (selectedList.id === '__wishlist__') {
        return { emoji: '🔖', name: 'Want to try', count: regularWishlist.length };
      }
      const isRecipeList = selectedList.type === 'home-cooking';
      const count = isRecipeList
        ? (selectedList.recipes?.length || 0)
        : selectedList.restaurantIds.length + (selectedList.wishlistIds?.length || 0);
      return { emoji: selectedList.emoji, name: selectedList.name, count };
    }
    if (showHomeCooking) return { emoji: '🍳', name: 'All Recipes', count: homeMeals.length };
    if (showTrips) return { emoji: '✈️', name: 'Trips', count: trips.length };
    return { emoji: '⭐', name: 'Your rankings', count: regularRatingsCount };
  })();

  // Restaurant + recipe lists split for the popover sections.
  const restaurantListsForSwitcher = useMemo(
    () => lists.filter((l) => l.type !== 'home-cooking'),
    [lists],
  );
  const recipeListsForSwitcher = useMemo(() => {
    // Pin the built-in "Want to Cook" and "Cooked" lists to the top, in
    // that order.
    const all = lists.filter((l) => l.type === 'home-cooking');
    const pinnedIds = [DEFAULT_WANT_TO_COOK_ID, DEFAULT_COOKED_ID];
    const pinned = pinnedIds
      .map((id) => all.find((l) => l.id === id))
      .filter((l): l is CustomList => !!l);
    const rest = all.filter((l) => !pinnedIds.includes(l.id));
    return [...pinned, ...rest];
  }, [lists]);

  // Helpers to drive the switcher's destinations through the existing
  // showHomeCooking / showTrips / selectedList state machine. Each one
  // also pushes the matching URL so a navigation away from /pantry
  // (e.g. clicking a restaurant or recipe) and back lands the user on
  // the same list — not All Rated.
  const switchToRated = () => {
    setListSwitcherOpen(false); setListDrawerOpen(false);
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList(null);
    if (location.pathname !== '/pantry' || location.search) navigate('/pantry');
  };
  const switchToWishlist = () => {
    setListSwitcherOpen(false); setListDrawerOpen(false);
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList({
      id: '__wishlist__', name: 'Want to try', emoji: '🔖',
      restaurantIds: [], wishlistIds: regularWishlist.map((w) => w.restaurantId),
      createdAt: 0,
    } as CustomList);
    navigate('/pantry?list=__wishlist__');
  };
  const switchToList = (list: CustomList) => {
    setListSwitcherOpen(false); setListDrawerOpen(false);
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList(list);
    navigate(`/pantry?list=${encodeURIComponent(list.id)}`);
  };
  const switchToSharedList = (list: SharedList) => {
    setListSwitcherOpen(false); setListDrawerOpen(false);
    setShowHomeCooking(false); setShowTrips(false);
    setSelectedList(null);
    setSelectedSharedId(list.id);
    navigate(`/pantry?shared=${encodeURIComponent(list.id)}`);
  };
  const switchToAllRecipes = () => {
    setListSwitcherOpen(false); setListDrawerOpen(false);
    setSelectedList(null); setShowTrips(false);
    setShowHomeCooking(true);
    navigate('/pantry?view=home-cooking');
  };
  const switchToTrips = () => {
    setListSwitcherOpen(false); setListDrawerOpen(false);
    setSelectedList(null); setShowHomeCooking(false);
    setShowTrips(true);
    navigate('/pantry?view=trips');
  };

  // ── Phone header + switcher drawer data ──────────────────────────────
  // Which list is on screen, as one id the chips and the drawer both
  // compare against. A cuisine isn't a list of its own — it's the tab's
  // default list with one cuisine filter on it — so that's what makes a
  // cuisine row read as the active one.
  const activeViewId = selectedShared
    ? `shared:${selectedShared.id}`
    : selectedList
    ? selectedList.id
    : showHomeCooking
      ? (recipeCuisineFilter.length === 1 ? cuisineViewId(recipeCuisineFilter[0]) : VIEW_COOKBOOK)
      : (cuisineFilter.length === 1 ? cuisineViewId(cuisineFilter[0]) : VIEW_RATED);

  // Cuisine breakdowns — the drawer's third section. Restaurants average
  // their ratings; recipes average their scores. Only cuisines with enough
  // entries to have a meaningful average are worth a row.
  const restaurantCuisineStats = useMemo(() => {
    const by = new Map<string, { count: number; sum: number }>();
    for (const r of ratings) {
      const c = (r.cuisine || '').trim();
      if (!c) continue;
      const e = by.get(c) || { count: 0, sum: 0 };
      e.count += 1; e.sum += r.score || 0;
      by.set(c, e);
    }
    return [...by.entries()]
      .filter(([, e]) => e.count >= 2)
      .map(([name, e]) => ({ name, count: e.count, avg: e.sum / e.count }))
      .sort((a, b) => b.count - a.count || b.avg - a.avg)
      .slice(0, 8);
  }, [ratings]);

  // Recipes are often logged without a score, so the average is taken over
  // the scored ones only and comes back null when there are none — a "0.0"
  // ring would read as "rated zero" rather than "not rated".
  const recipeCuisineStats = useMemo(() => {
    const by = new Map<string, { count: number; scored: number; sum: number }>();
    for (const m of homeMeals) {
      const c = (m.cuisine || '').trim();
      if (!c) continue;
      const e = by.get(c) || { count: 0, scored: 0, sum: 0 };
      e.count += 1;
      if (m.score > 0) { e.scored += 1; e.sum += m.score; }
      by.set(c, e);
    }
    return [...by.entries()]
      .filter(([, e]) => e.count >= 2)
      .map(([name, e]) => ({ name, count: e.count, avg: e.scored > 0 ? e.sum / e.scored : null }))
      .sort((a, b) => b.count - a.count || (b.avg ?? 0) - (a.avg ?? 0))
      .slice(0, 8);
  }, [homeMeals]);

  // A cuisine is the tab's default list with a cuisine filter applied —
  // which is what the old landing's cuisine rail did too. Picking the
  // default list itself therefore has to lift that filter back off, or
  // "Rankings" would quietly still be showing only Italian.
  const switchToRestaurantCuisine = (cuisine: string) => {
    setCuisineFilter([cuisine]);
    switchToRated();
  };
  const switchToRecipeCuisine = (cuisine: string) => {
    setRecipeCuisineFilter([cuisine]);
    switchToAllRecipes();
  };
  const switchToAllRated = () => { setCuisineFilter([]); switchToRated(); };
  const switchToWholeCookbook = () => { setRecipeCuisineFilter([]); switchToAllRecipes(); };

  const isRecipeSection = activePantrySection === 'recipes';

  // The header names what you're actually looking at, so a cuisine view
  // says the cuisine rather than leaving "Your rankings" over a list that
  // is visibly only Indian.
  const phoneViewLabel = (() => {
    if (selectedList) return currentViewLabel;
    const cuisines = isRecipeSection ? recipeCuisineFilter : cuisineFilter;
    if (cuisines.length !== 1) return currentViewLabel;
    const stats = (isRecipeSection ? recipeCuisineStats : restaurantCuisineStats)
      .find((c) => c.name === cuisines[0]);
    return { name: cuisines[0], count: stats?.count ?? 0 };
  })();

  const openNewListSheet = () => {
    setListDrawerOpen(false);
    setCreateSheetKind(isRecipeSection ? 'recipes' : 'restaurants');
    setCreateSheetOpen(true);
  };

  const drawerSections: DrawerSection[] = isRecipeSection
    ? [
        { label: 'Essentials', items: [
          { id: VIEW_COOKBOOK, name: 'All Recipes', meta: `${homeMeals.length} in your cookbook`, icon: <ChefHat size={17} />, onSelect: switchToWholeCookbook },
        ] },
        { label: 'Recipe lists', items: recipeListsForSwitcher.map((l) => ({
          id: l.id, name: l.name,
          meta: `${l.recipes?.length || 0} ${(l.recipes?.length || 0) === 1 ? 'recipe' : 'recipes'}`,
          icon: <span className="text-base leading-none">{l.emoji}</span>,
          onSelect: () => switchToList(l),
        })) },
        { label: 'By cuisine', items: recipeCuisineStats.map((c) => ({
          id: cuisineViewId(c.name), name: c.name,
          meta: `${c.count} ${c.count === 1 ? 'recipe' : 'recipes'}`,
          ...(c.avg !== null ? { score: c.avg } : { icon: <ChefHat size={17} /> }),
          onSelect: () => switchToRecipeCuisine(c.name),
        })) },
      ]
    : [
        { label: 'Essentials', items: [
          { id: VIEW_RATED, name: 'Your rankings', meta: `${regularRatingsCount} rated`, icon: <Star size={17} />, onSelect: switchToAllRated },
          { id: VIEW_WISHLIST, name: 'Want to try', meta: `${regularWishlist.length} saved for later`, icon: <Bookmark size={17} />, onSelect: switchToWishlist },
        ] },
        { label: 'Collections', items: restaurantListsForSwitcher.map((l) => ({
          id: l.id, name: l.name,
          meta: (() => {
            const n = l.restaurantIds.length + (l.wishlistIds?.length || 0);
            return `${n} ${n === 1 ? 'place' : 'places'}`;
          })(),
          icon: <span className="text-base leading-none">{l.emoji}</span>,
          onSelect: () => switchToList(l),
        })) },
        { label: 'Shared with friends', items: [
          ...sharedLists.map((l) => ({
            id: `shared:${l.id}`, name: l.name,
            meta: `${l.memberIds.length} ${l.memberIds.length === 1 ? 'person' : 'people'} · ${l.ratingMode === 'group' ? 'group score' : 'individual scores'}`,
            icon: <span className="text-base leading-none">{l.emoji}</span>,
            onSelect: () => switchToSharedList(l),
          })),
          { id: 'shared:new', name: 'New shared list', meta: 'Keep a list with friends', icon: <Users size={17} />, onSelect: () => { setListDrawerOpen(false); openCreateShared(); } },
        ] },
        { label: 'By cuisine', items: restaurantCuisineStats.map((c) => ({
          id: cuisineViewId(c.name), name: c.name,
          meta: `${c.count} ${c.count === 1 ? 'place' : 'places'} rated`,
          score: c.avg,
          onSelect: () => switchToRestaurantCuisine(c.name),
        })) },
      ];

  // Row 1's ⋯ — whatever the view on screen can actually do.
  const pantryMoreItems = (() => {
    if (selectedShared) return [];
    if (selectedList) {
      const protectedList = selectedList.id === VIEW_WISHLIST
        || selectedList.id === DEFAULT_WANT_TO_COOK_ID
        || selectedList.id === DEFAULT_COOKED_ID;
      const items: { label: string; icon?: React.ReactNode; onClick: () => void; destructive?: boolean }[] = [];
      // Restaurant lists can be plotted; recipe lists have nothing to plot.
      if (selectedList.type !== 'home-cooking') {
        items.push({
          label: 'View on map',
          icon: <MapPin size={14} />,
          onClick: () => navigate('/map', { state: { listView: { id: selectedList.id } } }),
        });
      }
      if (!protectedList) {
        items.push({
          label: 'Delete list',
          icon: <Trash2 size={14} />,
          destructive: true,
          onClick: () => setConfirmDeletePageList(true),
        });
      }
      return items;
    }
    if (showHomeCooking) return [];
    return [
      { label: 'Export CSV', icon: <Download size={14} />, onClick: () => handleExport('csv') },
      { label: 'Export JSON', icon: <Download size={14} />, onClick: () => handleExport('json') },
      { label: 'Reorder ratings', icon: <ArrowUpDown size={14} />, onClick: () => navigate('/reorder') },
    ];
  })();

  return (
    <div className="library-page pb-32 type-archivo">
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
      {/* Desktop-only top bar (Restaurants/Recipes tab switcher + page ⋯).
          On phone every view below renders its own safe-area header
          (back · Add · ⋯), so this would just stack an empty, status-bar-
          overlapping row on top of them — hence phone is excluded. */}
      {!hideTopBar && !phoneMode && (
        <div className="flex items-center justify-between gap-3 px-3 pt-4 pb-5">
          {!phoneMode && !showTrips ? (
            <div className="relative" ref={listSwitcherRef}>
              <div className="inline-flex bg-on-surface/[0.06] rounded-full p-1">
                <CombinedTabButton
                  isActive={activePantrySection === 'restaurants'}
                  inactiveLabel="Restaurants"
                  activeEmoji={currentViewLabel.emoji}
                  activeName={currentViewLabel.name}
                  activeCount={currentViewLabel.count}
                  dropdownOpen={listSwitcherOpen}
                  onClick={() => {
                    if (activePantrySection === 'restaurants') {
                      setListSwitcherOpen((o) => !o);
                    } else {
                      goToRestaurantsTab();
                      setListSwitcherOpen(false);
                    }
                  }}
                />
                <CombinedTabButton
                  isActive={activePantrySection === 'recipes'}
                  inactiveLabel="Recipes"
                  activeEmoji={currentViewLabel.emoji}
                  activeName={currentViewLabel.name}
                  activeCount={currentViewLabel.count}
                  dropdownOpen={listSwitcherOpen}
                  onClick={() => {
                    if (activePantrySection === 'recipes') {
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
                    className="absolute left-0 top-full origin-top-left mt-2 w-72 max-h-[70vh] overflow-y-auto bg-surface rounded-2xl shadow-xl border border-on-surface/[0.08] z-50 py-2"
                  >
                    {activePantrySection === 'restaurants' ? (
                      <>
                        <SwitcherRow
                          icon={<span className="text-base leading-none">⭐</span>}
                          label="Your rankings"
                          count={regularRatingsCount}
                          active={!showHomeCooking && !showTrips && !selectedList}
                          onClick={switchToRated}
                        />
                        <SwitcherRow
                          icon={<Bookmark size={14} className="text-primary fill-primary" />}
                          label="Want to try"
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
                        {sharedLists.map((l) => (
                          <SwitcherRow
                            key={`shared:${l.id}`}
                            icon={<span className="text-base leading-none">{l.emoji}</span>}
                            label={l.name}
                            count={sharedEntriesFor(l.id)?.length ?? l.memberIds.length}
                            active={selectedShared?.id === l.id}
                            onClick={() => switchToSharedList(l)}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => { setListSwitcherOpen(false); openCreateShared(); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] font-semibold text-primary hover:bg-primary/[0.06] transition-colors"
                        >
                          <Users size={14} />
                          <span>New shared list</span>
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
                  className="absolute right-0 top-full origin-top-right mt-1 w-48 bg-white rounded-xl shadow-xl border border-on-surface/8 overflow-hidden z-50"
                >
                  <button onClick={() => handleExport('csv')}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/3 transition-colors text-left">
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
        {/* Phone's page chrome — segment · title · chip rail. It sits above
            the whole view switch rather than inside one arm of it, because
            every arm below is a list and they all navigate through it. */}
        {showPhoneHeader && (
          <PantryPhoneHeader
            activeSection={activePantrySection}
            onSelectRestaurants={goToRestaurantsTab}
            onSelectRecipes={goToRecipesTab}
            viewLabel={phoneViewLabel}
            drawerOpen={listDrawerOpen}
            onOpenDrawer={() => setListDrawerOpen(true)}
            onDecideTogether={isRecipeSection ? undefined : () => navigate('/decide')}
            onOpenRecommendations={isRecipeSection ? undefined : () => navigate('/pantry/recommended')}
            /* The recipes side of the same slot: "what should I cook
               tonight?" → the AI creator, landed on the brainstorm. */
            onOpenIdeas={isRecipeSection ? () => openHomeMealModal(undefined, { initialMethod: 'ai', initialAiView: 'ideas' }) : undefined}
            searchOpen={pantrySearchOpen}
            onToggleSearch={() => {
              // Opening from the condensed cluster means the field itself is
              // scrolled off — bring it back into view. Kept out of the state
              // updater, which has to stay pure.
              if (!pantrySearchOpen) window.scrollTo({ top: 0, behavior: 'smooth' });
              setPantrySearchOpen((v) => !v);
            }}
            // Restaurants drop the Add button: rating a new place already
            // has its own front doors (the Home create button and search),
            // and the row reads cleaner without it. Recipes keep theirs —
            // the cookbook is where you'd actually add one from.
            addAction={isRecipeSection ? pantryAddAction : null}
            moreMenu={<ListMoreMenu glass glassId="pantry-page-more" items={pantryMoreItems} />}
            headerRef={listFade.headerRef as React.Ref<HTMLDivElement>}
            headerStyle={listFade.headerStyle as React.CSSProperties}
            condensedStyle={listFade.condensedStyle as React.CSSProperties}
          />
        )}

        {selectedShared ? (
          <SharedListView
            list={selectedShared}
            hidePhoneHeader={showPhoneHeader}
            onBack={goBack}
            onGone={() => navigate('/pantry', { replace: true })}
          />
        ) : currentList ? (
          <ListDetailView
            list={currentList}
            viewMode={effectiveViewMode}
            onViewModeChange={setViewMode}
            onBack={goBack}
            hidePhoneHeader={showPhoneHeader}
            searchOpen={pantrySearchOpen}
            confirmDelete={showPhoneHeader ? confirmDeletePageList : undefined}
            onConfirmDeleteChange={showPhoneHeader ? setConfirmDeletePageList : undefined}
          />
        ) : showHomeCooking ? (
          <HomeCookingTab
            meals={homeMeals}
            onUpdateMeal={updateHomeMeal}
            onDeleteMeal={deleteHomeMeal}
            onOpenModal={openHomeMealModal}
            onBack={() => { setHomeCookingSelectedMealId(null); goBack(); }}
            selectedMealId={homeCookingSelectedMealId}
            onSelectMeal={setHomeCookingSelectedMealId}
            // The page-level Restaurants/Recipes chrome already owns the
            // title + navigation on both platforms — drop the local header
            // so we don't render two layers of it.
            hideHeader={homeCookingSelectedMealId === null}
            searchOpen={pantrySearchOpen}
            cuisineFilter={recipeCuisineFilter}
            onCuisineFilterChange={setRecipeCuisineFilter}
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
            openAddRestaurantModal={openAddRestaurantModal}
            cacheRestaurantMeta={cacheRestaurantMeta}
            ratings={ratings}
            onBack={goBack}
            autoCreate={createTripFromList}
            onAutoCreateHandled={() => setCreateTripFromList(false)}
          />
        ) : (
          <>
            {/* ── Page chrome ──
                Phone gets a single top row: Back · Add Rating · ⋯ menu,
                all aligned to the iOS safe-area top so the cellular /
                Dynamic Island chrome doesn't overlap. Desktop folds
                everything into a single editorial toolbar below a thin
                divider line:
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
                {/* The page header above owns the segment, the title and
                    the scroll-collapse hand-off now — this view keeps what's
                    specific to the rated list: its search field (folded
                    behind the header's search toggle) and its filter bar
                    (always visible, same as before the header existed). */}
                <Collapse open={pantrySearchOpen}>
                <div className="pb-4">
                  <SearchField
                    glassId="list-search"
                    value={mainSearchQuery}
                    onChange={setMainSearchQuery}
                    placeholder="Name, cuisine, city"
                    aria-label="Search your rated places"
                  />
                </div>
                </Collapse>

                <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {/* Every chip opens the SAME page its filter owns inside
                      Filters. They used to drop four different little
                      dropdowns, so choosing a city from the bar and
                      choosing one from Filters were two different controls
                      over the same value — different type, different
                      widths, one with counts and one without. City and
                      Cuisine push straight to their page; Price and Sort
                      live on the Filters page itself, so they open that. */}
                  <FilterPill onClick={() => { openFiltersOn(null); closeAllDropdowns(); }}
                    icon={<SlidersHorizontal size={12} />} label="Filters" active={activeFilterCount > 0}
                    badge={activeFilterCount > 0 ? activeFilterCount : undefined} />
                  <FilterPill onClick={() => openFiltersOn({ id: 'city', title: 'City / Location' })}
                    icon={<MapPin size={11} />}
                    label={cityFilter.length > 0 ? `City (${cityFilter.length})` : 'City'}
                    active={cityFilter.length > 0}
                    onClear={cityFilter.length > 0 ? () => setCityFilter([]) : undefined} />
                  <FilterPill onClick={() => openFiltersOn({ id: 'cuisine', title: 'Cuisine' })}
                    label={cuisineFilter.length > 0 ? `Cuisine (${cuisineFilter.length})` : 'Cuisine'}
                    active={cuisineFilter.length > 0}
                    onClear={cuisineFilter.length > 0 ? () => setCuisineFilter([]) : undefined} />
                  <FilterPill onClick={() => openFiltersOn(null)}
                    label={priceFilter || 'Price'} active={!!priceFilter}
                    onClear={priceFilter ? () => setPriceFilter(null) : undefined} />
                  <FilterPill onClick={() => openFiltersOn(null)}
                    icon={<ArrowUpDown size={11} />}
                    label={isNonDefaultSort ? sortLabels[sortBy] : 'Sort'}
                    active={isNonDefaultSort}
                    onClear={isNonDefaultSort ? () => setSortBy('highest') : undefined} />
                  {hasActiveFilters && (
                    <button onClick={handleResetFilters}
                      className="flex items-center gap-1 px-3 h-8 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0">
                      <X size={10} /><span>Clear</span>
                    </button>
                  )}
                </div>

                {!scoresUnlocked && regularRatingsCount > 0 && (
                  <div className="mb-3 flex items-center gap-3.5 rounded-2xl bg-primary/[0.05] border border-primary/15 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold text-on-surface">
                        {regularRatingsCount} of {SCORE_UNLOCK_THRESHOLD} rated
                      </p>
                      <p className="text-[11px] text-on-surface/50 mt-0.5 leading-snug">
                        Scores unlock at {SCORE_UNLOCK_THRESHOLD} — until then your list shows sentiment and order.
                      </p>
                      <div className="mt-2 h-1.5 rounded-full bg-on-surface/[0.08] overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (regularRatingsCount / SCORE_UNLOCK_THRESHOLD) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mb-5 pb-4 border-b border-on-surface/[0.06]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                  {/* Primary action: search this list — inline filter input */}
                  <ToolbarSearchInput value={mainSearchQuery} onChange={setMainSearchQuery} />

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
                      label: michelinFilter.length > 0 ? `Michelin (${michelinFilter.length})` : 'Michelin',
                      active: michelinFilter.length > 0,
                      onClear: michelinFilter.length > 0 ? () => setMichelinFilter([]) : undefined,
                    }}
                    popoverWidth="w-[260px]"
                  >
                    {() => (
                      <div className="p-1">
                        <MichelinDistinctionFilter selected={michelinFilter} onToggle={toggleMichelinFilter} />
                      </div>
                    )}
                  </AnchoredPill>
                  <AnchoredPill
                    pill={{
                      icon: <ArrowUpDown size={11} />,
                      label: isNonDefaultSort ? sortLabels[sortBy] : 'Sort',
                      active: isNonDefaultSort,
                      onClear: isNonDefaultSort ? () => setSortBy('highest') : undefined,
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

                  {/* Right side: recommendations + live result count + avg
                      score + view toggle */}
                  <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setRecsOpen(true)}
                      className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-primary text-on-primary text-[12px] font-bold hover:bg-primary/90 transition-colors flex-shrink-0"
                    >
                      <Sparkles size={14} /><span>For you</span>
                    </button>
                    {regularRatingsCount > 0 && (
                      <p className="text-[12px] text-on-surface/50 whitespace-nowrap tabular-nums">
                        <span className="font-bold text-on-surface">{filteredRatings.length}</span>
                        {filteredRatings.length !== regularRatingsCount && (
                          <span className="text-on-surface/35"> / {regularRatingsCount}</span>
                        )}
                        {filteredRatings.length > 0 && scoresUnlocked && (
                          <>
                            <span className="text-on-surface/25 mx-1.5">·</span>
                            <span>Avg <span className="font-bold text-on-surface">{(filteredRatings.reduce((sum, r) => sum + r.score, 0) / filteredRatings.length).toFixed(twoDecimalScores ? 2 : 1)}</span></span>
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
              // A CTA, not a caption: this used to point at a "+" button
              // that no longer lives on this page (it moved to the Recipes
              // side — see PantryPhoneHeader's addAction), so "use the +
              // button" told a first-time visitor to tap something that
              // wasn't there. The action is finding a place you've been,
              // which is what Search is for — deliberately NOT the
              // recommendations browser, which is locked until
              // RECS_MIN_RATINGS anyway and can't say anything personal
              // about someone who has rated nothing.
              <div className="text-center py-16 px-6">
                <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Star size={24} strokeWidth={2} />
                </div>
                <p className="mt-4 font-serif text-[16px] font-bold text-on-surface">Add your first rating</p>
                <p className="mt-1.5 text-[13px] text-on-surface/45 max-w-[270px] mx-auto">
                  Search for a place you’ve been — a few quick head-to-head picks turn it into a ranked list.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/search', { state: { openTakeover: true } })}
                  className="mt-5 inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-primary text-on-primary text-[13.5px] font-bold active:opacity-80 transition-opacity"
                >
                  <Search size={14} strokeWidth={2.4} />
                  Find a restaurant
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Custom-order reordering on phones goes through the
                    dedicated /reorder page — the inline grip drag can't work
                    with touch pointer capture (see the grip comment below). */}
                {sortBy === 'custom' && phoneMode && filteredRatings.length > 1 && (
                  <button
                    type="button"
                    onClick={() => navigate('/reorder')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-on-surface/10 bg-on-surface/[0.03] text-xs font-semibold text-on-surface/60 hover:bg-on-surface/[0.06] transition-colors"
                  >
                    <ArrowUpDown size={14} />
                    Reorder ratings
                  </button>
                )}
                {/* Rated section */}
                {filteredRatings.length > 0 ? (
                  <div className={(sortBy !== 'custom' && effectiveViewMode === 'grid') ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-stretch" : phoneMode ? "divide-y divide-on-surface/[0.06]" : "space-y-2.5"}>
                    {filteredRatings.map((r, idx) => {
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
                          onEditNotes={() => openAddRestaurantModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address }, 'notes')}
                          onRemove={() => removeRating(r.restaurantId)}
                          showMichelin={michelinFilter.length > 0}
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
                              {/* Inline grip is DESKTOP-ONLY: it relies on
                                  pointerenter firing on sibling rows mid-drag,
                                  and touch pointers get implicit pointer
                                  capture — pointerenter never fires, so the
                                  drag did nothing on phones. Phone mode shows
                                  a "Reorder ratings" button above the list
                                  that opens /reorder (real touch drag). */}
                              {!phoneMode && (
                                <button
                                  className="hit-44 touch-none shrink-0 w-7 h-10 flex items-center justify-center cursor-grab active:cursor-grabbing text-on-surface/25 hover:text-on-surface/50 transition-colors"
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
                              )}
                            </>
                          )}
                          <div className="flex-1 min-w-0">
                            <RestaurantRow
                              restaurantId={r.restaurantId}
                              rank={isCustom ? undefined : idx + 1}
                              name={r.name}
                              cuisine={r.cuisine}
                              price={r.price}
                              address={r.address}
                              score={r.score}
                              onEdit={() => openAddRestaurantModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                              onRemove={() => removeRating(r.restaurantId)}
                              showMichelin={michelinFilter.length > 0}
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
        hoursFilter={hoursFilter}
        onHoursFilter={setHoursFilter}
        michelinFilter={michelinFilter}
        onMichelinToggle={toggleMichelinFilter}
        allCities={allCities}
        allCuisines={allCuisines}
        counts={rootFilterCounts}
        initialPage={filtersInitialPage}
        onReset={handleResetFilters}
      />

      {/* Spotlight-style search popup — opened by the desktop header's
          Add Rating button (PageAddAction override above). In
          add-to-list mode it surfaces your rated restaurants up top
          with checkboxes so you can batch-add several at once via the
          Done button; search results stay single-pick (each one drops
          into the rating modal). */}
      <RecommendationsBrowser
        open={recsOpen}
        onClose={() => setRecsOpen(false)}
        isMobile={phoneMode}
      />

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
          ? ratings
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
            cuisine: getCuisineLabel(place),
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

      {/* Your lists — the phone header's title and hamburger both open it. */}
      {showPhoneHeader && (
        <PantryListSwitcherDrawer
          open={listDrawerOpen}
          onClose={() => setListDrawerOpen(false)}
          activeId={activeViewId}
          sections={drawerSections}
          onNewList={openNewListSheet}
          newListLabel={isRecipeSection ? 'New recipe list' : 'New restaurant list'}
        />
      )}

      <CreateSharedListSheet
        open={createSharedOpen}
        onClose={() => setCreateSharedOpen(false)}
        onCreated={(l) => switchToSharedList(l)}
      />

      {/* Create list bottom sheet */}
      <CreateListSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreate={(name, emoji, type) => {
          createList(name, emoji, type);
          // Land the user on the matching tab so the new list is visible.
          if (type === 'home-cooking') goToRecipesTab(); else goToRestaurantsTab();
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
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => { setCityDropdownOpen(false); setCityPickerSearch(''); }} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn("fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
                phoneMode ? "max-h-[92vh]" : "max-h-[70vh]")}
            >
              {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Select City</h3>
                <button onClick={() => { setCityDropdownOpen(false); setCityPickerSearch(''); }} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="px-5 pt-3 pb-2 flex-shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                  <input type="text" placeholder="Search cities..."
                    className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={cityPickerSearch}
                    onChange={(e) => setCityPickerSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-safe-5">
                {allCities.filter((c) => {
                  const q = cityPickerSearch.trim().toLowerCase();
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
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={() => { setCuisineDropdownOpen(false); setCuisinePickerSearch(''); }} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className={cn("fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
                phoneMode ? "max-h-[92vh]" : "max-h-[70vh]")}
            >
              {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
              <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="font-serif font-bold text-lg">Select Cuisine</h3>
                <button onClick={() => { setCuisineDropdownOpen(false); setCuisinePickerSearch(''); }} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              <div className="px-5 pt-3 pb-2 flex-shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                  <input type="text" placeholder="Search cuisines..."
                    className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={cuisinePickerSearch}
                    onChange={(e) => setCuisinePickerSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-safe-5">
                {allCuisines.filter((c) => {
                  const q = cuisinePickerSearch.trim().toLowerCase();
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
