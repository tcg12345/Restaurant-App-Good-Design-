/**
 * GuideCreatorSheet — the guide creation / editing flow, redesigned as a
 * four-step editorial wizard (same warm, serif-forward language on phone
 * and desktop; desktop is a centered modal, phone a full-screen sheet):
 *
 *   1. basics   — type (Restaurants / Recipes), serif title, tag chips,
 *                 collapsed "More details" (subtitle · city · intro).
 *   2. add      — segmented sources (Search / Your ratings / Your lists,
 *                 or My recipes / Recipe lists), one-tap +/✓ rows,
 *                 lists with "Add all".
 *   3. arrange  — optional cover slot, numbered reorderable entry cards
 *                 with inline detail editing, photos toggle.
 *   4. publish  — dark preview card, Public/Private, entry summary,
 *                 publish (or save-changes) with a success overlay.
 *
 * The data spine is unchanged from the previous wizard: entry assembly
 * from ratings / places / recipes, saveGuide persistence with a stable
 * upfront id, and the Live Editor round-trip.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ArrowRight, Plus, Trash2, ChefHat, Check, ImagePlus, Loader2, Globe, Lock, Search, Wand2, MapPin, Pencil, ChevronRight, ChevronUp } from 'lucide-react';
import { searchCities, type HomeLocation } from './HomeLocationBar';
import { cn } from '../lib/utils';
import { processPhoto } from '../lib/images';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type CustomList, type RestaurantRating, type Recipe as ListRecipe } from '../contexts/ListsContext';
import { useRecipes, type Recipe as DbRecipe } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { saveGuide, type GuideEntry, type GuideType, type GuideVisibility, type Guide, type GuideTheme } from '../lib/supabase-guides';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import { GuideLiveEditor } from './guide/GuideLiveEditor';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import './GuideCreatorSheet.css';
import './guide/GuideRender.css';
import './guide/GuideLiveEditor.css';

type Step = 'basics' | 'add' | 'arrange' | 'publish';
type SourceMode = 'search' | 'rated' | 'list' | 'recipes-my' | 'recipes-list';

interface GuideCreatorSheetProps {
  open: boolean;
  onClose: () => void;
  initialGuide?: Guide | null;
  /** Light prefill for a brand-new guide (Create page hand-off): applied
   *  on open when there is no initialGuide, wizard still starts on step 1. */
  seed?: { type: GuideType; title: string } | null;
}

const STEPS_ORDER: Step[] = ['basics', 'add', 'arrange', 'publish'];
const STEP_TITLES = (isRecipes: boolean): Record<Step, string> => ({
  basics: 'The basics',
  add: isRecipes ? 'Add recipes' : 'Add places',
  arrange: 'Arrange',
  publish: 'Review & publish',
});

const TAG_SUGGESTIONS = [
  // Occasions
  'Date Night', 'First Date', 'Anniversary', 'Birthday', 'Special Occasion',
  'Holiday', 'Christmas', 'Thanksgiving', "Valentine's Day", "New Year's Eve",
  'Easter', "Mother's Day", "Father's Day", 'Brunch', 'Weekend', 'Weeknight',
  'Lunch', 'Quick Lunch', 'Late Night', 'Pre-Theater', 'Post-Theater',
  'Pre-Game', 'After Work', 'Happy Hour', 'Sunday Dinner', 'Game Day',
  'Movie Night', 'Casual Hangout', 'Bachelor', 'Bachelorette', 'Baby Shower',
  'Engagement', 'Wedding', 'Reunion', 'Going Away', 'Welcome Back',

  // Vibe / ambiance
  'Cozy', 'Romantic', 'Intimate', 'Quiet', 'Lively', 'Bustling', 'Energetic',
  'Trendy', 'Hipster', 'Classic', 'Old-School', 'Modern', 'Industrial',
  'Rustic', 'Chic', 'Elegant', 'Upscale', 'Casual', 'No-Frills', 'Divey',
  'Speakeasy', 'Hole-in-the-Wall', 'Hidden Gem', 'Iconic', 'Institution',
  'Buzzy', 'Up-and-Coming', 'Neighborhood Spot', 'Local Favorite',
  'Tourist-Free', 'Off-the-Beaten-Path', 'Destination', 'Worth the Trip',
  'Photogenic', 'Instagrammable', 'Beautiful', 'Stunning', 'Cool Decor',
  'Mural', 'Open Kitchen', "Chef's Counter", 'Counter Dining',

  // Seating / outdoor
  'Outdoor Seating', 'Patio', 'Garden', 'Rooftop', 'Terrace', 'Beachfront',
  'Waterfront', 'Skyline View', 'City View', 'Park View', 'Window Seat',
  'Booth', 'Bar Seating', 'Communal Table', 'Private Dining', 'Large Tables',
  'Sidewalk Seating', 'Heated Patio', 'Fireplace', 'Live Plants',
  'Sunset View', 'Mountain View', 'Beach View',

  // Cuisines
  'American', 'New American', 'Southern', 'Soul Food', 'Cajun', 'Creole',
  'Tex-Mex', 'Mexican', 'Oaxacan', 'Yucatecan', 'Peruvian', 'Brazilian',
  'Argentinian', 'Colombian', 'Venezuelan', 'Cuban', 'Caribbean', 'Jamaican',
  'Puerto Rican', 'Dominican', 'Italian', 'Northern Italian', 'Sicilian',
  'Tuscan', 'Roman', 'French', 'Provençal', 'Alsatian', 'Spanish', 'Basque',
  'Catalan', 'Portuguese', 'Greek', 'Turkish', 'Middle Eastern', 'Lebanese',
  'Syrian', 'Israeli', 'Moroccan', 'Tunisian', 'Egyptian', 'Ethiopian',
  'Eritrean', 'Persian', 'Afghan', 'Indian', 'North Indian', 'South Indian',
  'Goan', 'Pakistani', 'Sri Lankan', 'Bangladeshi', 'Nepalese', 'Tibetan',
  'Thai', 'Vietnamese', 'Cambodian', 'Laotian', 'Burmese', 'Malaysian',
  'Singaporean', 'Indonesian', 'Filipino', 'Chinese', 'Cantonese',
  'Szechuan', 'Hunan', 'Shanghainese', 'Taiwanese', 'Dim Sum', 'Japanese',
  'Sushi', 'Omakase', 'Izakaya', 'Ramen', 'Soba', 'Udon', 'Yakitori',
  'Tempura', 'Tonkatsu', 'Korean', 'Korean BBQ', 'Bibimbap', 'Russian',
  'Ukrainian', 'Polish', 'Hungarian', 'German', 'Austrian', 'Belgian',
  'Dutch', 'Scandinavian', 'Swedish', 'Danish', 'Norwegian', 'Icelandic',
  'British', 'Irish', 'Mediterranean', 'Eastern European', 'Hawaiian',
  'Pacific Rim', 'Fusion', 'Pan-Asian', 'Pan-Latin',

  // Food type
  'Pizza', 'Neapolitan', 'Detroit-Style', 'Sicilian Pizza', 'Wood-Fired',
  'Coal-Fired', 'Pizza by the Slice', 'Burger', 'Smash Burger', 'Sandwich',
  'Sub', 'Wrap', 'Banh Mi', 'Hot Dog', 'Salad', 'Bowl', 'Grain Bowl',
  'Pasta', 'Handmade Pasta', 'Noodles', 'Dumplings', 'Bao', 'Tacos',
  'Birria', 'Burrito', 'Quesadilla', 'Curry', 'Stir-Fry', 'Steak',
  'Steakhouse', 'Chophouse', 'Seafood', 'Raw Bar', 'Oysters', 'Lobster',
  'Crab', 'Shrimp', 'BBQ', 'Texas BBQ', 'Carolina BBQ', 'Brisket',
  'Ribs', 'Wings', 'Fried Chicken', 'Roast Chicken', 'Fish & Chips',
  'Bagels', 'Donuts', 'Pancakes', 'Waffles', 'French Toast', 'Eggs',
  'Avocado Toast', 'Coffee', 'Espresso', 'Pour Over', 'Matcha', 'Tea',
  'Boba', 'Smoothies', 'Juice', 'Ice Cream', 'Gelato', 'Sorbet', 'Pastries',
  'Croissants', 'Cakes', 'Cupcakes', 'Cookies', 'Bread', 'Sourdough',
  'Hot Pot', 'Shabu Shabu', 'Fondue', 'Charcuterie', 'Cheese Plate',

  // Drinks
  'Cocktails', 'Craft Cocktails', 'Classic Cocktails', 'Mocktails',
  'Wine Bar', 'Natural Wine', 'Orange Wine', 'Champagne', 'Bubbles',
  'Beer', 'Craft Beer', 'IPA', 'Lager', 'Pilsner', 'Sake', 'Whiskey',
  'Bourbon', 'Scotch', 'Rye', 'Mezcal', 'Tequila', 'Gin', 'Vodka', 'Rum',
  'Spritz', 'Negroni', 'Martini', 'Margarita', 'Manhattan', 'Old Fashioned',
  'Hot Chocolate', 'Iced Coffee', 'Cold Brew', 'Latte', 'Cappuccino',
  'Cortado', 'Flat White',

  // Diet
  'Vegan', 'Vegetarian', 'Plant-Based', 'Gluten-Free', 'Dairy-Free',
  'Nut-Free', 'Egg-Free', 'Soy-Free', 'Kosher', 'Halal', 'Pescatarian',
  'Flexitarian', 'Keto', 'Low-Carb', 'Paleo', 'Whole30', 'Mediterranean Diet',
  'Low-Sodium', 'Sugar-Free', 'Allergy-Friendly', 'Macro-Friendly', 'High-Protein',

  // Meal / format
  'Breakfast', 'All-Day Breakfast', 'Dinner', 'Dessert', 'Snack',
  'Appetizer', 'Tasting Menu', 'Prix Fixe', 'A La Carte', 'Buffet',
  'Family Style', 'Small Plates', 'Tapas', 'Shared Plates', 'Set Menu',
  'Wine Pairing',

  // Features / amenities
  'Dog-Friendly', 'Kid-Friendly', 'Family-Friendly', 'Stroller-Friendly',
  'Wheelchair-Accessible', 'Takeout', 'Delivery', 'Reservations', 'Walk-Ins',
  'BYOB', 'Corkage', 'Counter Service', 'Table Service', 'Self-Service',
  'Quick Service', 'Fine Dining', 'Casual Dining', 'Food Truck', 'Pop-Up',
  'Live Music', 'Live Jazz', 'DJ', 'Dancing', 'Karaoke', 'Trivia',
  'Open Mic', 'Sports On TV', 'Big Screen', 'Free Wifi', 'Laptop-Friendly',
  'Pet-Friendly Patio', 'Late-Night Kitchen', '24 Hours',

  // Price / value
  'Cheap Eats', 'Budget-Friendly', 'Affordable', 'Mid-Range', 'Pricey',
  'Splurge', 'Worth It', 'Hidden Value', 'Lunch Specials',

  // Quality / reputation
  'Michelin', 'Michelin Star', 'Michelin Bib', 'James Beard',
  'Award-Winning', 'Critically Acclaimed', "Critic's Pick", 'Legendary',
  'Just Opened', 'New', 'Trending', 'Must-Try', 'Bucket List',
  'Best in Class', 'Underrated', 'Overhyped',

  // Service
  'Friendly Service', 'Attentive Service', 'Knowledgeable Staff',
  'Sommelier', 'Tableside Service', 'Personalized',

  // Recipe / cooking
  'Quick', 'Easy', 'Make-Ahead', 'Meal Prep', 'One-Pot', 'One-Pan',
  'Sheet Pan', 'Dutch Oven', 'Slow Cooker', 'Instant Pot', 'Pressure Cooker',
  'Air Fryer', 'Grill', 'Stovetop', 'Oven-Roasted', 'No-Cook', 'No-Bake',
  'Microwave', 'Smoker', 'Sous Vide', '15-Min Meal', '30-Min Meal',
  'Under An Hour', 'Beginner', 'Intermediate', 'Advanced', 'Project Recipe',
  'Impressive', 'Crowd-Pleaser', 'Comfort Food', 'Healthy', 'Light',
  'Hearty', 'Spicy', 'Sweet', 'Savory', 'Tangy', 'Smoky', 'Fresh',
  'Bright', 'Bold', 'Mild', 'Kid-Approved', 'Picky-Eater Approved',
  'Big Batch', 'Freezer-Friendly', 'Pantry Staples', 'Leftovers-Friendly',
  'Bulk Cooking', 'Seasonal', 'Fall', 'Winter', 'Spring', 'Summer',
  'Lunar New Year', 'Diwali', 'Ramadan', 'Hanukkah',
];

const DEFAULT_TAG_SUGGESTIONS = [
  'Date Night', 'Brunch', 'Quick', 'Cozy', 'Cocktails', 'Vegan', 'Family', 'Weeknight',
];

const newEntryId = () => `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Compress a File to a base64 JPEG (max 1200px, 0.7 quality). */
/* ── Small shared pieces ─────────────────────────────────────────── */

/** Uppercase micro-label above a field. */
const FieldKicker: React.FC<{ children: React.ReactNode; optional?: boolean }> = ({ children, optional }) => (
  <div className="gcx-kicker">
    {children}
    {optional && <span className="gcx-kicker-opt"> · optional</span>}
  </div>
);

/** Local-state comma-separated input — commits on blur so typing ", "
 *  isn't eaten by re-splitting on every keystroke. */
const DishesInput: React.FC<{
  value: string[];
  placeholder?: string;
  onCommit: (next: string[]) => void;
}> = ({ value, placeholder, onCommit }) => {
  const joinedExternal = (value || []).join(', ');
  const [draft, setDraft] = useState(joinedExternal);
  const lastSeen = useRef(joinedExternal);
  useEffect(() => {
    if (joinedExternal !== lastSeen.current) {
      setDraft(joinedExternal);
      lastSeen.current = joinedExternal;
    }
  }, [joinedExternal]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.split(',').map((s) => s.trim()).filter(Boolean);
        lastSeen.current = next.join(', ');
        onCommit(next);
      }}
      placeholder={placeholder}
      className="gcx-line-input"
    />
  );
};

/** City field with Mapbox suggestions, styled as an underline input. */
const GuideCityField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [suggestions, setSuggestions] = useState<Array<HomeLocation & { cityName: string }>>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    const q = value.trim();
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      const res = await searchCities(q);
      setSuggestions(res);
      setOpen(res.length > 0);
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const pick = (s: HomeLocation & { cityName: string }) => {
    skipNext.current = true;
    onChange(s.cityName);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="gcx-city-wrap">
      <input
        className="gcx-line-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="New York"
        maxLength={80}
        autoCapitalize="words"
        autoCorrect="off"
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 150); }}
      />
      {open && suggestions.length > 0 && (
        <div className="gcx-city-pop">
          {suggestions.map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="gcx-city-opt"
            >
              <MapPin size={14} />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Step 1: The basics ──────────────────────────────────────────── */

const StepBasics: React.FC<{
  type: GuideType;
  onType: (t: GuideType) => void;
  title: string;
  onTitle: (v: string) => void;
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  moreOpen: boolean;
  onToggleMore: () => void;
  subtitle: string;
  onSubtitle: (v: string) => void;
  city: string;
  onCity: (v: string) => void;
  intro: string;
  onIntro: (v: string) => void;
}> = ({ type, onType, title, onTitle, tags, setTags, moreOpen, onToggleMore, subtitle, onSubtitle, city, onCity, intro, onIntro }) => {
  const [tagQ, setTagQ] = useState('');
  const q = tagQ.trim().toLowerCase();
  const isRecipes = type === 'recipes';

  const suggestions = q
    ? TAG_SUGGESTIONS.filter((t) => t.toLowerCase().includes(q) && !tags.includes(t)).slice(0, 12)
    : DEFAULT_TAG_SUGGESTIONS.filter((t) => !tags.includes(t));
  const canCreate = q.length > 1
    && !TAG_SUGGESTIONS.some((t) => t.toLowerCase() === q)
    && !tags.some((t) => t.toLowerCase() === q);

  const addTag = (t: string) => {
    setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagQ('');
  };
  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  return (
    <div className="gcx-stack">
      {/* Type */}
      <div>
        <FieldKicker>What kind of guide?</FieldKicker>
        <div className="gcx-type-grid">
          {([
            { key: 'restaurants' as GuideType, label: 'Restaurants', sub: 'Places to eat & drink', icon: <MapPin size={16} /> },
            { key: 'recipes' as GuideType, label: 'Recipes', sub: 'Things to cook at home', icon: <ChefHat size={16} /> },
          ]).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onType(o.key)}
              className={`gcx-type-card${type === o.key ? ' is-on' : ''}`}
            >
              <span className="gcx-type-icon">{o.icon}</span>
              <span className="gcx-type-text">
                <span className="gcx-type-label">{o.label}</span>
                <span className="gcx-type-sub">{o.sub}</span>
              </span>
              <span className="gcx-radio" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <FieldKicker>Title</FieldKicker>
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={isRecipes ? 'Weeknight comfort classics' : 'Best pasta in the Village'}
          maxLength={80}
          className="gcx-title-input"
          autoCapitalize="sentences"
        />
        <div className="gcx-hint">A short, opinionated name works best.</div>
      </div>

      {/* Tags */}
      <div>
        <FieldKicker optional>Tags</FieldKicker>
        <div className="gcx-chips">
          {tags.map((t) => (
            <button key={t} type="button" className="gcx-chip is-on" onClick={() => removeTag(t)}>
              {t}
              <X size={11} strokeWidth={2.4} />
            </button>
          ))}
          {suggestions.map((t) => (
            <button key={t} type="button" className="gcx-chip" onClick={() => addTag(t)}>
              {t}
            </button>
          ))}
          {canCreate && (
            <button type="button" className="gcx-chip gcx-chip-add" onClick={() => addTag(tagQ.trim())}>
              <Plus size={11} strokeWidth={2.4} />
              {tagQ.trim()}
            </button>
          )}
        </div>
        <input
          value={tagQ}
          onChange={(e) => setTagQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (suggestions[0]) addTag(suggestions[0]);
            else if (canCreate) addTag(tagQ.trim());
          }}
          placeholder="Type to search all tags…"
          className="gcx-line-input gcx-tag-search"
        />
      </div>

      {/* More details */}
      <div>
        <button type="button" className={`gcx-more-btn${moreOpen ? ' is-open' : ''}`} onClick={onToggleMore}>
          <ChevronRight size={14} className="gcx-more-chev" />
          More details
          <span className="gcx-more-sub">subtitle · city · intro</span>
        </button>
        {moreOpen && (
          <div className="gcx-more-body">
            <div>
              <FieldKicker optional>Subtitle</FieldKicker>
              <input
                value={subtitle}
                onChange={(e) => onSubtitle(e.target.value)}
                placeholder={isRecipes ? 'Twelve dinners that never fail' : 'A tour of the red-sauce classics'}
                maxLength={120}
                className="gcx-line-input"
              />
            </div>
            <div>
              <FieldKicker optional>City</FieldKicker>
              <GuideCityField value={city} onChange={onCity} />
              <div className="gcx-hint">Surfaces this guide on the city's page.</div>
            </div>
            <div>
              <FieldKicker optional>Intro</FieldKicker>
              <textarea
                value={intro}
                onChange={(e) => onIntro(e.target.value)}
                placeholder="Set the scene — why this guide, why now, why you."
                rows={4}
                className="gcx-area"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Step 2: Add places / recipes ────────────────────────────────── */

const StepAdd: React.FC<{
  type: GuideType;
  source: SourceMode;
  onSource: (m: SourceMode) => void;
  lists: CustomList[];
  ratings: RestaurantRating[];
  myRecipes: DbRecipe[];
  /** Lowercase-trimmed recipe-title -> score from the user's home meals.
   *  Cloud recipes don't store a score, but a matching HomeMeal does. */
  homeMealScores: Map<string, number>;
  /** Lowercase-trimmed names from `ratings` + cached `restaurantMeta`,
   *  used to filter restaurant-named rows out of the recipes picker. */
  restaurantNames: Set<string>;
  addedRefIds: Set<string>;
  onAddRestaurants: (rs: RestaurantRating[]) => void;
  onAddRestaurantsFromList: (l: CustomList) => void;
  onAddPlaces: (ps: PlaceResult[]) => void;
  onAddListRecipes: (rs: ListRecipe[]) => void;
  onAddDbRecipes: (rs: DbRecipe[]) => void;
  onRemoveByRefIds: (refIds: string[]) => void;
}> = ({ type, source, onSource, lists, ratings, myRecipes, homeMealScores, restaurantNames, addedRefIds, onAddRestaurants, onAddRestaurantsFromList, onAddPlaces, onAddListRecipes, onAddDbRecipes, onRemoveByRefIds }) => {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [ratedFilter, setRatedFilter] = useState('');
  const [recipesFilter, setRecipesFilter] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchReqIdRef = useRef(0);
  // Bias the place search toward the user's chosen home location
  // (falls back to NYC only when they never picked one).
  const homeLoc = useHomeLocation();
  const biasLat = homeLoc?.location?.lat ?? 40.7128;
  const biasLng = homeLoc?.location?.lng ?? -74.0060;

  const isRecipes = type === 'recipes';
  const tabs: { key: SourceMode; label: string }[] = isRecipes
    ? [
        { key: 'recipes-my', label: 'My recipes' },
        { key: 'recipes-list', label: 'From lists' },
      ]
    : [
        { key: 'search', label: 'Search' },
        { key: 'rated', label: 'Your ratings' },
        { key: 'list', label: 'Your lists' },
      ];
  // Defensive: if the parent's source hasn't caught up with a type switch,
  // fall back to the first tab of the current type.
  const active: SourceMode = tabs.some((t) => t.key === source) ? source : tabs[0].key;

  const relevantLists = isRecipes
    ? lists.filter((l) => l.type === 'home-cooking' && (l.recipes?.length || 0) > 0)
    : lists.filter((l) => (l.restaurantIds?.length || 0) > 0);

  const trimmedSearch = searchQ.trim();
  useEffect(() => {
    if (active !== 'search') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!trimmedSearch) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const reqId = ++searchReqIdRef.current;
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const found = await searchPlacesByText(trimmedSearch, biasLat, biasLng);
        if (reqId !== searchReqIdRef.current) return;
        setSearchResults(found.slice(0, 10));
      } catch {
        if (reqId === searchReqIdRef.current) setSearchResults([]);
      } finally {
        if (reqId === searchReqIdRef.current) setSearching(false);
      }
    }, 240);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [trimmedSearch, active]);

  // A list reads as "imported" when EVERY one of its refIds is already an
  // entry — derived from the entries themselves. (The old local Set
  // unmounted with this step, so buttons reverted to "Add all" between
  // steps while re-pressing silently no-oped on the dedupe.)
  const listRefIds = (l: CustomList): string[] =>
    isRecipes ? (l.recipes || []).map((r) => r.id) : (l.restaurantIds || []);
  const isListImported = (l: CustomList): boolean => {
    const ids = listRefIds(l);
    return ids.length > 0 && ids.every((id) => addedRefIds.has(id));
  };

  const toggleList = (l: CustomList) => {
    if (isListImported(l)) {
      // Un-import removes only entries no OTHER imported list still
      // references — a shared refId used to vanish from both.
      const referencedElsewhere = new Set(
        lists
          .filter((other) => other.id !== l.id && isListImported(other))
          .flatMap((other) => listRefIds(other)),
      );
      onRemoveByRefIds(listRefIds(l).filter((id) => !referencedElsewhere.has(id)));
    } else if (isRecipes) {
      if (l.recipes) onAddListRecipes(l.recipes);
    } else {
      onAddRestaurantsFromList(l);
    }
  };

  const searchPill = (value: string, onChange: (v: string) => void, placeholder: string, busy?: boolean, autoFocus?: boolean) => (
    <div className="gcx-search">
      <Search size={15} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      {busy && <Loader2 size={14} className="animate-spin gcx-search-spin" />}
      {!busy && value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear">
          <X size={13} />
        </button>
      )}
    </div>
  );

  const toggleBtn = (isAdded: boolean) => (
    <span className={`gcx-row-toggle${isAdded ? ' is-added' : ''}`} aria-hidden>
      {isAdded ? <Check size={14} strokeWidth={2.8} /> : <Plus size={14} strokeWidth={2.2} />}
    </span>
  );

  let pane: React.ReactNode = null;

  if (active === 'search') {
    pane = (
      <>
        {searchPill(searchQ, setSearchQ, 'Search any restaurant…', searching, true)}
        <div className="gcx-rows">
          {searchResults.map((p) => {
            const isAdded = addedRefIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { if (isAdded) onRemoveByRefIds([p.id]); else onAddPlaces([p]); }}
                className={`gcx-row${isAdded ? ' is-added' : ''}`}
              >
                <span className="gcx-row-main">
                  <span className="gcx-row-name">{p.name}</span>
                  <span className="gcx-row-meta">{p.address}</span>
                </span>
                {toggleBtn(isAdded)}
              </button>
            );
          })}
          {searchResults.length === 0 && !searching && (
            <div className="gcx-empty">
              {trimmedSearch ? 'No results — try a different query.' : 'Start typing to find restaurants.'}
            </div>
          )}
        </div>
      </>
    );
  } else if (active === 'rated') {
    const ratedQ = ratedFilter.trim().toLowerCase();
    const filteredRatings = ratedQ
      ? ratings.filter((r) =>
          r.name.toLowerCase().includes(ratedQ)
          || (r.cuisine || '').toLowerCase().includes(ratedQ)
          || (r.address || '').toLowerCase().includes(ratedQ))
      : ratings;
    pane = ratings.length === 0 ? (
      <div className="gcx-empty">You haven't rated any places yet — search instead.</div>
    ) : (
      <>
        {searchPill(ratedFilter, setRatedFilter, 'Filter your rated places…')}
        <div className="gcx-rows">
          {filteredRatings.map((r) => {
            const isAdded = addedRefIds.has(r.restaurantId);
            return (
              <button
                key={r.restaurantId}
                type="button"
                onClick={() => { if (isAdded) onRemoveByRefIds([r.restaurantId]); else onAddRestaurants([r]); }}
                className={`gcx-row${isAdded ? ' is-added' : ''}`}
              >
                <span className="gcx-row-main">
                  <span className="gcx-row-name">{r.name}</span>
                  <span className="gcx-row-meta">{[r.cuisine, r.price].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="gcx-row-score">{r.score.toFixed(1)}</span>
                {toggleBtn(isAdded)}
              </button>
            );
          })}
          {filteredRatings.length === 0 && <div className="gcx-empty">No matches.</div>}
        </div>
      </>
    );
  } else if (active === 'list' || active === 'recipes-list') {
    pane = relevantLists.length === 0 ? (
      <div className="gcx-empty">
        {isRecipes ? 'No home-cooking lists yet. Add recipes in Pantry first.' : "You don't have any lists with places yet."}
      </div>
    ) : (
      <div className="gcx-rows">
        {relevantLists.map((l) => {
          const isImported = isListImported(l);
          const count = isRecipes ? (l.recipes?.length || 0) : l.restaurantIds.length;
          return (
            <div key={l.id} className={`gcx-list-card${isImported ? ' is-added' : ''}`}>
              <span className="gcx-list-emoji">{l.emoji}</span>
              <span className="gcx-row-main">
                <span className="gcx-row-name">{l.name}</span>
                <span className="gcx-row-meta">{count} {isRecipes ? (count === 1 ? 'recipe' : 'recipes') : (count === 1 ? 'place' : 'places')}</span>
              </span>
              <button type="button" className={`gcx-list-add${isImported ? ' is-added' : ''}`} onClick={() => toggleList(l)}>
                {isImported ? <>Added <Check size={12} strokeWidth={2.8} /></> : 'Add all'}
              </button>
            </div>
          );
        })}
      </div>
    );
  } else {
    // active === 'recipes-my'
    // Restaurants leak into the cloud `recipes` table when the user
    // creates a restaurant-themed entry via a flow that bridges both
    // tables (e.g. recreating a dish from a rated place). Four filters
    // together keep them out:
    //   1. `linkedRestaurantId` set → explicitly a restaurant-linked row
    //   2. title matches a rated restaurant name (case-insensitive)
    //   3. title matches a cached restaurantMeta name
    //   4. row has no actual recipe content (no ingredients / steps /
    //      description / prep+cook time). Real recipes almost always
    //      have at least one of these; pure placeholders don't.
    const recipesOnly = myRecipes.filter((r) => {
      if (r.linkedRestaurantId) return false;
      const lower = (r.title || '').trim().toLowerCase();
      if (restaurantNames.has(lower)) return false;
      const hasIngredients = (r.ingredients?.length || 0) > 0;
      const hasSteps = (r.steps?.length || 0) > 0;
      const hasDescription = (r.description || '').trim().length > 0;
      const hasTime = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0) > 0;
      if (!hasIngredients && !hasSteps && !hasDescription && !hasTime) return false;
      return true;
    });
    const recipesQ = recipesFilter.trim().toLowerCase();
    const filteredRecipes = recipesQ
      ? recipesOnly.filter((r) =>
          r.title.toLowerCase().includes(recipesQ)
          || (r.cuisine || '').toLowerCase().includes(recipesQ)
          || (r.tags || []).some((t) => t.toLowerCase().includes(recipesQ)))
      : recipesOnly;
    pane = recipesOnly.length === 0 ? (
      <div className="gcx-empty">You haven't created any recipes yet.</div>
    ) : (
      <>
        {searchPill(recipesFilter, setRecipesFilter, 'Filter your recipes…')}
        <div className="gcx-rows">
          {filteredRecipes.map((r) => {
            const isAdded = addedRefIds.has(r.id);
            const totalMin = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0);
            const subBits = [r.cuisine, r.difficulty, totalMin > 0 ? `${totalMin} min` : null].filter(Boolean);
            const score = homeMealScores.get((r.title || '').trim().toLowerCase());
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => { if (isAdded) onRemoveByRefIds([r.id]); else onAddDbRecipes([r]); }}
                className={`gcx-row${isAdded ? ' is-added' : ''}`}
              >
                <span className="gcx-row-thumb">
                  {r.photos?.[0]
                    ? <img src={r.photos[0]} alt="" referrerPolicy="no-referrer" />
                    : <ChefHat size={16} />}
                </span>
                <span className="gcx-row-main">
                  <span className="gcx-row-name">{r.title}</span>
                  <span className="gcx-row-meta">{subBits.join(' · ')}</span>
                </span>
                {typeof score === 'number' && score > 0 && (
                  <span className="gcx-row-score">{score.toFixed(1)}</span>
                )}
                {toggleBtn(isAdded)}
              </button>
            );
          })}
          {filteredRecipes.length === 0 && <div className="gcx-empty">No matches.</div>}
        </div>
      </>
    );
  }

  return (
    <div className="gcx-stack">
      <div className="gcx-seg" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`gcx-seg-btn${active === t.key ? ' is-on' : ''}`}
            onClick={() => onSource(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {pane}
    </div>
  );
};

/* ── Step 3: Arrange ─────────────────────────────────────────────── */

/** Phone entry card — dragged by its grip to reorder (framer Reorder
 *  drives the spring layout animation); the pencil (or the row itself)
 *  opens the full-page entry editor. */
const ArrangeCardPhone: React.FC<{
  entry: GuideEntry;
  index: number;
  isRecipes: boolean;
  onEdit: () => void;
  onRemove: () => void;
}> = ({ entry, index, isRecipes, onEdit, onRemove }) => {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={entry}
      as="div"
      className="gcx-card gcx-card-drag"
      dragListener={false}
      dragControls={controls}
      style={{ position: 'relative' }}
      whileDrag={{ scale: 1.03, boxShadow: '0 16px 36px rgba(29, 26, 22, 0.2)', zIndex: 30 }}
    >
      <div className="gcx-card-row">
        <span
          className="gcx-grip gcx-grip-phone"
          onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}
          role="button"
          aria-label="Drag to reorder"
        />
        <span className="gcx-card-num">{String(index + 1).padStart(2, '0')}</span>
        {entry.image && (
          <span className="gcx-card-thumb">
            <img src={entry.image} alt="" referrerPolicy="no-referrer" />
          </span>
        )}
        <span className="gcx-row-main" onClick={onEdit} role="button">
          <span className="gcx-row-name">{entry.name}</span>
          <span className="gcx-row-meta">
            {[typeof entry.score === 'number' ? entry.score.toFixed(1) : null, entry.subtitle].filter(Boolean).join(' · ') || (isRecipes ? 'Recipe' : 'Place')}
          </span>
        </span>
        <span className="gcx-card-actions">
          <button type="button" className="gcx-icon-btn" onClick={onEdit} aria-label="Edit details">
            <Pencil size={13} />
          </button>
          <button type="button" className="gcx-icon-btn gcx-icon-danger" onClick={onRemove} aria-label="Remove">
            <Trash2 size={13} />
          </button>
        </span>
      </div>
    </Reorder.Item>
  );
};

/** Full-page entry editor (phone) — slides in over the arrange step.
 *  A calmer, roomier take on the old inline expand: hero photo, serif
 *  title, a score slider with a big readout, then one card per field. */
const EntryDetail: React.FC<{
  entry: GuideEntry;
  index: number;
  type: GuideType;
  onPatch: (id: string, patch: Partial<GuideEntry>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}> = ({ entry, index, type, onPatch, onRemove, onClose }) => {
  const isRecipes = type === 'recipes';
  const orderedKey = isRecipes ? 'keyIngredients' : 'mustOrder';
  const orderedLabel = isRecipes ? 'Key ingredients' : 'Favorite dishes';
  const orderedVals = isRecipes ? entry.keyIngredients : entry.mustOrder;
  const hasScore = typeof entry.score === 'number';

  return (
    <div className="gcx-detail-inner">
      <div className="gcx-detail-head">
        <button type="button" className="gcx-detail-back" onClick={onClose} aria-label="Back">
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <span className="gcx-detail-eyebrow">
          {String(index + 1).padStart(2, '0')} · {isRecipes ? 'Recipe' : 'Place'}
        </span>
        <button
          type="button"
          className="gcx-detail-trash"
          onClick={() => { onRemove(entry.id); onClose(); }}
          aria-label="Remove entry"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="gcx-detail-body">
        {entry.image && (
          <div className="gcx-detail-hero">
            <img src={entry.image} alt="" referrerPolicy="no-referrer" />
          </div>
        )}
        <div className="gcx-detail-title-wrap">
          <h3 className="gcx-detail-name">{entry.name}</h3>
          {entry.subtitle && <p className="gcx-detail-meta">{entry.subtitle}</p>}
        </div>

        {/* Score */}
        <div className="gcx-detail-card">
          <FieldKicker optional>Your score · 0–10</FieldKicker>
          <div className="gcx-dscore">
            <span className={`gcx-dscore-num${hasScore ? ' is-set' : ''}`}>
              {hasScore ? entry.score!.toFixed(1) : '—'}
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={hasScore ? entry.score : 7.5}
              onChange={(ev) => {
                const v = Math.max(0, Math.min(10, parseFloat(ev.target.value)));
                if (Number.isFinite(v)) onPatch(entry.id, { score: v });
              }}
              className="gcx-dscore-slider"
              aria-label="Score out of ten"
            />
          </div>
          {hasScore ? (
            <button type="button" className="gcx-dscore-clear" onClick={() => onPatch(entry.id, { score: undefined })}>
              Clear score
            </button>
          ) : (
            <p className="gcx-hint">Slide to add a score.</p>
          )}
        </div>

        {/* Dishes / ingredients */}
        <div className="gcx-detail-card">
          <FieldKicker optional>{orderedLabel}</FieldKicker>
          <DishesInput
            value={orderedVals || []}
            placeholder={isRecipes ? 'Saffron, Bomba rice' : 'Cold sesame noodles, Pork belly'}
            onCommit={(next) => onPatch(entry.id, { [orderedKey]: next } as Partial<GuideEntry>)}
          />
          <p className="gcx-hint">Separate with commas.</p>
        </div>

        {/* Note */}
        <div className="gcx-detail-card">
          <FieldKicker optional>Note</FieldKicker>
          <textarea
            value={entry.notes || ''}
            onChange={(ev) => onPatch(entry.id, { notes: ev.target.value })}
            placeholder="What makes this special? Why are you sending people here?"
            rows={4}
            className="gcx-area"
          />
          <p className="gcx-hint">The heart of the entry — readers see this first.</p>
        </div>

        {/* Restaurant extras */}
        {!isRecipes && (
          <div className="gcx-detail-card">
            <div className="gcx-detail-fields">
              <div>
                <FieldKicker optional>Best for</FieldKicker>
                <input
                  value={entry.bestFor || ''}
                  onChange={(ev) => onPatch(entry.id, { bestFor: ev.target.value })}
                  placeholder="A grown-up dinner"
                  className="gcx-line-input"
                />
              </div>
              <div>
                <FieldKicker optional>Insider tip</FieldKicker>
                <input
                  value={entry.insiderTip || ''}
                  onChange={(ev) => onPatch(entry.id, { insiderTip: ev.target.value })}
                  placeholder="Sit upstairs by the window"
                  className="gcx-line-input"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="gcx-detail-foot">
        <button type="button" className="gcx-detail-done" onClick={onClose}>
          <Check size={15} strokeWidth={2.6} />
          Done
        </button>
      </div>
    </div>
  );
};

const StepArrange: React.FC<{
  type: GuideType;
  entries: GuideEntry[];
  phoneMode: boolean;
  coverPhoto: string;
  onPickCoverFile: () => void;
  onPickCoverFromEntry: (img: string) => void;
  onClearCover: () => void;
  includePhotos: boolean;
  onTogglePhotos: () => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<GuideEntry>) => void;
  onMove: (from: number, to: number) => void;
  onReorder: (next: GuideEntry[]) => void;
  onAddMore: () => void;
  dragRef: React.MutableRefObject<number | null>;
}> = ({ type, entries, phoneMode, coverPhoto, onPickCoverFile, onPickCoverFromEntry, onClearCover, includePhotos, onTogglePhotos, expandedId, onToggleExpand, onRemove, onPatch, onMove, onReorder, onAddMore, dragRef }) => {
  const isRecipes = type === 'recipes';
  const orderedKey = isRecipes ? 'keyIngredients' : 'mustOrder';
  const orderedLabel = isRecipes ? 'Key ingredients' : 'Favorite dishes';
  const entryImages = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of entries) {
      if (e.image && !seen.has(e.image)) { seen.add(e.image); out.push(e.image); }
      if (out.length >= 8) break;
    }
    return out;
  }, [entries]);

  return (
    <div className="gcx-stack">
      {/* Cover */}
      <div>
        <FieldKicker optional>Cover photo</FieldKicker>
        {coverPhoto ? (
          <div className="gcx-cover-preview">
            <img src={coverPhoto} alt="Guide cover" referrerPolicy="no-referrer" />
            <div className="gcx-cover-actions">
              <button type="button" onClick={onPickCoverFile}>Change</button>
              <button type="button" onClick={onClearCover} aria-label="Remove cover">
                <X size={13} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="gcx-cover-slot" onClick={onPickCoverFile}>
              <ImagePlus size={18} />
              <span>Add a cover photo</span>
              <span className="gcx-cover-slot-sub">Guides without one get a clean text cover.</span>
            </button>
            {entryImages.length > 0 && (
              <div className="gcx-cover-strip">
                <span className="gcx-cover-strip-label">or use one of yours</span>
                <div className="gcx-cover-strip-row">
                  {entryImages.map((img) => (
                    <button key={img.slice(0, 80)} type="button" className="gcx-cover-thumb" onClick={() => onPickCoverFromEntry(img)}>
                      <img src={img} alt="" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Photos switch */}
      <div className="gcx-switch-row">
        <div className="gcx-row-main">
          <span className="gcx-row-name">Show photos on entries</span>
          <span className="gcx-row-meta">When off, the published guide renders text-only cards.</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includePhotos}
          onClick={onTogglePhotos}
          className={`gcx-switch${includePhotos ? ' is-on' : ''}`}
        >
          <span className="gcx-switch-knob" />
        </button>
      </div>

      {/* Entries */}
      <div>
        <FieldKicker>{isRecipes ? 'Your recipes' : 'Your places'}</FieldKicker>
        {phoneMode ? (
          /* Phone — drag the grip to reorder (spring layout animations);
             the pencil opens the full-page entry editor. */
          <Reorder.Group axis="y" as="div" values={entries} onReorder={onReorder} className="gcx-cards">
            {entries.map((e, i) => (
              <ArrangeCardPhone
                key={e.id}
                entry={e}
                index={i}
                isRecipes={isRecipes}
                onEdit={() => onToggleExpand(e.id)}
                onRemove={() => onRemove(e.id)}
              />
            ))}
          </Reorder.Group>
        ) : (
        <div className="gcx-cards">
          {entries.map((e, i) => {
            const isOpen = expandedId === e.id;
            const orderedVals = isRecipes ? e.keyIngredients : e.mustOrder;
            return (
              <div
                key={e.id}
                className={`gcx-card${isOpen ? ' is-open' : ''}`}
                draggable={!isOpen}
                onDragStart={() => { dragRef.current = i; }}
                onDragOver={(ev) => ev.preventDefault()}
                onDrop={() => {
                  if (dragRef.current !== null && dragRef.current !== i) onMove(dragRef.current, i);
                  dragRef.current = null;
                }}
              >
                <div className="gcx-card-row">
                  <span className="gcx-grip" aria-hidden />
                  <span className="gcx-card-num">{String(i + 1).padStart(2, '0')}</span>
                  {e.image && (
                    <span className="gcx-card-thumb">
                      <img src={e.image} alt="" referrerPolicy="no-referrer" />
                    </span>
                  )}
                  <span className="gcx-row-main">
                    <span className="gcx-row-name">{e.name}</span>
                    <span className="gcx-row-meta">
                      {[typeof e.score === 'number' ? e.score.toFixed(1) : null, e.subtitle].filter(Boolean).join(' · ') || (isRecipes ? 'Recipe' : 'Place')}
                    </span>
                  </span>
                  <span className="gcx-card-actions">
                    <button
                      type="button"
                      className={`gcx-icon-btn${isOpen ? ' is-on' : ''}`}
                      onClick={() => onToggleExpand(e.id)}
                      aria-label={isOpen ? 'Close details' : 'Edit details'}
                    >
                      {isOpen ? <ChevronUp size={14} /> : <Pencil size={13} />}
                    </button>
                    <button type="button" className="gcx-icon-btn gcx-icon-danger" onClick={() => onRemove(e.id)} aria-label="Remove">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>

                {isOpen && (
                  <div className="gcx-card-expand">
                    <div className="gcx-expand-grid">
                      <div>
                        <FieldKicker optional>Score · 0–10</FieldKicker>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="10"
                          inputMode="decimal"
                          value={typeof e.score === 'number' ? e.score : ''}
                          onChange={(ev) => {
                            const v = ev.target.value === '' ? undefined : Math.max(0, Math.min(10, parseFloat(ev.target.value)));
                            onPatch(e.id, { score: typeof v === 'number' && Number.isFinite(v) ? v : undefined });
                          }}
                          placeholder="—"
                          className="gcx-line-input gcx-score-input"
                        />
                      </div>
                      <div>
                        <FieldKicker optional>{orderedLabel}</FieldKicker>
                        <DishesInput
                          value={orderedVals || []}
                          placeholder={isRecipes ? 'Saffron, Bomba rice' : 'Cold sesame noodles, Pork belly'}
                          onCommit={(next) => onPatch(e.id, { [orderedKey]: next } as Partial<GuideEntry>)}
                        />
                      </div>
                    </div>
                    <div>
                      <FieldKicker optional>Note</FieldKicker>
                      <textarea
                        value={e.notes || ''}
                        onChange={(ev) => onPatch(e.id, { notes: ev.target.value })}
                        placeholder="What makes this special? Why are you sending people here?"
                        rows={3}
                        className="gcx-area"
                      />
                    </div>
                    {!isRecipes && (
                      <div className="gcx-expand-grid">
                        <div>
                          <FieldKicker optional>Best for</FieldKicker>
                          <input
                            value={e.bestFor || ''}
                            onChange={(ev) => onPatch(e.id, { bestFor: ev.target.value })}
                            placeholder="A grown-up dinner"
                            className="gcx-line-input"
                          />
                        </div>
                        <div>
                          <FieldKicker optional>Insider tip</FieldKicker>
                          <input
                            value={e.insiderTip || ''}
                            onChange={(ev) => onPatch(e.id, { insiderTip: ev.target.value })}
                            placeholder="Sit upstairs by the window"
                            className="gcx-line-input"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
        <button type="button" className="gcx-addmore" onClick={onAddMore}>
          <Plus size={14} strokeWidth={2.2} />
          Add more {isRecipes ? 'recipes' : 'places'}
        </button>
        {entries.length > 1 && (
          <div className="gcx-hint" style={{ marginTop: 8 }}>
            {phoneMode ? 'Hold the dots and drag to reorder.' : 'Drag cards to reorder.'}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Step 4: Review & publish ────────────────────────────────────── */

const StepPublish: React.FC<{
  type: GuideType;
  title: string;
  subtitle: string;
  coverPhoto: string;
  tags: string[];
  entries: GuideEntry[];
  visibility: GuideVisibility;
  onVisibility: (v: GuideVisibility) => void;
  accountIsPublic: boolean;
  authorName: string;
  onEditBasics: () => void;
  onEditEntries: () => void;
}> = ({ type, title, subtitle, coverPhoto, tags, entries, visibility, onVisibility, accountIsPublic, authorName, onEditBasics, onEditEntries }) => {
  const isRecipes = type === 'recipes';
  const noun = isRecipes ? (entries.length === 1 ? 'recipe' : 'recipes') : (entries.length === 1 ? 'place' : 'places');

  return (
    <div className="gcx-stack">
      {/* Preview card */}
      <div>
        <div className="gcx-sec-head">
          <FieldKicker>Preview</FieldKicker>
          <button type="button" className="gcx-sec-edit" onClick={onEditBasics}>Edit details</button>
        </div>
        <div
          className="gcx-preview"
          style={coverPhoto ? {
            backgroundImage: `linear-gradient(180deg, rgba(20, 17, 14, 0.28) 0%, rgba(20, 17, 14, 0.82) 100%), url(${JSON.stringify(coverPhoto)})`,
          } : undefined}
        >
          <div className="gcx-preview-kicker">
            {isRecipes ? 'Recipe guide' : 'Guide'} · {entries.length} {noun}
          </div>
          <div className="gcx-preview-title">{title.trim() || 'Untitled guide'}</div>
          {subtitle.trim() && <div className="gcx-preview-sub">{subtitle.trim()}</div>}
          <div className="gcx-preview-meta">
            {authorName && <span>by {authorName}</span>}
            {tags.slice(0, 3).map((t) => <span key={t} className="gcx-preview-tag">{t}</span>)}
          </div>
        </div>
      </div>

      {/* Visibility */}
      <div>
        <FieldKicker>Who can see it?</FieldKicker>
        <div className="gcx-type-grid">
          {([
            { key: 'public' as GuideVisibility, label: 'Public', sub: 'Anyone can find it on Discover', icon: <Globe size={16} /> },
            { key: 'private' as GuideVisibility, label: 'Private', sub: 'Only you can see it', icon: <Lock size={16} /> },
          ]).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onVisibility(o.key)}
              className={`gcx-type-card${visibility === o.key ? ' is-on' : ''}`}
            >
              <span className="gcx-type-icon">{o.icon}</span>
              <span className="gcx-type-text">
                <span className="gcx-type-label">{o.label}</span>
                <span className="gcx-type-sub">{o.sub}</span>
              </span>
              <span className="gcx-radio" aria-hidden />
            </button>
          ))}
        </div>
        <div className="gcx-hint">
          Defaults to your account setting ({accountIsPublic ? 'public' : 'private'}). You can change this anytime.
        </div>
      </div>

      {/* Entry summary */}
      <div>
        <div className="gcx-sec-head">
          <FieldKicker>In this guide</FieldKicker>
          <button type="button" className="gcx-sec-edit" onClick={onEditEntries}>Edit entries</button>
        </div>
        <div className="gcx-sum">
          {entries.map((e, i) => (
            <div key={e.id} className="gcx-sum-row">
              <span className="gcx-sum-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="gcx-sum-name">{e.name}</span>
              {typeof e.score === 'number' && <span className="gcx-row-score">{e.score.toFixed(1)}</span>}
            </div>
          ))}
          {entries.length === 0 && <div className="gcx-empty">No entries yet — go back and add some.</div>}
        </div>
      </div>
    </div>
  );
};

/* ── Main component ──────────────────────────────────────────────── */

export const GuideCreatorSheet: React.FC<GuideCreatorSheetProps> = ({ open, onClose, initialGuide, seed }) => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { lists, ratings, restaurantMeta, getRestaurantInfo, homeMeals } = useLists();
  const { myRecipes } = useRecipes();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  const accountIsPublic = profile?.is_public ?? true;

  const [step, setStep] = useState<Step>('basics');
  // Per-step scroll offsets for the wizard body — saved as the user scrolls,
  // restored when a step is revisited (a validation jump back to Basics used
  // to land at the top with the offending field out of view). A step never
  // visited restores to 0, so forward navigation still starts at the top.
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const stepScrollsRef = useRef<Partial<Record<Step, number>>>({});
  useLayoutEffect(() => {
    const el = bodyScrollRef.current;
    if (el) el.scrollTop = stepScrollsRef.current[step] ?? 0;
  }, [step]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<GuideType>('restaurants');
  const [source, setSource] = useState<SourceMode>('search');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [intro, setIntro] = useState('');
  // Optional city this guide is "for" — surfaces it on that city's Location
  // page. Guides also auto-surface there via any entry in the city, so this
  // is a convenience tag, not a requirement.
  const [city, setCity] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [coverPhoto, setCoverPhoto] = useState('');
  const [visibility, setVisibility] = useState<GuideVisibility>(accountIsPublic ? 'public' : 'private');
  const [includePhotos, setIncludePhotos] = useState(true);
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Success overlay after publish / save-changes. */
  const [publishedGuide, setPublishedGuide] = useState<Guide | null>(null);
  /** Live Editor state — `theme` carries everything the editor produces;
   *  `liveEditOpen` toggles the overlay; `authorProfile` is looked up
   *  lazily so the author panel has sensible defaults. */
  const [theme, setTheme] = useState<GuideTheme | undefined>(undefined);
  const [liveEditOpen, setLiveEditOpen] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);

  const { dragProps } = useBottomSheet(open, onClose);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialGuide) {
      setEditingId(initialGuide.id);
      setType(initialGuide.type);
      setTitle(initialGuide.title);
      setSubtitle(initialGuide.subtitle);
      setIntro(initialGuide.intro);
      setCity(initialGuide.city || '');
      setTags(initialGuide.tags);
      setCoverPhoto(initialGuide.coverPhoto);
      setVisibility(initialGuide.visibility);
      setIncludePhotos(initialGuide.includePhotos);
      setEntries(initialGuide.entries);
      setTheme(initialGuide.theme);
      setMoreOpen(!!(initialGuide.subtitle || initialGuide.city || initialGuide.intro));
      setStep('publish');
    } else {
      // Assign the new guide a stable id up front so every save upserts the
      // SAME row. Without this, a second save firing before setEditingId had
      // flushed (autosave, launch-live-edit, save-then-publish) inserted a
      // fresh row each time — which is what produced duplicate guide cards.
      setEditingId(crypto.randomUUID());
      setType(seed?.type || 'restaurants');
      setSource('search');
      setTitle(seed?.title || '');
      setSubtitle('');
      setIntro('');
      setCity('');
      setTags([]);
      setMoreOpen(false);
      setCoverPhoto('');
      setTheme(undefined);
      setVisibility(accountIsPublic ? 'public' : 'private');
      setIncludePhotos(true);
      setEntries([]);
      setStep('basics');
    }
    setExpandedEntryId(null);
    setBusy(false);
    setPublishedGuide(null);
    setLiveEditOpen(false);
    // Snapshot the just-initialized content so a backdrop click can tell
    // "untouched" from "has unsaved work" (see handleBackdropClick).
    initialSigRef.current = JSON.stringify(initialGuide ? {
      type: initialGuide.type, title: initialGuide.title, subtitle: initialGuide.subtitle,
      intro: initialGuide.intro, city: initialGuide.city || '', tags: initialGuide.tags,
      coverPhoto: initialGuide.coverPhoto, visibility: initialGuide.visibility,
      includePhotos: initialGuide.includePhotos, entries: initialGuide.entries, theme: initialGuide.theme,
    } : {
      type: seed?.type || 'restaurants', title: seed?.title || '', subtitle: '', intro: '', city: '',
      tags: [] as string[], coverPhoto: '', visibility: accountIsPublic ? 'public' : 'private',
      includePhotos: true, entries: [] as GuideEntry[], theme: undefined,
    });
  }, [open, initialGuide?.id]);

  // Backdrop click used to call onClose() unconditionally — one stray click
  // outside the desktop sheet silently discarded the entire unsaved guide
  // (state re-seeds on the next open). Confirm when the content changed.
  const initialSigRef = useRef('');
  const handleBackdropClick = () => {
    const currentSig = JSON.stringify({
      type, title, subtitle, intro, city, tags, coverPhoto, visibility, includePhotos, entries, theme,
    });
    if (currentSig !== initialSigRef.current
      && !window.confirm('Discard your unsaved changes to this guide?')) return;
    onClose();
  };

  // Resolve the author profile once per signed-in user — used by the
  // Live Editor's hero/author panel for sensible defaults.
  useEffect(() => {
    if (!open || !user?.id || authorProfile?.user_id === user.id) return;
    let cancelled = false;
    (async () => {
      const profiles = await getProfilesByIds([user.id]);
      if (!cancelled) setAuthorProfile(profiles[user.id] || null);
    })();
    return () => { cancelled = true; };
  }, [open, user?.id, authorProfile?.user_id]);

  const isRecipes = type === 'recipes';
  const stepTitles = STEP_TITLES(isRecipes);
  const currentStepIdx = STEPS_ORDER.indexOf(step);
  const progressPct = ((currentStepIdx + 1) / STEPS_ORDER.length) * 100;

  /* ── Per-step gate + CTA label (gate reason IS the label) ─────── */
  const gateOk =
    step === 'basics' ? title.trim().length > 0 :
    step === 'add' ? entries.length > 0 :
    step === 'arrange' ? true :
    /* publish */ title.trim().length > 0 && entries.length > 0;

  const entryNoun = isRecipes ? 'recipe' : 'place';
  const ctaLabel =
    step === 'basics' ? (title.trim() ? stepTitles.add : 'Name your guide to continue') :
    step === 'add' ? (entries.length > 0
      ? `Arrange ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
      : `Add at least one ${entryNoun}`) :
    step === 'arrange' ? 'Review & publish' :
    (initialGuide?.isPublished ? 'Save changes' : 'Publish guide');

  const goNext = () => {
    if (!gateOk || busy) return;
    if (step === 'publish') { void onPublish(); return; }
    if (step === 'basics') {
      // Keep the source tab valid for the chosen type.
      const restaurantModes: SourceMode[] = ['search', 'rated', 'list'];
      const ok = isRecipes ? !restaurantModes.includes(source) : restaurantModes.includes(source);
      if (!ok) setSource(isRecipes ? 'recipes-my' : 'search');
    }
    setStep(STEPS_ORDER[Math.min(currentStepIdx + 1, STEPS_ORDER.length - 1)]);
  };
  const goBack = () => {
    setStep(STEPS_ORDER[Math.max(currentStepIdx - 1, 0)]);
  };

  /* ── Entry assembly (unchanged data spine) ────────────────────── */

  const addEntryFromRating = (r: RestaurantRating): GuideEntry => {
    const meta = getRestaurantInfo(r.restaurantId);
    const subtitleStr = [r.cuisine, r.price].filter(Boolean).join(' · ');
    const fromExplicit = (r.favoriteDishes || []).map((s) => s.trim()).filter(Boolean);
    const fromPhotos = (r.photos || [])
      .filter((p) => p.isFavorite && p.caption?.trim())
      .map((p) => p.caption.trim());
    const seen = new Set<string>();
    const allDishes: string[] = [];
    for (const d of [...fromExplicit, ...fromPhotos]) {
      const key = d.toLowerCase();
      if (!seen.has(key)) { seen.add(key); allDishes.push(d); }
    }
    return {
      id: newEntryId(),
      refId: r.restaurantId,
      name: r.name,
      subtitle: subtitleStr,
      cuisine: r.cuisine || undefined,
      price: r.price || undefined,
      image: r.photos?.[0]?.url || r.image || '',
      score: r.score,
      notes: r.notes?.trim() || undefined,
      mustOrder: allDishes.length > 0 ? allDishes : undefined,
      neighborhood: meta?.neighborhood,
      hours: meta?.hours?.[0]?.split(': ')[1],
    };
  };

  const addEntryFromPlace = (p: PlaceResult): GuideEntry => {
    const existingRating = ratings.find((r) => r.restaurantId === p.id);
    if (existingRating) return addEntryFromRating(existingRating);
    return {
      id: newEntryId(),
      refId: p.id,
      name: p.name,
      subtitle: [p.types?.[0]?.replace(/_/g, ' '), priceLevelToString(p.priceLevel)].filter(Boolean).join(' · '),
      image: p.photoUrl || '',
      score: undefined,
    };
  };

  const addEntryFromListRecipe = (r: ListRecipe): GuideEntry => ({
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    image: r.coverPhoto || r.photos?.[0]?.url || '',
    score: r.score,
    totalTime: (r.prepTime || 0) + (r.cookTime || 0),
    difficulty: r.difficulty,
    authorId: user?.id,
  });

  // Recipes in the cloud `recipes` table don't carry a score directly,
  // but the user may have logged a matching home meal (HomeMeal.score)
  // — those scores are the ones they expect to see when adding a
  // recipe to a guide. Look the score up by title (lowercase + trimmed
  // is sufficient since recipe titles are user-authored and short).
  const homeMealScores = useMemo(() => {
    const m = new Map<string, number>();
    for (const meal of homeMeals) {
      const key = (meal.name || '').trim().toLowerCase();
      if (key && typeof meal.score === 'number') m.set(key, meal.score);
    }
    return m;
  }, [homeMeals]);

  // Names from the user's ratings + cached restaurant meta + wishlist.
  // Cloud recipes whose title matches any of these are almost certainly
  // restaurant rows that leaked into the recipes table (e.g. from the
  // home-meal logger pre-fill), and we filter them out of the
  // "your recipes" picker so the user only sees real recipes.
  const restaurantNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of ratings) {
      const k = (r.name || '').trim().toLowerCase();
      if (k) s.add(k);
    }
    for (const meta of Object.values(restaurantMeta) as Array<{ name?: string }>) {
      const k = (meta.name || '').trim().toLowerCase();
      if (k) s.add(k);
    }
    return s;
  }, [ratings, restaurantMeta]);

  const addEntryFromDbRecipe = (r: DbRecipe): GuideEntry => ({
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    cuisine: r.cuisine || undefined,
    image: r.photos?.[0] || '',
    score: homeMealScores.get((r.title || '').trim().toLowerCase()),
    totalTime: (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0),
    difficulty: r.difficulty,
    authorId: r.userId,
  });

  const addedRefIds = useMemo(() => new Set(entries.map((e) => e.refId)), [entries]);

  const addRestaurants = (rs: RestaurantRating[]) => {
    setEntries((prev) => {
      const have = new Set(prev.map((e) => e.refId));
      return [...prev, ...rs.filter((r) => !have.has(r.restaurantId)).map(addEntryFromRating)];
    });
  };
  const addRestaurantsFromList = (l: CustomList) => {
    const fromList = l.restaurantIds.map((rid) => {
      const listOverride = l.listRatings?.[rid];
      const baseRating = ratings.find((rr) => rr.restaurantId === rid);
      const r = listOverride || baseRating;
      if (r) return addEntryFromRating(r);
      const meta = restaurantMeta[rid];
      if (meta) {
        return {
          id: newEntryId(),
          refId: rid,
          name: meta.name,
          subtitle: [meta.cuisine, meta.price].filter(Boolean).join(' · '),
          image: meta.image || '',
          neighborhood: meta.neighborhood,
        } as GuideEntry;
      }
      return null;
    }).filter((e): e is GuideEntry => !!e);
    setEntries((prev) => {
      const have = new Set(prev.map((e) => e.refId));
      return [...prev, ...fromList.filter((e) => !have.has(e.refId))];
    });
  };
  const addPlaces = (ps: PlaceResult[]) => {
    setEntries((prev) => {
      const have = new Set(prev.map((e) => e.refId));
      return [...prev, ...ps.filter((p) => !have.has(p.id)).map(addEntryFromPlace)];
    });
  };
  const addListRecipes = (rs: ListRecipe[]) => {
    setEntries((prev) => {
      const have = new Set(prev.map((e) => e.refId));
      return [...prev, ...rs.filter((r) => !have.has(r.id)).map(addEntryFromListRecipe)];
    });
  };
  const addDbRecipes = (rs: DbRecipe[]) => {
    setEntries((prev) => {
      const have = new Set(prev.map((e) => e.refId));
      return [...prev, ...rs.filter((r) => !have.has(r.id)).map(addEntryFromDbRecipe)];
    });
  };
  const removeByRefIds = (refIds: string[]) => {
    const drop = new Set(refIds);
    setEntries((prev) => prev.filter((e) => !drop.has(e.refId)));
  };

  /* ── Arrange helpers ──────────────────────────────────────────── */

  const moveEntry = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from === to) return;
    setEntries((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // Expanding an entry auto-fills note/dishes from the matching rating —
  // but only fields the user has never touched (undefined). Empty string /
  // empty array means intentionally cleared; respect that.
  const toggleExpandEntry = (id: string) => {
    const isOpening = expandedEntryId !== id;
    setExpandedEntryId(isOpening ? id : null);
    if (!isOpening) return;
    const entry = entries.find((e) => e.id === id);
    if (!entry || !entry.refId) return;
    const rating = ratings.find((r) => r.restaurantId === entry.refId);
    if (!rating) return;
    const patch: Partial<GuideEntry> = {};
    if (entry.notes === undefined && rating.notes?.trim()) {
      patch.notes = rating.notes.trim();
    }
    if (entry.mustOrder === undefined && rating.favoriteDishes && rating.favoriteDishes.length > 0) {
      patch.mustOrder = rating.favoriteDishes.map((s) => s.trim()).filter(Boolean);
    }
    if (Object.keys(patch).length > 0) {
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
    }
  };

  const patchEntry = (id: string, patch: Partial<GuideEntry>) =>
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));

  /* ── Cover photo upload ───────────────────────────────────────── */

  const coverInputRef = useRef<HTMLInputElement>(null);
  const onPickCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await processPhoto(file, { maxDim: 1200, quality: 0.7 });
      setCoverPhoto(url);
    } catch (err) {
      console.warn('[Guide] cover compress failed', err);
      showToast("Couldn't read that image");
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  /* ── Save / publish ───────────────────────────────────────────── */

  const persist = async (publish: boolean): Promise<Guide | null> => {
    if (!user?.id) return null;
    setBusy(true);
    const saved = await saveGuide(user.id, {
      ...(editingId ? { id: editingId } : {}),
      type,
      title: title.trim(),
      subtitle: subtitle.trim(),
      intro: intro.trim(),
      city: city.trim() || null,
      coverPhoto,
      tags,
      visibility,
      isPublished: publish,
      includePhotos,
      entries,
      theme,
    });
    setBusy(false);
    if (!saved) {
      showToast("Couldn't save guide");
      return null;
    }
    setEditingId(saved.id);
    return saved;
  };

  const onSaveDraft = async () => {
    const saved = await persist(false);
    if (saved) showToast('Draft saved');
  };

  // Cover photo is optional — guides without one render the photo-less
  // "Minimal" hero (see getTheme in supabase-guides.ts).
  const onPublish = async () => {
    if (!title.trim()) { showToast('Add a title first'); setStep('basics'); return; }
    if (entries.length === 0) { showToast(`Add at least one ${entryNoun}`); setStep('add'); return; }
    const saved = await persist(true);
    if (saved) setPublishedGuide(saved);
  };

  /* ── Live Editor integration (unchanged) ──────────────────────── */

  const liveEditData: Guide = useMemo(() => ({
    id: editingId || 'draft',
    userId: user?.id || '',
    type,
    title: title.trim(),
    subtitle: subtitle.trim(),
    intro: intro.trim(),
    city: city.trim() || null,
    coverPhoto,
    tags,
    visibility,
    isPublished: initialGuide?.isPublished ?? false,
    includePhotos,
    entries,
    avgScore: null,
    readMinutes: null,
    theme,
    createdAt: initialGuide?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [editingId, user?.id, type, title, subtitle, intro, city, coverPhoto, tags, visibility,
       includePhotos, entries, theme, initialGuide?.isPublished, initialGuide?.createdAt]);

  const applyEditorPatch = (next: Guide) => {
    setTitle(next.title);
    setSubtitle(next.subtitle);
    setIntro(next.intro);
    setCity(next.city || '');
    setCoverPhoto(next.coverPhoto);
    setTags(next.tags);
    setEntries(next.entries);
    setVisibility(next.visibility);
    setIncludePhotos(next.includePhotos);
    setTheme(next.theme);
  };

  const onLaunchLiveEdit = async () => {
    if (!user?.id) { showToast('Sign in to use Live edit'); return; }
    if (!editingId) {
      const saved = await persist(false);
      if (!saved) return;
    }
    setLiveEditOpen(true);
  };

  const onLiveEditSave = async (latest: Guide): Promise<boolean> => {
    if (!user?.id) { showToast('Sign in to save'); return false; }
    applyEditorPatch(latest);
    setBusy(true);
    const saved = await saveGuide(user.id, {
      ...(editingId ? { id: editingId } : {}),
      type: latest.type,
      title: (latest.title || '').trim(),
      subtitle: (latest.subtitle || '').trim(),
      intro: (latest.intro || '').trim(),
      city: (latest.city || '').trim() || null,
      coverPhoto: latest.coverPhoto,
      tags: latest.tags,
      visibility: latest.visibility,
      isPublished: initialGuide?.isPublished ?? false,
      includePhotos: latest.includePhotos,
      entries: latest.entries,
      theme: latest.theme,
    });
    setBusy(false);
    if (!saved) {
      showToast("Couldn't save guide");
      return false;
    }
    setEditingId(saved.id);
    showToast('Saved');
    return true;
  };

  /* ── Render ───────────────────────────────────────────────────── */

  // Live edit needs the guide's substance: a title and at least one entry.
  const liveEditUnlocked = title.trim().length > 0 && entries.length > 0;

  // The open gate lives INSIDE AnimatePresence — an early `return null`
  // above it unmounted the whole tree the instant `open` flipped, so the
  // sheet hard-popped away instead of playing its slide-down exit.
  return (
    <AnimatePresence>
      {open && (
      <motion.div
        key="guide-creator-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className={cn(
          'fixed inset-0 bg-black/55 backdrop-blur-sm z-[120] flex justify-center',
          phoneMode ? 'items-end' : 'items-center p-6',
        )}
        onClick={handleBackdropClick}
      >
        <motion.div
          key="guide-creator-sheet"
          initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 14 }}
          animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
          exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 10 }}
          transition={phoneMode
            ? { type: 'spring', damping: 28, stiffness: 300 }
            : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          {...(phoneMode ? dragProps : {})}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'gcx',
            phoneMode ? 'gcx-phone w-full h-full' : 'gcx-desktop w-full max-w-[640px]',
          )}
        >
          {/* ── Header ── */}
          <div className="gcx-head">
            <div className="gcx-head-row">
              {/* Phone keeps the chrome minimal: just Save draft + a
                  prominent close. Desktop keeps the eyebrow + Live edit. */}
              {!phoneMode && (
                <div className="gcx-eyebrow">
                  {initialGuide ? 'EDIT GUIDE' : 'NEW GUIDE'} · {currentStepIdx + 1} OF {STEPS_ORDER.length}
                </div>
              )}
              <div className="gcx-head-actions">
                {!phoneMode && liveEditUnlocked && (
                  <button type="button" className="gcx-head-link" onClick={() => void onLaunchLiveEdit()} disabled={busy} title="Open the Live editor — visual customizer">
                    <Wand2 size={12} /> Live edit
                  </button>
                )}
                <button type="button" className="gcx-head-link" onClick={() => void onSaveDraft()} disabled={busy}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                  Save draft
                </button>
                <button type="button" className="gcx-head-close" onClick={onClose} aria-label="Close">
                  <X size={phoneMode ? 18 : 14} strokeWidth={2.4} />
                </button>
              </div>
            </div>
            <h2 className="gcx-step-title">{stepTitles[step]}</h2>
            <div className="gcx-progress">
              <div className="gcx-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* ── Scrollable step body ── */}
          <motion.div
            layoutScroll
            ref={bodyScrollRef}
            onScroll={(e) => { stepScrollsRef.current[step] = e.currentTarget.scrollTop; }}
            className="gcx-body"
            style={{ paddingBottom: 'calc(120px + var(--kb-height, 0px))' }}
          >
            {/* popLayout + a short crossfade: the outgoing step pops out of
                layout and fades WHILE the incoming one fades in — the old
                mode="wait" fade-out-then-in left ~0.3s of blank sheet
                between steps. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {step === 'basics' && (
                  <StepBasics
                    type={type} onType={setType}
                    title={title} onTitle={setTitle}
                    tags={tags} setTags={setTags}
                    moreOpen={moreOpen} onToggleMore={() => setMoreOpen((v) => !v)}
                    subtitle={subtitle} onSubtitle={setSubtitle}
                    city={city} onCity={setCity}
                    intro={intro} onIntro={setIntro}
                  />
                )}
                {step === 'add' && (
                  <StepAdd
                    type={type}
                    source={source}
                    onSource={setSource}
                    lists={lists}
                    ratings={ratings}
                    myRecipes={myRecipes}
                    homeMealScores={homeMealScores}
                    restaurantNames={restaurantNames}
                    addedRefIds={addedRefIds}
                    onAddRestaurants={addRestaurants}
                    onAddRestaurantsFromList={addRestaurantsFromList}
                    onAddPlaces={addPlaces}
                    onAddListRecipes={addListRecipes}
                    onAddDbRecipes={addDbRecipes}
                    onRemoveByRefIds={removeByRefIds}
                  />
                )}
                {step === 'arrange' && (
                  <StepArrange
                    type={type}
                    entries={entries}
                    phoneMode={phoneMode}
                    coverPhoto={coverPhoto}
                    onPickCoverFile={() => coverInputRef.current?.click()}
                    onPickCoverFromEntry={(img) => setCoverPhoto(img)}
                    onClearCover={() => setCoverPhoto('')}
                    includePhotos={includePhotos}
                    onTogglePhotos={() => setIncludePhotos((v) => !v)}
                    expandedId={expandedEntryId}
                    onToggleExpand={toggleExpandEntry}
                    onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
                    onPatch={patchEntry}
                    onMove={moveEntry}
                    onReorder={setEntries}
                    onAddMore={() => setStep('add')}
                    dragRef={dragRef}
                  />
                )}
                {step === 'publish' && (
                  <StepPublish
                    type={type}
                    title={title}
                    subtitle={subtitle}
                    coverPhoto={coverPhoto}
                    tags={tags}
                    entries={entries}
                    visibility={visibility}
                    onVisibility={setVisibility}
                    accountIsPublic={accountIsPublic}
                    authorName={profile?.display_name || profile?.username || ''}
                    onEditBasics={() => setStep('basics')}
                    onEditEntries={() => setStep('arrange')}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* ── Footer ── */}
          <div className="gcx-foot">
            {currentStepIdx > 0 && (
              <button type="button" className="gcx-foot-back" onClick={goBack} aria-label="Back">
                <ArrowLeft size={17} />
              </button>
            )}
            <button
              type="button"
              className={cn(
                'gcx-foot-cta',
                !gateOk && 'is-disabled',
                step === 'publish' && gateOk && 'is-publish',
              )}
              onClick={goNext}
              disabled={busy}
            >
              {busy && step === 'publish' ? <Loader2 size={15} className="animate-spin" /> : null}
              {ctaLabel}
              {gateOk && step !== 'publish' && <ArrowRight size={15} strokeWidth={2.2} />}
              {gateOk && step === 'publish' && !busy && <Check size={16} strokeWidth={2.4} />}
            </button>
          </div>

          {/* ── Entry detail page (phone) — slides in over the wizard ── */}
          <AnimatePresence>
            {phoneMode && expandedEntryId && (() => {
              const idx = entries.findIndex((e) => e.id === expandedEntryId);
              const entry = idx >= 0 ? entries[idx] : null;
              if (!entry) return null;
              return (
                <motion.div
                  key="gcx-detail"
                  className="gcx-detail"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                >
                  <EntryDetail
                    entry={entry}
                    index={idx}
                    type={type}
                    onPatch={patchEntry}
                    onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
                    onClose={() => setExpandedEntryId(null)}
                  />
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* ── Published overlay ── */}
          <AnimatePresence>
            {publishedGuide && (
              <motion.div
                key="gcx-published"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="gcx-published"
              >
                <div className="gcx-published-badge">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 12.5l5 5L19.5 7" className="gcx-published-check" />
                  </svg>
                </div>
                <div className="gcx-published-title">
                  {initialGuide?.isPublished ? 'Changes saved' : 'Guide published'}
                </div>
                <div className="gcx-published-sub">
                  {publishedGuide.title || 'Your guide'}
                  {visibility === 'public' ? ' is live on Discover.' : ' is saved — visible only to you.'}
                </div>
                <div className="gcx-published-actions">
                  <button
                    type="button"
                    className="gcx-published-view"
                    onClick={() => { onClose(); navigate(`/guides/${publishedGuide.id}`); }}
                  >
                    View guide
                  </button>
                  <button type="button" className="gcx-published-done" onClick={onClose}>
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickCoverFile}
          />
        </motion.div>
      </motion.div>
      )}

      {/* Live Editor overlay — portals itself to document.body so it
          escapes the wizard's stacking context. Render conditionally so
          we don't pay the cost when it isn't open. */}
      {open && liveEditOpen && (
        <GuideLiveEditor
          open={liveEditOpen}
          data={liveEditData}
          authorProfile={authorProfile}
          onChange={applyEditorPatch}
          onClose={() => setLiveEditOpen(false)}
          onSave={onLiveEditSave}
        />
      )}
    </AnimatePresence>
  );
};
