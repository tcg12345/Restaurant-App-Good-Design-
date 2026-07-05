import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { supabaseConfigured } from '../lib/supabase';
import { loadUserData, saveRatings, saveLists, saveWishlistData, saveMetaData, saveUserData, saveRecentViews, saveTrips, saveHomeMeals, type UserAppData } from '../lib/supabase-db';
import { publishCommunityRating, removeCommunityRating, publishCommunityPhotos, removeCommunityPhotos, saveVisitRecord, deleteVisitRecord, deleteAllVisitRecordsForRestaurant, getVisitHistory, getUserRatings } from '../lib/supabase-community';
import { useAuth } from './AuthContext';
import { useSignInModal } from './SignInModalContext';
import { useToast } from './ToastContext';
import { safeImage } from '../lib/utils';
import { settleScores, applySettleChanges, type SettleChange } from '../lib/settleScores';

/* ── Types ── */

export interface PhotoItem {
  url: string;            // base64 data-url
  caption: string;        // dish name / description
  isFavorite: boolean;    // marked as favorite dish
}

export interface RestaurantRating {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  score: number;          // 0–10
  notes: string;
  visitDate: string;      // ISO date string
  wouldReturn: boolean;
  tags: string[];         // e.g. "Great cocktails", "Romantic", etc.
  photos: PhotoItem[];    // user-uploaded photos with captions
  favoriteDishes?: string[]; // dishes worth ordering — flows into guide entries
  listIds: string[];      // which lists this rating belongs to
  friendIds: string[];    // user IDs of friends who joined
  createdAt: number;      // timestamp
}

export interface RestaurantMeta {
  id: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  /** Geo coordinates — populated lazily when the user views the detail
   *  page. Optional so older rows / synced data still validate. Used by
   *  list cards to show distance from the user's anchor location. */
  lat?: number;
  lng?: number;
  /** Google Places v1 address components — populated when the user views
   *  the detail page. Used by formatLocationLabel() to render
   *  Beli-style "Neighborhood, Borough" / "Neighborhood, City, ST"
   *  display labels. Older rows fall back to parsing `address`. */
  addressComponents?: Array<{ longText: string; shortText: string; types: string[] }>;
  /** Mapbox-sourced neighborhood name (e.g. "West Village", "Mission",
   *  "Williamsburg"). Backfilled by the location enricher because
   *  Google's Places components don't include neighborhood data for
   *  most cities. */
  neighborhood?: string;
  /** Google Places weekday opening-hour descriptions
   *  (e.g. `"Monday: 10:00 AM – 10:00 PM"`). Backfilled by the location
   *  enricher alongside coordinates; empty array means we tried and the
   *  place doesn't publish hours. Cards read this to show today's hours
   *  inline. */
  hours?: string[];
}

export interface RecipeIngredient {
  name: string;
  amount: string;
  unit: string;
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  coverPhoto: string;       // base64 data-url
  prepTime: number;         // minutes
  cookTime: number;         // minutes
  servings: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  cuisine: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  photos: PhotoItem[];
  tags: string[];
  score: number;            // 0–10 rating
  isPrivate: boolean;
  createdAt: number;
  /** When this recipe was saved from another user's recipe, who
   *  originally authored it. Drives the "by @author" byline on cards.
   *  Unset for the user's own recipes. */
  sourceAuthorId?: string;
  sourceAuthorName?: string;
  sourceAuthorUsername?: string;
}

export interface CustomList {
  id: string;
  name: string;
  emoji: string;
  type?: 'default' | 'hotel-breakfast' | 'home-cooking'; // special list types
  restaurantIds: string[];   // rated restaurants
  wishlistIds: string[];     // wishlisted restaurants
  listRatings?: Record<string, RestaurantRating>; // per-list rating overrides keyed by restaurantId
  recipes?: Recipe[];        // home-cooking recipes
  createdAt: number;
}

export interface WishlistItem {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  notes: string;
  listIds: string[];         // which lists this wishlist item belongs to
  addedAt: number;
}

export interface TripRestaurant {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  night: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'drinks' | 'snack';
  rating?: RestaurantRating;
  notes?: string;
  reservationTime?: string;
  reservationConfirmation?: string;
  status: 'planned' | 'completed' | 'skipped';
}

export interface TripHotel {
  id: string;
  name: string;
  address: string;
  checkIn: string;
  checkOut: string;
  confirmationNumber?: string;
  starRating?: number;
  notes?: string;
  image?: string;
  placeId?: string;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  destinationLat: number;
  destinationLng: number;
  startDate: string;
  endDate: string;
  coverImage?: string;
  hotels: TripHotel[];
  restaurants: TripRestaurant[];
  notes?: string;
  status: 'planning' | 'active' | 'completed';
  createdAt: number;
}

export interface HomeMealDish {
  id: string;
  name: string;
  description: string;
  photo: string;           // base64 data-url
  recipeLink: string;      // optional URL
}

/** A named sub-group within an ingredient list — populated by the
 *  Advanced builder when the recipe wants "Sauce" / "Dough" sections. */
export interface RecipeIngredientGroup {
  name: string;
  ingredients: RecipeIngredient[];
}

/** Typed note rendered as a labeled callout on the recipe page.
 *  Different types use different accent colors so readers can scan. */
export interface RecipeNote {
  type: 'tip' | 'makeAhead' | 'substitution' | 'general';
  text: string;
}

/** Rich step shape with optional duration + tip. Advanced builder writes
 *  these; basic flat `steps[]` is still kept in sync for legacy consumers. */
export interface RecipeStepDetail {
  title?: string;
  body: string;
  durationMin?: number;
  tip?: string;
}

/** A named section within the method — a run of steps that belong to one
 *  component of the dish (e.g. "For the duxelles", "For the crêpes",
 *  "Assembly"). Mirrors RecipeIngredientGroup. The Advanced builder writes
 *  these; the flat `stepDetails[]` / `steps[]` are kept in sync so older
 *  consumers (cook mode, feed, search) keep rendering. */
export interface RecipeStepGroup {
  name: string;
  steps: RecipeStepDetail[];
}

/** A reference to another recipe attached to this one — a component
 *  sub-recipe like a sauce, dough, or side. Carries denormalized display
 *  data (title / cover / author) so cards render without a fetch; the
 *  id + ownerId pair routes to /recipe/{ownerId}/{id}, which resolves
 *  both home meals and formal recipes-table rows. */
export interface LinkedRecipeRef {
  id: string;
  /** Author user id — the routing prefix for the recipe page. */
  ownerId: string;
  /** Which store the recipe lives in ('homeMeal' = pantry / home_meals,
   *  'recipe' = the formal recipes table). Display-only hint. */
  source: 'homeMeal' | 'recipe';
  title: string;
  coverPhoto?: string;
  authorName?: string;
  totalTimeMin?: number;
  /** Placement on the recipe page: in the ingredients card, in the
   *  directions column, or both. At least one is always true. */
  inIngredients: boolean;
  inMethod: boolean;
}

export interface HomeMeal {
  id: string;
  name: string;
  date: string;            // ISO date string
  score: number;           // 0–10
  wouldMakeAgain: boolean;
  description: string;
  photos: PhotoItem[];
  tags: string[];
  dishes: HomeMealDish[];
  isPublic: boolean;
  createdAt: number;
  coverPhoto?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  cuisine?: string;
  ingredients?: RecipeIngredient[];
  steps?: string[];

  /* ── Advanced recipe builder fields (all optional). ─────────────
     Populated only when the user publishes via the Advanced tab.
     RecipePage prefers these when present and falls back to the
     legacy flat fields above so existing meals render unchanged. */
  /** One-line summary shown under the title on the recipe page. */
  summary?: string;
  /** Longer multi-paragraph intro shown in the recipe page body (the
   *  drop-cap "story" paragraph). Distinct from `summary` (the one-line
   *  byline) and from `description` (kept as the one-liner for card/feed
   *  previews). Falls back to `description` on the recipe page when blank. */
  introParagraph?: string;
  /** Meal courses, e.g. ['Dinner', 'Side']. Rendered as chips. */
  course?: string[];
  /** Rest / chill minutes, separate from prep + cook. */
  chillTime?: number;
  /** Free-text yield label, e.g. "4 generous bowls" or "12 cookies". */
  yieldDescription?: string;
  /** Grouped ingredient sections. When present and non-empty,
   *  supersedes the flat `ingredients` array for rendering. The
   *  Advanced publish path also dual-writes the flat list so older
   *  consumers (SocialFeed, Discover) keep working. */
  ingredientGroups?: RecipeIngredientGroup[];
  /** Tools / cookware the reader should have ready. */
  equipment?: string[];
  /** Labeled callouts (Chef's Tip, Make Ahead, etc.). */
  notes?: RecipeNote[];
  /** Per-step rich details (title, body, duration, tip). When present
   *  and non-empty, supersedes the flat `steps` array for rendering.
   *  Advanced publish also dual-writes the flat list. */
  stepDetails?: RecipeStepDetail[];
  /** Grouped method sections ("For the duxelles", "Assembly", …). When
   *  present and non-empty, supersedes the flat `stepDetails` for
   *  rendering — section subheadings are drawn between the (continuously
   *  numbered) steps. Advanced publish dual-writes the flat
   *  `stepDetails` / `steps` arrays so legacy consumers keep working. */
  stepGroups?: RecipeStepGroup[];
  /** Other recipes attached as components of this one (sauce / dough /
   *  side). Written by the Advanced builder; rendered on the recipe page
   *  inside the ingredients card and/or directions per each ref's flags. */
  linkedRecipes?: LinkedRecipeRef[];
  /** Which builder produced this meal. Used to force-route edits back
   *  to the Advanced tab so rich fields can round-trip safely. */
  builderVersion?: 'basic' | 'advanced';
  /** True when this recipe was drafted by the "Create with AI" generator
   *  (chat or Add Recipe modal). Drives the "Created with AI" note on the
   *  recipe page. Stays set after the user edits + publishes the draft. */
  createdWithAi?: boolean;
  /** When this meal was saved from another user's recipe, who
   *  originally authored it. Drives the "by @author" byline shown on
   *  cookbook / list / profile cards. Unset for the user's own meals. */
  sourceAuthorId?: string;
  sourceAuthorName?: string;
  sourceAuthorUsername?: string;
}

interface ListsContextValue {
  // Ratings
  ratings: RestaurantRating[];
  /** Add or replace this restaurant's "current" rating.
   *
   *  Pass `{ isNewVisit: true }` when the user is logging a fresh
   *  visit — that branch pushes the previously-current rating into
   *  visit history (locally and to Supabase) before the new rating
   *  takes its place. Without the flag (the default) the call is an
   *  in-place update: the current rating is replaced and no phantom
   *  visit record gets created. */
  rateRestaurant: (rating: RestaurantRating, options?: { isNewVisit?: boolean }) => void;
  updateRating: (restaurantId: string, rating: Partial<RestaurantRating>) => void;
  /** Apply a batch of settle-engine score changes in one persist/sync pass
   *  (the Reorder page's save). Each changed row is republished to the
   *  community feed (signed-in users only). */
  applySettledScores: (changes: SettleChange[]) => void;
  removeRating: (restaurantId: string) => void;
  getRating: (restaurantId: string) => RestaurantRating | undefined;
  /** Delete a single visit from the history timeline. If the visit
   *  being deleted is the current (active) rating, the newest prior
   *  visit is promoted to become the current rating — so the card
   *  above always reflects the user's most recent kept visit. */
  deleteVisit: (restaurantId: string, visitId: string) => void;

  // Custom lists
  lists: CustomList[];
  createList: (name: string, emoji: string, type?: CustomList['type']) => CustomList;
  deleteList: (id: string) => void;
  renameList: (id: string, name: string, emoji: string) => void;
  addToList: (listId: string, restaurantId: string) => void;
  removeFromList: (listId: string, restaurantId: string) => void;
  addToWishlistInList: (listId: string, restaurantId: string) => void;
  removeFromWishlistInList: (listId: string, restaurantId: string) => void;
  getListsForRestaurant: (restaurantId: string) => CustomList[];
  setListRating: (listId: string, rating: RestaurantRating) => void;
  getListRating: (listId: string, restaurantId: string) => RestaurantRating | undefined;

  // Restaurant metadata cache
  restaurantMeta: Record<string, RestaurantMeta>;
  cacheRestaurantMeta: (meta: Partial<RestaurantMeta> & { id: string }) => void;
  getRestaurantInfo: (restaurantId: string) => RestaurantMeta | undefined;
  /** Set an arbitrary key inside restaurantMeta and sync to cloud. Used by
   *  the review system to stash __my_meal_reviews__ through the context
   *  pipeline so it doesn't get overwritten by other meta syncs. */
  stashMetaKey: (key: string, value: unknown) => void;

  // Wishlist
  wishlist: WishlistItem[];
  addToWishlist: (item: WishlistItem) => void;
  removeFromWishlist: (restaurantId: string) => void;
  /** One-tap heart toggle. Adds the restaurant to the wishlist if it
   *  isn't there yet, removes it if it is. No list-selection UI. */
  toggleWishlist: (restaurant: RestaurantMeta) => void;
  isWishlisted: (restaurantId: string) => boolean;
  getWishlistItem: (restaurantId: string) => WishlistItem | undefined;

  // Modals
  ratingModalOpen: boolean;
  ratingModalRestaurant: RestaurantMeta | null;
  openRatingModal: (restaurant: RestaurantMeta) => void;
  closeRatingModal: () => void;

  addToListModalOpen: boolean;
  addToListRestaurantId: string | null;
  openAddToListModal: (restaurantId: string, meta?: RestaurantMeta) => void;
  closeAddToListModal: () => void;

  // Unified add restaurant modal (+ button → rating)
  addRestaurantModalOpen: boolean;
  addRestaurantModalMeta: RestaurantMeta | null;
  addRestaurantModalInitialPage: string | null;
  openAddRestaurantModal: (restaurant: RestaurantMeta, initialPage?: string) => void;
  closeAddRestaurantModal: () => void;

  // Wishlist modal (heart button)

  // Recipes (home-cooking lists)
  addRecipe: (listId: string, recipe: Recipe) => void;
  updateRecipe: (listId: string, recipeId: string, updates: Partial<Recipe>) => void;
  removeRecipe: (listId: string, recipeId: string) => void;
  getRecipes: (listId: string) => Recipe[];
  /** Save / unsave a recipe (by HomeMeal) to a home-cooking list, and
   *  query which lists already contain it. Used by the recipe detail
   *  page's Save button. */
  addRecipeToList: (listId: string, meal: HomeMeal) => void;
  /** Add to the built-in Cooked list without copying into the cookbook. */
  addRecipeToCookedList: (meal: HomeMeal) => void;
  /** Remove from the Cooked list and delete its private cook photos. */
  removeRecipeFromCookedList: (recipeId: string) => void;
  removeRecipeFromList: (listId: string, recipeId: string) => void;
  getListsForRecipe: (recipeId: string) => CustomList[];
  /** Save / un-save a recipe to the "All Recipes" cookbook pool
   *  (no sub-list). Used by the recipe detail page's Save sheet. */
  addRecipeToCookbook: (meal: HomeMeal) => void;
  removeRecipeFromCookbook: (recipeId: string) => void;

  // Add recipe modal
  addRecipeModalOpen: boolean;
  addRecipeModalListId: string | null;
  addRecipeModalRecipe: Recipe | null;
  openAddRecipeModal: (listId: string, recipe?: Recipe) => void;
  closeAddRecipeModal: () => void;

  // Trips
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

  // Custom ranking order
  customOrder: string[];
  setCustomOrder: (order: string[]) => void;


  // Home meals
  homeMeals: HomeMeal[];
  createHomeMeal: (meal: Omit<HomeMeal, 'id' | 'createdAt'>) => HomeMeal;
  createHomeMealsBulk: (meals: Array<Omit<HomeMeal, 'id' | 'createdAt'>>) => HomeMeal[];
  updateHomeMeal: (id: string, updates: Partial<HomeMeal>) => void;
  deleteHomeMeal: (id: string) => void;
  getHomeMeal: (id: string) => HomeMeal | undefined;

  // Home meal modal
  homeMealModalOpen: boolean;
  homeMealModalData: HomeMeal | null;
  /** When the modal was opened to fine-tune an AI draft, a callback to
   *  return to that draft preview. The Advanced builder shows a "Back
   *  to AI draft" button while it's set. */
  homeMealModalBackToDraft: (() => void) | null;
  openHomeMealModal: (meal?: HomeMeal, opts?: { onBackToDraft?: () => void }) => void;
  closeHomeMealModal: () => void;
}

const STORAGE_KEY_HOME_MEALS = 'gourmad-home-meals';
// Ids of cookbook recipes the user has deleted. The home-meals cloud sync is a
// union (local ∪ cloud) with no way to express a removal, so we keep an explicit
// tombstone set and subtract it from the union — otherwise a deleted recipe that
// still lingers in any store gets resurrected on the next load.
const STORAGE_KEY_DELETED_MEALS = 'gourmad-deleted-meals';
// Unified deletion tombstones for everything that lives in the user_app_data
// JSON blob (ratings, lists, list memberships, wishlist, trips). That blob is
// synced with a union+reconcile that can't express a removal, so without
// tombstones a deleted item lingering in any store (localStorage, the cloud
// row, or another device) gets resurrected — and a half-resurrected restaurant
// (id back in a list but its rating/meta gone) renders as a broken card. We
// persist the deleted keys here and subtract them on load. (Cookbook recipes
// use the separate STORAGE_KEY_DELETED_MEALS set above.)
const STORAGE_KEY_TOMBSTONES = 'gourmad-tombstones';
const STORAGE_KEY_RATINGS = 'gourmad-ratings';
const STORAGE_KEY_LISTS = 'gourmad-lists';
const STORAGE_KEY_WISHLIST = 'gourmad-wishlist';
const STORAGE_KEY_META = 'gourmad-restaurant-meta';
const STORAGE_KEY_TRIPS = 'gourmad-trips';
const STORAGE_KEY_CUSTOM_ORDER = 'gourmad-custom-order';
// Local-only mirror of the visit_history table so visit records
// persist even when Supabase is unavailable or the user isn't signed
// in yet. Keyed by restaurantId so the detail page can read it back.
const STORAGE_KEY_VISIT_HISTORY = 'gourmad-visit-history';

export interface LocalVisitRecord {
  id: string;
  restaurantId: string;
  score: number;
  notes: string;
  visit_date: string;
  tags: string[];
  would_return: boolean;
  photos: { url: string; caption: string; isFavorite: boolean }[];
  friend_ids: string[];
  created_at: string;
}

function loadLocalVisitHistory(): Record<string, LocalVisitRecord[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VISIT_HISTORY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function appendLocalVisitRecord(restaurantId: string, rec: Omit<LocalVisitRecord, 'id' | 'created_at' | 'restaurantId'>) {
  try {
    const all = loadLocalVisitHistory();
    const list = all[restaurantId] || [];
    const entry: LocalVisitRecord = {
      ...rec,
      restaurantId,
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
    };
    all[restaurantId] = [entry, ...list];
    localStorage.setItem(STORAGE_KEY_VISIT_HISTORY, JSON.stringify(all));
  } catch (err) { console.warn('[VisitHistory] appendLocal failed', err); }
}

/** Read local visit records for a restaurant (newest first). */
export function readLocalVisitHistory(restaurantId: string): LocalVisitRecord[] {
  const all = loadLocalVisitHistory();
  return all[restaurantId] || [];
}

/** Remove a single local visit record by id. No-op if the id isn't
 *  local (remote records are deleted through deleteVisitRecord). */
function removeLocalVisitRecord(restaurantId: string, visitId: string) {
  try {
    const all = loadLocalVisitHistory();
    const list = all[restaurantId] || [];
    const next = list.filter((r) => r.id !== visitId);
    if (next.length === list.length) return;
    if (next.length === 0) delete all[restaurantId];
    else all[restaurantId] = next;
    localStorage.setItem(STORAGE_KEY_VISIT_HISTORY, JSON.stringify(all));
  } catch (err) { console.warn('[VisitHistory] removeLocal failed', err); }
}

/** Wipe every local visit record for a restaurant. Paired with the
 *  remote `deleteAllVisitRecordsForRestaurant` so that removing the
 *  rating actually erases the history — otherwise the next time the
 *  user rates the place those old visits resurface in the timeline. */
function clearLocalVisitHistory(restaurantId: string) {
  try {
    const all = loadLocalVisitHistory();
    if (!(restaurantId in all)) return;
    delete all[restaurantId];
    localStorage.setItem(STORAGE_KEY_VISIT_HISTORY, JSON.stringify(all));
  } catch (err) { console.warn('[VisitHistory] clearLocal failed', err); }
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  // Swallow QuotaExceededError (and any other localStorage failures) so they
  // don't propagate out of setState updaters and crash the page render. The
  // cloud sync layer is the source of truth — local persistence is best-effort.
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Almost always QuotaExceededError: base64 image data-URLs (cover photos,
    // user photos) are the bloat that overruns the ~5MB cap. Retry with those
    // stripped — the rest of the entry (names, scores, ids, …) still persists
    // for instant first paint, and the images rehydrate from the cloud on the
    // next load. We only strip on failure, so images stay cached when they fit.
    try {
      localStorage.setItem(key, JSON.stringify(stripDataUrls(value)));
    } catch (err2) {
      console.warn(`[ListsContext] saveToStorage(${key}) failed even after stripping images:`, err2);
    }
  }
}

// Deep-clone `value`, replacing any base64 data-URL string with '' so a
// cached copy fits in localStorage. Leaves http(s) URLs and all other data
// intact. Used as the quota-overflow fallback in saveToStorage.
function stripDataUrls<T>(value: T): T {
  if (typeof value === 'string') {
    return (value.startsWith('data:') ? '' : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripDataUrls(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripDataUrls(v);
    return out as unknown as T;
  }
  return value;
}

/** Built-in "Want to Cook" recipe list — the recipe equivalent of the
 *  restaurant Wishlist. Auto-injected for every user, cannot be deleted
 *  or renamed. */
export const DEFAULT_WANT_TO_COOK_ID = 'default-want-to-cook';
export const DEFAULT_WANT_TO_COOK_NAME = 'Want to Cook';
export const DEFAULT_WANT_TO_COOK_EMOJI = '📌';

/** Built-in "Cooked" recipe list — recipes the user has marked as cooked
 *  (via the Mark-as-cooked button on the recipe page). Auto-injected,
 *  cannot be deleted or renamed. Recipes here can carry the user's own
 *  private cook photos. */
export const DEFAULT_COOKED_ID = 'default-cooked';
export const DEFAULT_COOKED_NAME = 'Cooked';
export const DEFAULT_COOKED_EMOJI = '🍳';

const buildDefaultWantToCookList = (): CustomList => ({
  id: DEFAULT_WANT_TO_COOK_ID,
  name: DEFAULT_WANT_TO_COOK_NAME,
  emoji: DEFAULT_WANT_TO_COOK_EMOJI,
  type: 'home-cooking',
  restaurantIds: [],
  wishlistIds: [],
  recipes: [],
  // 0 so it sorts before everything in chronological orderings.
  createdAt: 0,
});

const buildDefaultCookedList = (): CustomList => ({
  id: DEFAULT_COOKED_ID,
  name: DEFAULT_COOKED_NAME,
  emoji: DEFAULT_COOKED_EMOJI,
  type: 'home-cooking',
  restaurantIds: [],
  wishlistIds: [],
  recipes: [],
  createdAt: 1,
});

const DEFAULT_LISTS: CustomList[] = [
  buildDefaultWantToCookList(),
  { id: 'date-nights', name: 'Date Nights', emoji: '🕯️', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 4000 },
  { id: 'hidden-gems', name: 'Hidden Gems', emoji: '💎', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 3000 },
  { id: 'best-cocktails', name: 'Best Cocktails', emoji: '🍸', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 2000 },
  { id: 'quick-bites', name: 'Quick Bites', emoji: '⚡', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 1000 },
];

/** Guarantee the built-in "Want to Cook" and "Cooked" recipe lists exist in
 *  the array. Idempotent — if both are already there, returns the input
 *  unchanged so React reference equality is preserved. */
function ensureDefaultRecipeList(lists: CustomList[]): CustomList[] {
  if (!Array.isArray(lists)) return [buildDefaultWantToCookList(), buildDefaultCookedList()];
  let out = lists;
  if (!out.some((l) => l.id === DEFAULT_WANT_TO_COOK_ID)) out = [buildDefaultWantToCookList(), ...out];
  if (!out.some((l) => l.id === DEFAULT_COOKED_ID)) out = [...out, buildDefaultCookedList()];
  return out;
}

// Migration: add wishlistIds to lists that don't have it, and ensure the
// built-in Want to Cook list is present.
function migrateLists(lists: CustomList[]): CustomList[] {
  if (!Array.isArray(lists)) return DEFAULT_LISTS;
  const migrated = lists.map((l) => ({
    ...l,
    wishlistIds: l.wishlistIds ?? [],
  }));
  return ensureDefaultRecipeList(migrated);
}

// Strips stale Google Places photo URLs cached on RestaurantMeta entries
// before photo fetching was disabled — see migrateRatings comment.
//
// Pass through any "__"-prefixed keys unmodified — those are stash slots
// for fallback data (home meals, trips, custom order, my-meal-reviews)
// stored *inside* restaurant_meta. They aren't real RestaurantMeta
// entries, so applying the {...v, image: safeImage(v.image)} treatment
// would corrupt them — for example, spreading a HomeMeal[] array into
// an object literal turns it into {0: meal0, 1: meal1, …, image: undef},
// which Array.isArray() then rejects on the next load and the fallback
// silently returns []. That's how home cooking entries used to vanish
// after the meta JSONB got rewritten for any other reason.
function migrateMeta(meta: Record<string, RestaurantMeta> | null | undefined): Record<string, RestaurantMeta> {
  if (!meta || typeof meta !== 'object') return {};
  const out: Record<string, RestaurantMeta> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v == null) continue;
    if (k.startsWith('__')) {
      // Stash slot — preserve the value as-is.
      out[k] = v as RestaurantMeta;
      continue;
    }
    if (typeof v === 'object') out[k] = { ...v, image: safeImage(v.image) };
  }
  return out;
}

// Migration: add listIds, photos to ratings that don't have them. Also strips
// stale Google Places photo URLs cached before photo fetching was disabled —
// rendering them would trigger a billed Google API call per image.
function migrateRatings(ratings: RestaurantRating[]): RestaurantRating[] {
  if (!Array.isArray(ratings)) return [];
  return ratings.map((r) => ({
    ...r,
    image: safeImage(r.image),
    listIds: r.listIds ?? [],
    friendIds: r.friendIds ?? [],
    photos: (r.photos ?? []).map((p: PhotoItem | string) =>
      typeof p === 'string' ? { url: p, caption: '', isFavorite: false } : p
    ),
  }));
}

// Migration: ensure every home meal has a unique id. A previous version of
// Convert a Recipe (stored inside a recipe sub-list) to a HomeMeal so it
// can live in the "All Recipes" cookbook pool too. The Recipe is the
// ── Deletion tombstones ──
// One set per deletable entity that lives in the user_app_data blob. `members`
// is keyed by `${listId}::${restaurantId}` to represent "removed from this one
// list" (vs. `restaurants`, which means the rating was deleted everywhere).
interface Tombstones {
  restaurants: Set<string>;
  lists: Set<string>;
  members: Set<string>;
  wishlist: Set<string>;
  trips: Set<string>;
}
const TOMBSTONE_CATS = ['restaurants', 'lists', 'members', 'wishlist', 'trips'] as const;
function newTombstones(): Tombstones {
  return { restaurants: new Set(), lists: new Set(), members: new Set(), wishlist: new Set(), trips: new Set() };
}
function tombstonesToJSON(t: Tombstones): Record<string, string[]> {
  return {
    restaurants: [...t.restaurants], lists: [...t.lists], members: [...t.members],
    wishlist: [...t.wishlist], trips: [...t.trips],
  };
}
function tombstonesFromJSON(o: unknown): Tombstones {
  const t = newTombstones();
  if (o && typeof o === 'object') {
    for (const cat of TOMBSTONE_CATS) {
      const arr = (o as Record<string, unknown>)[cat];
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string') t[cat].add(v);
    }
  }
  return t;
}
/** Merge `src` into `dst`; returns true if `dst` gained any new entries. */
function mergeTombstones(dst: Tombstones, src: Tombstones): boolean {
  let grew = false;
  for (const cat of TOMBSTONE_CATS) {
    for (const v of src[cat]) if (!dst[cat].has(v)) { dst[cat].add(v); grew = true; }
  }
  return grew;
}
function memberKey(listId: string, restaurantId: string): string {
  return `${listId}::${restaurantId}`;
}

// source of truth; the HomeMeal is a mirror that shares its id.
export function recipeToHomeMeal(r: Recipe): HomeMeal {
  return {
    id: r.id,
    name: r.title,
    date: new Date(r.createdAt || Date.now()).toISOString().slice(0, 10),
    score: r.score ?? 0,
    wouldMakeAgain: (r.score ?? 0) >= 7,
    description: r.description ?? '',
    photos: r.photos ?? [],
    tags: r.tags ?? [],
    dishes: [],
    isPublic: !r.isPrivate,
    createdAt: r.createdAt || Date.now(),
    coverPhoto: r.coverPhoto,
    prepTime: r.prepTime,
    cookTime: r.cookTime,
    servings: r.servings,
    difficulty: r.difficulty,
    cuisine: r.cuisine,
    ingredients: r.ingredients,
    steps: r.steps,
    sourceAuthorId: r.sourceAuthorId,
    sourceAuthorName: r.sourceAuthorName,
    sourceAuthorUsername: r.sourceAuthorUsername,
  };
}

// Inverse of recipeToHomeMeal: collapse a HomeMeal into the lighter
// list-Recipe shape stored on home-cooking lists. Rich advanced fields
// (ingredientGroups / stepDetails / notes / equipment) don't exist on
// the list-Recipe type — they stay on the canonical HomeMeal in the
// "All Recipes" pool, which is what the detail page reads. The list
// only needs enough to render its card (title, cuisine, time, score).
function homeMealToRecipe(m: HomeMeal): Recipe {
  return {
    id: m.id,
    title: m.name || '',
    description: m.summary || m.description || '',
    coverPhoto: m.coverPhoto || '',
    prepTime: m.prepTime ?? 0,
    cookTime: m.cookTime ?? 0,
    servings: m.servings ?? 0,
    difficulty: m.difficulty || 'Medium',
    cuisine: m.cuisine || '',
    ingredients: m.ingredients || [],
    steps: m.steps || [],
    photos: m.photos || [],
    tags: m.tags || [],
    score: m.score ?? 0,
    isPrivate: !m.isPublic,
    createdAt: m.createdAt || Date.now(),
    sourceAuthorId: m.sourceAuthorId,
    sourceAuthorName: m.sourceAuthorName,
    sourceAuthorUsername: m.sourceAuthorUsername,
  };
}

// Field-level translation for recipe updates so we don't clobber HomeMeal-
// only fields when the user edits a Recipe. Skip Recipe-only fields like
// isPrivate (handled separately) or absent fields.
function recipeUpdatesToHomeMeal(u: Partial<Recipe>): Partial<HomeMeal> {
  const out: Partial<HomeMeal> = {};
  if (u.title !== undefined) out.name = u.title;
  if (u.description !== undefined) out.description = u.description;
  if (u.coverPhoto !== undefined) out.coverPhoto = u.coverPhoto;
  if (u.prepTime !== undefined) out.prepTime = u.prepTime;
  if (u.cookTime !== undefined) out.cookTime = u.cookTime;
  if (u.servings !== undefined) out.servings = u.servings;
  if (u.difficulty !== undefined) out.difficulty = u.difficulty;
  if (u.cuisine !== undefined) out.cuisine = u.cuisine;
  if (u.ingredients !== undefined) out.ingredients = u.ingredients;
  if (u.steps !== undefined) out.steps = u.steps;
  if (u.photos !== undefined) out.photos = u.photos;
  if (u.tags !== undefined) out.tags = u.tags;
  if (u.score !== undefined) out.score = u.score;
  if (u.isPrivate !== undefined) out.isPublic = !u.isPrivate;
  return out;
}

// createHomeMeal used `meal-${Date.now()}` which collides when called in a
// tight loop (bulk import), so old data may have many meals sharing one id —
// breaking detail navigation and dedupe. Re-id the duplicates so each row is
// reachable again.
function migrateHomeMeals(meals: HomeMeal[]): HomeMeal[] {
  if (!Array.isArray(meals)) return [];
  const seen = new Set<string>();
  return meals.map((m) => {
    if (!m?.id || seen.has(m.id)) {
      const uniq = `meal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      seen.add(uniq);
      return { ...m, id: uniq };
    }
    seen.add(m.id);
    return m;
  });
}

// Migration: add notes, listIds to wishlist items that don't have them. Also
// strips stale Google Places photo URLs (see migrateRatings above).
function migrateWishlist(items: WishlistItem[]): WishlistItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((w) => ({
    ...w,
    image: safeImage(w.image),
    notes: w.notes ?? '',
    listIds: w.listIds ?? [],
  }));
}

const ListsContext = createContext<ListsContextValue | null>(null);

export const ListsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, profile: authProfile } = useAuth();
  const { showToast } = useToast();
  const { requireSignIn } = useSignInModal();
  const userId = user?.id ?? null;

  const [ratings, setRatings] = useState<RestaurantRating[]>(() => migrateRatings(loadFromStorage(STORAGE_KEY_RATINGS, [])));
  const [lists, setLists] = useState<CustomList[]>(() => migrateLists(loadFromStorage(STORAGE_KEY_LISTS, DEFAULT_LISTS)));
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => migrateWishlist(loadFromStorage(STORAGE_KEY_WISHLIST, [])));
  const [restaurantMeta, setRestaurantMeta] = useState<Record<string, RestaurantMeta>>(() => migrateMeta(loadFromStorage(STORAGE_KEY_META, {})));
  const [trips, setTrips] = useState<Trip[]>(() => loadFromStorage(STORAGE_KEY_TRIPS, []));
  const [customOrder, setCustomOrderState] = useState<string[]>(() => loadFromStorage(STORAGE_KEY_CUSTOM_ORDER, []));
  const [homeMeals, setHomeMeals] = useState<HomeMeal[]>(() => migrateHomeMeals(loadFromStorage(STORAGE_KEY_HOME_MEALS, [])));
  const [cloudLoaded, setCloudLoaded] = useState(false);
  // True only after a cloud load FAILED (timeout/network). While set, we must
  // not push the full home-meals array to the cloud — the in-memory set may be
  // incomplete and would clobber the stored recipes. localStorage keeps the
  // change; the next successful load unions + backfills it.
  const cloudLoadFailedRef = useRef(false);
  // True only AFTER the initial cloud load for the current user has SUCCEEDED.
  // Until then — while the load is in flight, or after it failed — we must not
  // push local state to the cloud: doing so races the load and overwrites the
  // server copy with whatever incomplete snapshot this origin happens to have.
  // That's how recipes vanished: every new Vercel preview URL is a fresh origin
  // with EMPTY localStorage, so an early meta write (rating a place, caching
  // restaurant meta, …) clobbered restaurant_meta — wiping the __home_meals__
  // recipe stash — before loadUserData could read it. localStorage still saves
  // locally; the next successful load unions local + cloud and backfills.
  const cloudReadyRef = useRef(false);
  // Deletion tombstones for the "All Recipes" cookbook. Subtracted from the
  // home-meals union at load time so a delete sticks even though the recipe may
  // still be sitting in localStorage, the home_meals column, or the
  // __home_meals__ meta stash. Persisted to localStorage + the durable
  // __deleted_meals__ meta stash; cleared when the same id is re-added and on
  // user switch. Loaded lazily so we only touch localStorage once.
  const deletedMealIdsRef = useRef<Set<string>>(new Set());
  const deletedMealsLoadedRef = useRef(false);
  if (!deletedMealsLoadedRef.current) {
    deletedMealsLoadedRef.current = true;
    for (const id of loadFromStorage<string[]>(STORAGE_KEY_DELETED_MEALS, [])) {
      deletedMealIdsRef.current.add(id);
    }
  }
  // Unified tombstones for restaurants / lists / list-memberships / wishlist /
  // trips (see STORAGE_KEY_TOMBSTONES). Loaded lazily from localStorage; merged
  // with the cloud copy and applied in the load reconciliation below.
  const tombstonesRef = useRef<Tombstones>(newTombstones());
  const tombstonesLoadedRef = useRef(false);
  if (!tombstonesLoadedRef.current) {
    tombstonesLoadedRef.current = true;
    mergeTombstones(tombstonesRef.current, tombstonesFromJSON(loadFromStorage(STORAGE_KEY_TOMBSTONES, null)));
  }

  // Track userId and profile for cloud save helpers
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const isPublicRef = useRef(authProfile?.is_public ?? true);
  isPublicRef.current = authProfile?.is_public ?? true;

  // ── Load data from Supabase when user signs in ──
  useEffect(() => {
    // Block all cloud writes until THIS user's data has been loaded once.
    cloudReadyRef.current = false;
    if (!userId || !supabaseConfigured) {
      if (!supabaseConfigured) console.warn('[Supabase] Not configured — data will only be in localStorage');
      return;
    }

    // Check if localStorage belongs to a different user — if so, clear it
    const storedUserId = localStorage.getItem('gourmad-user-id');
    if (storedUserId && storedUserId !== userId) {
      localStorage.removeItem(STORAGE_KEY_RATINGS);
      localStorage.removeItem(STORAGE_KEY_LISTS);
      localStorage.removeItem(STORAGE_KEY_WISHLIST);
      localStorage.removeItem(STORAGE_KEY_META);
      localStorage.removeItem(STORAGE_KEY_TRIPS);
      localStorage.removeItem(STORAGE_KEY_CUSTOM_ORDER);
      localStorage.removeItem(STORAGE_KEY_HOME_MEALS);
      localStorage.removeItem(STORAGE_KEY_DELETED_MEALS);
      localStorage.removeItem(STORAGE_KEY_TOMBSTONES);
      localStorage.removeItem('gourmad-recent-views');
      // Reset state to empty
      setRatings([]);
      setLists(DEFAULT_LISTS);
      setWishlist([]);
      setRestaurantMeta({});
      setTrips([]);
      setCustomOrderState([]);
      setHomeMeals([]);
      deletedMealIdsRef.current = new Set();
      tombstonesRef.current = newTombstones();
    }
    try { localStorage.setItem('gourmad-user-id', userId); } catch { /* quota — best-effort */ }

    let cancelled = false;

    (async () => {
      let cloud: UserAppData | null;
      try {
        cloud = await loadUserData(userId);
      } catch (err) {
        if (cancelled) return;
        // The cloud load failed/timed out. Do NOT treat this as an empty
        // account — pushing local (often empty) to the cloud here is exactly
        // what wiped users' recipes. Keep whatever's already in local state
        // and leave the cloud untouched; a later reload will load it.
        console.warn('[Lists] Cloud load failed; keeping local data and not overwriting the cloud.', err);
        cloudLoadFailedRef.current = true;
        setCloudLoaded(true);
        return;
      }
      if (cancelled) return;

      if (cloud) {
        // Cloud row found — use cloud data, merging with any local data that might be newer
        const localRatings = loadFromStorage<RestaurantRating[]>(STORAGE_KEY_RATINGS, []);
        const localLists = loadFromStorage<CustomList[]>(STORAGE_KEY_LISTS, []);
        const localWishlist = loadFromStorage<WishlistItem[]>(STORAGE_KEY_WISHLIST, []);
        const localHomeMeals = loadFromStorage<HomeMeal[]>(STORAGE_KEY_HOME_MEALS, []);

        // If both cloud and local ratings are empty, try to recover from community_ratings
        // (published ratings survive even if user_app_data.ratings got wiped).
        let recoveredRatings: RestaurantRating[] = [];
        if (cloud.ratings.length === 0 && localRatings.length === 0) {
          try {
            const communityRows = await getUserRatings(userId);
            if (communityRows.length > 0) {
              recoveredRatings = communityRows.map((r) => ({
                restaurantId: r.restaurant_id,
                name: r.restaurant_name,
                image: r.photo_url || '',
                cuisine: r.cuisine || '',
                price: r.price || '',
                address: r.address || '',
                score: Number(r.score) || 0,
                notes: r.notes || '',
                visitDate: r.visit_date || '',
                wouldReturn: r.would_return ?? true,
                tags: r.tags || [],
                photos: [],
                listIds: [],
                friendIds: r.friend_ids || [],
                createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
              }));
            }
          } catch (err) { console.warn('[Supabase] community_ratings recovery failed:', err); }
        }

        // Use cloud data, but if cloud is empty and local has content, keep local
        let cloudRatings = migrateRatings(
          cloud.ratings.length > 0 ? cloud.ratings : localRatings.length > 0 ? localRatings : recoveredRatings
        );
        const baseCloudLists = migrateLists(
          cloud.lists.length > 0 ? cloud.lists : localLists.length > 0 ? localLists : DEFAULT_LISTS
        );
        // Top-level pick (cloud or local) used to silently wipe anything
        // local had that cloud didn't — recipes added to a list right
        // before close, restaurants just dropped into a wishlist, even
        // entire lists created on this device but never synced. Merge
        // local additions in by id so a slightly-stale cloud snapshot
        // can't erase work the user already saw committed locally.
        const cloudLists = (() => {
          const localById = new Map<string, CustomList>(
            (localLists as CustomList[]).map((l) => [l.id, l]),
          );
          const merged = baseCloudLists.map((cl) => {
            const ll = localById.get(cl.id);
            if (!ll) return cl;
            const cloudRecipeIds = new Set((cl.recipes || []).map((r) => r.id));
            const localOnlyRecipes = (ll.recipes || []).filter((r) => r && r.id && !cloudRecipeIds.has(r.id));
            const cloudRestaurantIds = new Set(cl.restaurantIds || []);
            const localOnlyRestaurantIds = (ll.restaurantIds || []).filter((id) => id && !cloudRestaurantIds.has(id));
            const cloudWishlistIds = new Set(cl.wishlistIds || []);
            const localOnlyWishlistIds = (ll.wishlistIds || []).filter((id) => id && !cloudWishlistIds.has(id));
            if (localOnlyRecipes.length === 0 && localOnlyRestaurantIds.length === 0 && localOnlyWishlistIds.length === 0) {
              return cl;
            }
            return {
              ...cl,
              recipes: localOnlyRecipes.length > 0
                ? [...(cl.recipes || []), ...localOnlyRecipes]
                : cl.recipes,
              restaurantIds: localOnlyRestaurantIds.length > 0
                ? [...(cl.restaurantIds || []), ...localOnlyRestaurantIds]
                : cl.restaurantIds,
              wishlistIds: localOnlyWishlistIds.length > 0
                ? [...(cl.wishlistIds || []), ...localOnlyWishlistIds]
                : cl.wishlistIds,
            };
          });
          // Local-only lists (created before sync completed) are appended
          // so the user doesn't lose a freshly-created list on reload.
          const baseIds = new Set(baseCloudLists.map((l) => l.id));
          const localOnlyLists = (localLists as CustomList[]).filter((l) => l && l.id && !baseIds.has(l.id));
          return [...merged, ...localOnlyLists];
        })();
        // Track whether the merge actually rescued anything — if so we
        // need to push the unioned set back to the cloud so subsequent
        // reloads see it without relying on local cache again.
        const listsMergedFromLocal = cloudLists.length !== baseCloudLists.length
          || cloudLists.some((l, i) => l !== baseCloudLists[i]);
        let cloudWishlist = migrateWishlist(
          cloud.wishlist.length > 0 ? cloud.wishlist : localWishlist.length > 0 ? localWishlist : []
        );
        const cloudMeta = cloud.restaurantMeta || {};
        // Restore trips: try dedicated column first, fall back to __trips__ in meta
        let cloudTrips: Trip[] = ((cloud as any).trips && (cloud as any).trips.length > 0)
          ? (cloud as any).trips
          : (Array.isArray((cloudMeta as any).__trips__) ? (cloudMeta as any).__trips__ : []);
        const cloudRecentViews = cloud.recentViews || [];
        // Restore custom order from meta
        let cloudCustomOrder = Array.isArray((cloudMeta as any).__custom_order__) ? (cloudMeta as any).__custom_order__ as string[] : [];

        // ── Merge + apply unified deletion tombstones ──
        // Pull the cloud's tombstone stash, union it into this device's set, and
        // persist the merged result. Then strip every tombstoned entity from the
        // resolved data so a deletion can't be resurrected by a stale copy in
        // any store. `members` (listId::restaurantId) also clears the matching
        // rating.listIds so the list reconciliation below won't re-add it.
        const tomb = tombstonesRef.current;
        const cloudTomb = tombstonesFromJSON((cloudMeta as Record<string, unknown>).__tombstones__);
        const tombGrew = mergeTombstones(tomb, cloudTomb);
        saveToStorage(STORAGE_KEY_TOMBSTONES, tombstonesToJSON(tomb));
        const cloudTombHadFewer =
          TOMBSTONE_CATS.reduce((n, c) => n + cloudTomb[c].size, 0)
          !== TOMBSTONE_CATS.reduce((n, c) => n + tomb[c].size, 0);
        const memberDeleted = (listId: string, rid: string) => tomb.members.has(memberKey(listId, rid));

        const ratingsBeforeTomb = cloudRatings.length;
        cloudRatings = cloudRatings
          .filter((r) => !tomb.restaurants.has(r.restaurantId))
          .map((r) => {
            const keptListIds = r.listIds.filter((lid) => !tomb.lists.has(lid) && !memberDeleted(lid, r.restaurantId));
            return keptListIds.length === r.listIds.length ? r : { ...r, listIds: keptListIds };
          });
        cloudWishlist = cloudWishlist
          .filter((w) => !tomb.wishlist.has(w.restaurantId))
          .map((w) => {
            const keptListIds = w.listIds.filter((lid) => !tomb.lists.has(lid) && !memberDeleted(lid, w.restaurantId));
            return keptListIds.length === w.listIds.length ? w : { ...w, listIds: keptListIds };
          });
        cloudTrips = cloudTrips.filter((t) => !tomb.trips.has(t.id));
        cloudCustomOrder = cloudCustomOrder.filter((id) => !tomb.restaurants.has(id));
        let tombstonesRemovedData = cloudRatings.length !== ratingsBeforeTomb;

        // ── Restore visit history from the durable stash ──
        // The dedicated `visit_history` table isn't present on every deployment
        // (it errors with PGRST205), so visit records are mirrored into
        // restaurant_meta.__visit_history__. Merge the cloud stash with this
        // device's localStorage blob (by record id, per restaurant) and write
        // it back to localStorage so the detail page — which seeds history from
        // local — shows it after a reload, a new deploy, or on another device.
        const rawCloudVisitHistory = (cloudMeta as Record<string, unknown>).__visit_history__;
        const cloudVisitHistory: Record<string, LocalVisitRecord[]> =
          rawCloudVisitHistory && typeof rawCloudVisitHistory === 'object' && !Array.isArray(rawCloudVisitHistory)
            ? (rawCloudVisitHistory as Record<string, LocalVisitRecord[]>)
            : {};
        const localVisitHistory = loadLocalVisitHistory();
        const mergedVisitHistory: Record<string, LocalVisitRecord[]> = {};
        for (const rid of new Set([...Object.keys(localVisitHistory), ...Object.keys(cloudVisitHistory)])) {
          const byId = new Map<string, LocalVisitRecord>();
          for (const rec of (cloudVisitHistory[rid] || [])) if (rec && rec.id) byId.set(rec.id, rec);
          for (const rec of (localVisitHistory[rid] || [])) if (rec && rec.id) byId.set(rec.id, rec);
          const arr = Array.from(byId.values());
          if (arr.length) mergedVisitHistory[rid] = arr;
        }
        saveToStorage(STORAGE_KEY_VISIT_HISTORY, mergedVisitHistory);
        const cloudVHCount = Object.values(cloudVisitHistory).reduce((n, a) => n + (a?.length || 0), 0);
        const mergedVHCount = Object.values(mergedVisitHistory).reduce((n, a) => n + a.length, 0);
        const visitHistoryStale = mergedVHCount !== cloudVHCount;
        // Home meals recovery order:
        //   1. dedicated home_meals column (may be missing on some schemas)
        //   2. restaurant_meta.__home_meals__ fallback (always works)
        //   3. localStorage (in case both cloud locations are empty)
        const rawCloudHomeMeals = cloud.homeMeals || [];
        const metaHomeMeals = Array.isArray((cloudMeta as Record<string, unknown>).__home_meals__)
          ? ((cloudMeta as Record<string, unknown>).__home_meals__ as HomeMeal[])
          : [];
        // Pick the strongest available source first (column → meta → local),
        // then *union* with localStorage so freshly-created entries that
        // haven't yet round-tripped to the cloud aren't wiped out by an
        // older cloud snapshot. Cloud wins on id conflicts (so an edit on
        // another device beats a stale local copy); brand-new local-only
        // entries survive.
        const baseCloudHomeMeals: HomeMeal[] = rawCloudHomeMeals.length > 0
          ? rawCloudHomeMeals
          : metaHomeMeals.length > 0
            ? metaHomeMeals
            : [];
        const mergedById = new Map<string, HomeMeal>();
        for (const m of localHomeMeals) if (m && m.id) mergedById.set(m.id, m);
        for (const m of baseCloudHomeMeals) if (m && m.id) mergedById.set(m.id, m);

        // ── Apply deletion tombstones ──
        // The merge above is a pure union and can't represent a removal: a
        // deleted recipe still present in localStorage, the home_meals column,
        // or the __home_meals__ meta stash would be resurrected here. Subtract
        // the tombstoned ids — this device's localStorage set unioned with the
        // durable __deleted_meals__ meta stash — so deletes stick and converge
        // across devices, then write the merged set back to both stores below.
        const cloudDeletedIds = Array.isArray((cloudMeta as Record<string, unknown>).__deleted_meals__)
          ? ((cloudMeta as Record<string, unknown>).__deleted_meals__ as string[])
          : [];
        const mergedDeletedIds = new Set<string>(deletedMealIdsRef.current);
        for (const id of cloudDeletedIds) if (id) mergedDeletedIds.add(id);
        deletedMealIdsRef.current = mergedDeletedIds;
        saveToStorage(STORAGE_KEY_DELETED_MEALS, Array.from(mergedDeletedIds));

        const unionedHomeMeals = migrateHomeMeals(Array.from(mergedById.values()));
        const cloudHomeMeals = mergedDeletedIds.size > 0
          ? unionedHomeMeals.filter((m) => !mergedDeletedIds.has(m.id))
          : unionedHomeMeals;
        // Re-push when the union actually contained tombstoned rows (cloud still
        // had them) or the cloud's tombstone list is behind this device's, so
        // the deletion lands in the always-present home_meals/meta columns.
        const tombstonesRemovedSomething = cloudHomeMeals.length !== unionedHomeMeals.length;
        const cloudTombstonesStale = cloudDeletedIds.length !== mergedDeletedIds.size;
        // We need to push back to cloud whenever local had something cloud
        // didn't — that's how the unioned set lands in the dedicated column.
        const localOnlyIds = localHomeMeals.filter((m) => m && m.id && !baseCloudHomeMeals.some((c) => c.id === m.id));
        const homeMealsUsedLocalFallback = localOnlyIds.length > 0
          || (rawCloudHomeMeals.length === 0 && metaHomeMeals.length === 0 && localHomeMeals.length > 0);

        // Reconcile: ensure every rating's listIds are reflected in
        // list.restaurantIds (fixes data drift where ratings exist but
        // lists lost their restaurantIds references).
        const reconciledLists = cloudLists.map((l) => {
          const missing = cloudRatings
            .filter((r) => r.listIds.includes(l.id) && !l.restaurantIds.includes(r.restaurantId))
            .map((r) => r.restaurantId);
          return missing.length > 0
            ? { ...l, restaurantIds: [...l.restaurantIds, ...missing] }
            : l;
        });
        const listsChanged = reconciledLists.some((l, i) => l !== cloudLists[i]);

        // Strip tombstoned lists + memberships from the reconciled set so a
        // deleted list, a restaurant removed from one list, or a deleted
        // cookbook recipe can't survive inside the lists blob.
        const listsBeforeTomb = listsChanged ? reconciledLists : cloudLists;
        const finalLists = listsBeforeTomb
          .filter((l) => !tomb.lists.has(l.id))
          .map((l) => {
            const restaurantIds = (l.restaurantIds || []).filter((id) => !tomb.restaurants.has(id) && !memberDeleted(l.id, id));
            const wishlistIds = (l.wishlistIds || []).filter((id) => !tomb.wishlist.has(id) && !memberDeleted(l.id, id));
            const recipes = (l.recipes || []).filter((r) => !(r && r.id && (mergedDeletedIds.has(r.id) || memberDeleted(l.id, r.id))));
            const changed = restaurantIds.length !== (l.restaurantIds?.length || 0)
              || wishlistIds.length !== (l.wishlistIds?.length || 0)
              || recipes.length !== (l.recipes?.length || 0);
            return changed ? { ...l, restaurantIds, wishlistIds, recipes } : l;
          });
        if (finalLists.length !== listsBeforeTomb.length
            || finalLists.some((l, i) => l !== listsBeforeTomb[i])) {
          tombstonesRemovedData = true;
        }

        // Carry the home-meals union + every tombstone stash inside the durable
        // restaurant_meta blob so they persist on schemas without dedicated
        // columns and converge across devices.
        const cloudMetaWithMeals = {
          ...migrateMeta(cloudMeta),
          __home_meals__: cloudHomeMeals as unknown as RestaurantMeta,
          __deleted_meals__: Array.from(mergedDeletedIds) as unknown as RestaurantMeta,
          __tombstones__: tombstonesToJSON(tomb) as unknown as RestaurantMeta,
          __visit_history__: mergedVisitHistory as unknown as RestaurantMeta,
        };

        setRatings(cloudRatings);
        setLists(ensureDefaultRecipeList(finalLists));
        setWishlist(cloudWishlist);
        setRestaurantMeta(cloudMetaWithMeals);
        setTrips(cloudTrips as Trip[]);
        setCustomOrderState(cloudCustomOrder);
        setHomeMeals(cloudHomeMeals);

        // Also update localStorage as cache
        saveToStorage(STORAGE_KEY_RATINGS, cloudRatings);
        saveToStorage(STORAGE_KEY_LISTS, finalLists);
        saveToStorage(STORAGE_KEY_WISHLIST, cloudWishlist);
        saveToStorage(STORAGE_KEY_META, cloudMetaWithMeals);
        saveToStorage(STORAGE_KEY_TRIPS, cloudTrips);
        saveToStorage(STORAGE_KEY_CUSTOM_ORDER, cloudCustomOrder);
        saveToStorage(STORAGE_KEY_HOME_MEALS, cloudHomeMeals);
        if (cloudRecentViews.length > 0) {
          try { localStorage.setItem('gourmad-recent-views', JSON.stringify(cloudRecentViews)); } catch { /* quota — best-effort */ }
        }

        // If we used local fallback data (cloud was empty but local had
        // content), reconciled, merged local-only list contents into cloud
        // lists, or stripped any tombstoned entity, push the cleaned union back
        // so subsequent reloads (and other devices) see it.
        // Also re-persist when the durable __home_meals__ stash is out of sync
        // with the resolved union, so recipes are backed up into a column that
        // is always present (covers schemas missing the home_meals column).
        const metaStashStale = metaHomeMeals.length !== cloudHomeMeals.length;
        if ((cloud.ratings.length === 0 && cloudRatings.length > 0) || listsChanged || listsMergedFromLocal || homeMealsUsedLocalFallback || metaStashStale || tombstonesRemovedSomething || cloudTombstonesStale || tombGrew || tombstonesRemovedData || cloudTombHadFewer || visitHistoryStale) {
          await saveUserData(userId, { ratings: cloudRatings, lists: finalLists, wishlist: cloudWishlist, restaurantMeta: cloudMetaWithMeals, recentViews: cloudRecentViews, trips: cloudTrips as Trip[], homeMeals: cloudHomeMeals });
        }

        // Sync all ratings to community_ratings (ensures they're visible on user profiles)
        if (cloudRatings.length > 0) {
          for (const r of cloudRatings) {
            publishCommunityRating(userId, r.restaurantId, {
              name: r.name, score: r.score, notes: r.notes,
              cuisine: r.cuisine, price: r.price, address: r.address,
              visitDate: r.visitDate, tags: r.tags, wouldReturn: r.wouldReturn,
              friendIds: r.friendIds || [], photoUrl: r.image || '',
            });
            if (r.photos && r.photos.length > 0 && isPublicRef.current) {
              publishCommunityPhotos(userId, r.restaurantId, r.photos).catch(() => {});
            } else if (!r.photos || r.photos.length === 0) {
              // Self-heal: clear gallery rows for ratings whose photos were
              // removed before reconciliation existed (or on another
              // device). Deliberately NOT keyed on isPublic here — the
              // profile may not be loaded yet at boot, and removing
              // photo-less ratings' rows is safe regardless.
              removeCommunityPhotos(userId, r.restaurantId);
            }
          }
        }
      } else {
        // No cloud row exists — keep any existing local data and push it to cloud
        const localRatings = migrateRatings(loadFromStorage<RestaurantRating[]>(STORAGE_KEY_RATINGS, []));
        const localLists = migrateLists(loadFromStorage<CustomList[]>(STORAGE_KEY_LISTS, DEFAULT_LISTS));
        const localWishlist = migrateWishlist(loadFromStorage<WishlistItem[]>(STORAGE_KEY_WISHLIST, []));
        const localMeta = migrateMeta(loadFromStorage<Record<string, RestaurantMeta>>(STORAGE_KEY_META, {}));
        const localTrips = loadFromStorage<Trip[]>(STORAGE_KEY_TRIPS, []);
        const localHomeMeals = migrateHomeMeals(loadFromStorage<HomeMeal[]>(STORAGE_KEY_HOME_MEALS, []));

        setRatings(localRatings);
        setLists(localLists);
        setWishlist(localWishlist);
        setRestaurantMeta(localMeta);
        setTrips(localTrips);
        setHomeMeals(localHomeMeals);

        // Only push to the cloud when local actually has content to persist.
        // Writing empty arrays here would clobber the row, so if there's
        // nothing local we leave the (genuinely absent) row to be created
        // lazily on the user's first real write via ensureRow.
        const localHasContent =
          localRatings.length > 0 ||
          localWishlist.length > 0 ||
          localHomeMeals.length > 0 ||
          localTrips.length > 0 ||
          Object.keys(localMeta).length > 0 ||
          localLists.some((l) => (l.recipes?.length || l.restaurantIds?.length || l.wishlistIds?.length));

        if (localHasContent) {
          // Re-read localStorage at save time so a toggle the user made while
          // loadUserData was in flight (e.g. tapping a heart on the first
          // visible card) is included in the upsert instead of being clobbered
          // by the snapshot we captured at the top of this branch.
          await saveUserData(userId, {
            ratings: migrateRatings(loadFromStorage<RestaurantRating[]>(STORAGE_KEY_RATINGS, [])),
            lists: migrateLists(loadFromStorage<CustomList[]>(STORAGE_KEY_LISTS, DEFAULT_LISTS)),
            wishlist: migrateWishlist(loadFromStorage<WishlistItem[]>(STORAGE_KEY_WISHLIST, [])),
            restaurantMeta: migrateMeta(loadFromStorage<Record<string, RestaurantMeta>>(STORAGE_KEY_META, {})),
            recentViews: [],
            trips: loadFromStorage<Trip[]>(STORAGE_KEY_TRIPS, []),
            homeMeals: migrateHomeMeals(loadFromStorage<HomeMeal[]>(STORAGE_KEY_HOME_MEALS, [])),
            chats: [],
            chatsRead: {},
          });
        }
      }

      // Load succeeded (row found, or genuine no-row) — cloud writes are safe.
      cloudLoadFailedRef.current = false;
      cloudReadyRef.current = true;
      setCloudLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ── Helper to save to Supabase in the background ──
  const syncRatingsToCloud = useCallback((data: RestaurantRating[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) {
      // Strip large base64 photos before syncing to avoid payload size issues
      const stripped = data.map((r) => ({
        ...r,
        photos: r.photos.map((p) => ({
          ...p,
          // Truncate URLs over 100KB to prevent Supabase payload errors
          url: p.url.length > 100000 ? p.url.slice(0, 100000) : p.url,
        })),
      }));
      saveRatings(userIdRef.current, stripped);
    }
  }, []);
  const syncListsToCloud = useCallback((data: CustomList[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) saveLists(userIdRef.current, data);
  }, []);
  const syncWishlistToCloud = useCallback((data: WishlistItem[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) saveWishlistData(userIdRef.current, data);
  }, []);
  const syncMetaToCloud = useCallback((data: Record<string, RestaurantMeta>) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) saveMetaData(userIdRef.current, data);
  }, []);

  // Persist the unified tombstone set to localStorage (always) and the durable
  // __tombstones__ meta stash (cloud, when ready) so deletions stick locally
  // and converge across devices.
  const persistTombstones = useCallback(() => {
    const json = tombstonesToJSON(tombstonesRef.current);
    saveToStorage(STORAGE_KEY_TOMBSTONES, json);
    setRestaurantMeta((prev) => {
      const next = { ...prev, __tombstones__: json as unknown as RestaurantMeta };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [syncMetaToCloud]);
  // Record a deletion. `tombstone('restaurants', id)`, `tombstone('members',
  // memberKey(listId, id))`, etc.
  const tombstone = useCallback((cat: keyof Tombstones, key: string) => {
    tombstonesRef.current[cat].add(key);
    persistTombstones();
  }, [persistTombstones]);
  // Undo a tombstone when the same entity is re-added (re-rate, re-add to list,
  // re-wishlist) so it isn't filtered straight back out on the next load.
  const untombstone = useCallback((cat: keyof Tombstones, key: string) => {
    if (tombstonesRef.current[cat].delete(key)) persistTombstones();
  }, [persistTombstones]);

  // Mirror the whole local visit-history blob into the durable user_app_data
  // stash (restaurant_meta.__visit_history__). The dedicated `visit_history`
  // table isn't present on every deployment (it errors with PGRST205), so
  // without this the history is localStorage-only and disappears on a new
  // origin / device. Call after any local visit-history mutation.
  const syncVisitHistoryToCloud = useCallback(() => {
    const blob = loadLocalVisitHistory();
    setRestaurantMeta((prev) => {
      const next = { ...prev, __visit_history__: blob as unknown as RestaurantMeta };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [persistTombstones]);
  const syncTripsToCloud = useCallback((data: Trip[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) {
      // Save trips via the dedicated column (may fail if column doesn't exist)
      saveTrips(userIdRef.current, data);
      // Also save trips inside restaurant_meta as a fallback (always works)
      setRestaurantMeta((prev) => {
        const next = { ...prev, __trips__: data as unknown as RestaurantMeta };
        saveToStorage(STORAGE_KEY_META, next);
        syncMetaToCloud(next);
        return next;
      });
    }
  }, [syncMetaToCloud]);

  // ── Custom Order ──
  const setCustomOrder = useCallback((order: string[]) => {
    setCustomOrderState(order);
    saveToStorage(STORAGE_KEY_CUSTOM_ORDER, order);
    // Persist inside restaurant_meta for cloud sync
    setRestaurantMeta((prev) => {
      const next = { ...prev, __custom_order__: order as unknown as RestaurantMeta };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [syncMetaToCloud]);

  // ── Home Meals cloud sync ──
  // ── Trip CRUD ──
  const createTrip = useCallback((trip: Omit<Trip, 'id' | 'createdAt'>): Trip => {
    const newTrip: Trip = { ...trip, id: `trip-${Date.now()}`, createdAt: Date.now() };
    setTrips((prev) => {
      const next = [...prev, newTrip];
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
    return newTrip;
  }, [syncTripsToCloud]);

  const updateTrip = useCallback((id: string, updates: Partial<Trip>) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === id ? { ...t, ...updates } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  const deleteTrip = useCallback((id: string) => {
    tombstone('trips', id);
    setTrips((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud, tombstone]);

  const addRestaurantToTrip = useCallback((tripId: string, restaurant: TripRestaurant) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === tripId ? { ...t, restaurants: [...t.restaurants, restaurant] } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  const updateTripRestaurant = useCallback((tripId: string, restaurantId: string, night: number, updates: Partial<TripRestaurant>) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === tripId ? {
        ...t,
        restaurants: t.restaurants.map((r) =>
          r.restaurantId === restaurantId && r.night === night ? { ...r, ...updates } : r
        ),
      } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  const removeRestaurantFromTrip = useCallback((tripId: string, restaurantId: string, night: number) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === tripId ? {
        ...t,
        restaurants: t.restaurants.filter((r) => !(r.restaurantId === restaurantId && r.night === night)),
      } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  const addHotelToTrip = useCallback((tripId: string, hotel: TripHotel) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === tripId ? { ...t, hotels: [...t.hotels, hotel] } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  const updateHotel = useCallback((tripId: string, hotelId: string, updates: Partial<TripHotel>) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === tripId ? {
        ...t,
        hotels: t.hotels.map((h) => h.id === hotelId ? { ...h, ...updates } : h),
      } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  const removeHotelFromTrip = useCallback((tripId: string, hotelId: string) => {
    setTrips((prev) => {
      const next = prev.map((t) => t.id === tripId ? {
        ...t,
        hotels: t.hotels.filter((h) => h.id !== hotelId),
      } : t);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

  // ── Recipe CRUD ──
  // The CRUD callbacks themselves are declared further down so they can
  // reference syncHomeMealsToCloud — recipes added to any recipe list are
  // mirrored into the global homeMeals pool ("All Recipes" on the Recipes
  // tab). Only getRecipes lives up here since it's a plain selector.
  const getRecipes = useCallback((listId: string): Recipe[] => {
    const list = lists.find((l) => l.id === listId);
    return list?.recipes || [];
  }, [lists]);

  // Add recipe modal state
  const [addRecipeModalOpen, setAddRecipeModalOpen] = useState(false);
  const [addRecipeModalListId, setAddRecipeModalListId] = useState<string | null>(null);
  const [addRecipeModalRecipe, setAddRecipeModalRecipe] = useState<Recipe | null>(null);

  const openAddRecipeModal = useCallback((listId: string, recipe?: Recipe) => {
    if (!userIdRef.current) { requireSignIn('Sign in to save recipes'); return; }
    setAddRecipeModalListId(listId);
    setAddRecipeModalRecipe(recipe || null);
    setAddRecipeModalOpen(true);
  }, [requireSignIn]);

  const closeAddRecipeModal = useCallback(() => {
    setAddRecipeModalOpen(false);
    setAddRecipeModalListId(null);
    setAddRecipeModalRecipe(null);
  }, []);

  // ── Home Meal sync + CRUD ──
  // Save to the dedicated home_meals column if it exists, AND stash a copy
  // inside restaurant_meta.__home_meals__ as a reliable fallback. The
  // dedicated column may fail (missing column, payload size, RLS, etc.);
  // the meta fallback uses a column that is always present, which is what
  // we already do for trips and custom_order.
  const syncHomeMealsToCloud = useCallback((data: HomeMeal[]) => {
    if (!userIdRef.current || !supabaseConfigured) return;
    // Don't write until the initial cloud load has SUCCEEDED this session.
    // While it's in flight (or after it failed) the in-memory set may be
    // incomplete — writing it would clobber the stored recipes. localStorage
    // already has the change; the next successful load unions + backfills.
    if (!cloudReadyRef.current) return;
    saveHomeMeals(userIdRef.current, data);
    setRestaurantMeta((prev) => {
      const next = {
        ...prev,
        __home_meals__: data as unknown as RestaurantMeta,
        // Carry deletion tombstones in the same durable stash so removals reach
        // the cloud and survive the union on every device.
        __deleted_meals__: Array.from(deletedMealIdsRef.current) as unknown as RestaurantMeta,
      };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [syncMetaToCloud]);

  // Recipe CRUD that mirrors into homeMeals — defined here so it can
  // reference syncHomeMealsToCloud. addRecipe always mirrors (new id);
  // updateRecipe propagates edits if a mirror exists; removeRecipe only
  // drops the entry from the sub-list — the recipe lives on in the
  // "All Recipes" cookbook so the user can still find it after reorg.
  const addRecipe = useCallback((listId: string, recipe: Recipe) => {
    // Saving a recipe back into a list re-adds it to the cookbook mirror, so
    // clear any tombstone for this id (un-delete).
    if (deletedMealIdsRef.current.delete(recipe.id)) {
      saveToStorage(STORAGE_KEY_DELETED_MEALS, Array.from(deletedMealIdsRef.current));
    }
    untombstone('members', memberKey(listId, recipe.id));
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId ? { ...l, recipes: [...(l.recipes || []), recipe] } : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    setHomeMeals((prev) => {
      if (prev.some((m) => m.id === recipe.id)) return prev;
      const next = [...prev, recipeToHomeMeal(recipe)];
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, syncHomeMealsToCloud, untombstone]);

  const updateRecipe = useCallback((listId: string, recipeId: string, updates: Partial<Recipe>) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId ? { ...l, recipes: (l.recipes || []).map((r) => {
        if (r.id !== recipeId) return r;
        const merged = { ...r, ...updates };
        // Public (isPrivate=false) requires a cover photo.
        if (!merged.isPrivate && !merged.coverPhoto) merged.isPrivate = true;
        return merged;
      }) } : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    setHomeMeals((prev) => {
      if (!prev.some((m) => m.id === recipeId)) return prev;
      const next = prev.map((m) => {
        if (m.id !== recipeId) return m;
        const merged = { ...m, ...recipeUpdatesToHomeMeal(updates) };
        if (merged.isPublic && !merged.coverPhoto) merged.isPublic = false;
        return merged;
      });
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, syncHomeMealsToCloud]);

  const removeRecipe = useCallback((listId: string, recipeId: string) => {
    // Tombstone this recipe's membership in this list so the union can't re-add
    // it from a stale cloud copy. (It stays in the "All Recipes" cookbook.)
    tombstone('members', memberKey(listId, recipeId));
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId ? { ...l, recipes: (l.recipes || []).filter((r) => r.id !== recipeId) } : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, tombstone]);

  // ── Save-a-recipe-to-a-list helpers (used by the recipe detail page) ──
  // These work in terms of a HomeMeal — the canonical recipe shape the
  // detail page already has — and reuse addRecipe/removeRecipe under the
  // hood so list membership + the cookbook mirror stay consistent.
  const addRecipeToList = useCallback((listId: string, meal: HomeMeal) => {
    addRecipe(listId, homeMealToRecipe(meal));
  }, [addRecipe]);

  // Add a recipe to the built-in "Cooked" list WITHOUT mirroring it into the
  // "All Recipes" cookbook (unlike addRecipe). Marking another user's recipe
  // cooked shouldn't copy it into your cookbook — it lives only under Cooked,
  // carrying the full recipe data so its detail page renders from here even if
  // the original is later made private or deleted. Dedupes + un-tombstones.
  const addRecipeToCookedList = useCallback((meal: HomeMeal) => {
    const recipe = homeMealToRecipe(meal);
    if (deletedMealIdsRef.current.delete(recipe.id)) {
      saveToStorage(STORAGE_KEY_DELETED_MEALS, Array.from(deletedMealIdsRef.current));
    }
    untombstone('members', memberKey(DEFAULT_COOKED_ID, recipe.id));
    setLists((prev) => {
      const next = prev.map((l) => {
        if (l.id !== DEFAULT_COOKED_ID) return l;
        if ((l.recipes || []).some((r) => r.id === recipe.id)) return l;
        return { ...l, recipes: [...(l.recipes || []), recipe] };
      });
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, untombstone]);

  const removeRecipeFromList = useCallback((listId: string, recipeId: string) => {
    removeRecipe(listId, recipeId);
  }, [removeRecipe]);

  // Remove a recipe from the built-in Cooked list AND delete the user's
  // private cook photos for it — once it's no longer cooked, those photos
  // have nowhere to live, so they're cleaned up (no orphaned blob entries).
  const removeRecipeFromCookedList = useCallback((recipeId: string) => {
    removeRecipe(DEFAULT_COOKED_ID, recipeId);
    setRestaurantMeta((prev) => {
      const stash = ((prev as Record<string, unknown>).__cook_photos__ ?? {}) as Record<string, unknown>;
      if (!(recipeId in stash)) return prev;
      const nextStash = { ...stash };
      delete nextStash[recipeId];
      const next = { ...prev, __cook_photos__: nextStash as unknown as RestaurantMeta };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [removeRecipe, syncMetaToCloud]);

  // Every home-cooking list that currently contains this recipe id.
  const getListsForRecipe = useCallback((recipeId: string): CustomList[] => {
    return lists.filter((l) => (l.recipes || []).some((r) => r.id === recipeId));
  }, [lists]);

  // Save a recipe straight into the "All Recipes" cookbook pool without
  // attaching it to a sub-list. Preserves the meal's existing id (so
  // membership checks + later sub-list saves dedupe cleanly) and carries
  // its source-author attribution. No-op if already present.
  const addRecipeToCookbook = useCallback((meal: HomeMeal) => {
    // Re-adding a previously deleted recipe must clear its tombstone, else the
    // load-time filter would strip it straight back out.
    if (deletedMealIdsRef.current.delete(meal.id)) {
      saveToStorage(STORAGE_KEY_DELETED_MEALS, Array.from(deletedMealIdsRef.current));
    }
    setHomeMeals((prev) => {
      if (prev.some((m) => m.id === meal.id)) return prev;
      const next = [...prev, { ...meal, createdAt: meal.createdAt || Date.now() }];
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncHomeMealsToCloud]);

  // Remove a recipe from the cookbook pool. Used to un-save a recipe that
  // was saved from another user from the "All Recipes" target.
  const removeRecipeFromCookbook = useCallback((recipeId: string) => {
    deletedMealIdsRef.current.add(recipeId);
    saveToStorage(STORAGE_KEY_DELETED_MEALS, Array.from(deletedMealIdsRef.current));
    setHomeMeals((prev) => {
      if (!prev.some((m) => m.id === recipeId)) return prev;
      const next = prev.filter((m) => m.id !== recipeId);
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncHomeMealsToCloud]);

  // Generate a meal id that's unique even when createHomeMeal is called many
  // times in the same tick (e.g. a bulk import). Date.now() alone collides
  // inside a synchronous loop, which would make every imported meal share an
  // id — breaking detail navigation and getting deduped on render.
  const newMealId = () => `meal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const createHomeMeal = useCallback((meal: Omit<HomeMeal, 'id' | 'createdAt'>): HomeMeal => {
    // A recipe can only be public if it has a cover photo. Enforced here so no
    // entry point (creation, the Pantry toggle, saving another's recipe…) can
    // slip a public-but-cover-less recipe through.
    const safe = meal.isPublic && !meal.coverPhoto ? { ...meal, isPublic: false } : meal;
    const newMeal: HomeMeal = { ...safe, id: newMealId(), createdAt: Date.now() };
    setHomeMeals((prev) => {
      const next = [...prev, newMeal];
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
    return newMeal;
  }, [syncHomeMealsToCloud]);

  // Bulk variant for imports: appends every meal to state in a single update
  // and fires exactly one cloud save. Calling createHomeMeal in a tight loop
  // would otherwise launch N concurrent PATCH requests, and whichever one
  // resolves last wins — so an early snapshot with only a few rows can clobber
  // the final array.
  const createHomeMealsBulk = useCallback((meals: Array<Omit<HomeMeal, 'id' | 'createdAt'>>): HomeMeal[] => {
    if (meals.length === 0) return [];
    const now = Date.now();
    const newMeals: HomeMeal[] = meals.map((m) => ({
      ...m,
      id: newMealId(),
      createdAt: now,
    }));
    setHomeMeals((prev) => {
      const next = [...prev, ...newMeals];
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
    return newMeals;
  }, [syncHomeMealsToCloud]);

  const updateHomeMeal = useCallback((id: string, updates: Partial<HomeMeal>) => {
    setHomeMeals((prev) => {
      const next = prev.map((m) => {
        if (m.id !== id) return m;
        const merged = { ...m, ...updates };
        // A recipe can only be public if it has a cover photo.
        if (merged.isPublic && !merged.coverPhoto) merged.isPublic = false;
        return merged;
      });
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncHomeMealsToCloud]);

  const deleteHomeMeal = useCallback((id: string) => {
    // Tombstone the id first so the load-time union can't resurrect it from a
    // store that didn't get this update (or a write that hasn't landed yet).
    deletedMealIdsRef.current.add(id);
    saveToStorage(STORAGE_KEY_DELETED_MEALS, Array.from(deletedMealIdsRef.current));
    setHomeMeals((prev) => {
      const next = prev.filter((m) => m.id !== id);
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncHomeMealsToCloud]);

  const getHomeMeal = useCallback((id: string) => homeMeals.find((m) => m.id === id), [homeMeals]);

  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [ratingModalRestaurant, setRatingModalRestaurant] = useState<RestaurantMeta | null>(null);
  const [addToListModalOpen, setAddToListModalOpen] = useState(false);
  const [addToListRestaurantId, setAddToListRestaurantId] = useState<string | null>(null);
  const [addRestaurantModalOpen, setAddRestaurantModalOpen] = useState(false);
  const [addRestaurantModalMeta, setAddRestaurantModalMeta] = useState<RestaurantMeta | null>(null);
  const [addRestaurantModalInitialPage, setAddRestaurantModalInitialPage] = useState<string | null>(null);
  const [homeMealModalOpen, setHomeMealModalOpen] = useState(false);
  const [homeMealModalData, setHomeMealModalData] = useState<HomeMeal | null>(null);
  const [homeMealModalBackToDraft, setHomeMealModalBackToDraft] = useState<(() => void) | null>(null);

  // Restaurant metadata cache
  const cacheRestaurantMeta = useCallback((meta: Partial<RestaurantMeta> & { id: string }) => {
    // Defensively strip any Google Places photo URL so we never persist a
    // URL whose render would trigger a billed Google API call.
    const cleaned: Partial<RestaurantMeta> & { id: string } = {
      ...meta,
      ...(meta.image !== undefined ? { image: safeImage(meta.image) } : {}),
    };
    setRestaurantMeta((prev) => {
      // Merge with existing entry so we don't drop coordinate or other
      // fields the new caller didn't bother to provide. (e.g. the heart
      // toggle has only id/name/image/cuisine/price/address — it would
      // otherwise wipe lat/lng cached by useRestaurantDetail.)
      const existing = prev[cleaned.id];
      const merged: RestaurantMeta = existing
        ? {
            ...existing,
            ...cleaned,
            lat: cleaned.lat ?? existing.lat,
            lng: cleaned.lng ?? existing.lng,
            addressComponents: cleaned.addressComponents ?? existing.addressComponents,
            neighborhood: cleaned.neighborhood ?? existing.neighborhood,
            hours: cleaned.hours ?? existing.hours,
          } as RestaurantMeta
        : ({
            id: cleaned.id,
            name: cleaned.name ?? '',
            image: cleaned.image ?? '',
            cuisine: cleaned.cuisine ?? '',
            price: cleaned.price ?? '',
            address: cleaned.address ?? '',
            lat: cleaned.lat,
            lng: cleaned.lng,
            addressComponents: cleaned.addressComponents,
            neighborhood: cleaned.neighborhood,
          } as RestaurantMeta);
      const next = { ...prev, [cleaned.id]: merged };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [syncMetaToCloud]);

  const stashMetaKey = useCallback((key: string, value: unknown) => {
    setRestaurantMeta((prev) => {
      const next = { ...prev, [key]: value as RestaurantMeta };
      saveToStorage(STORAGE_KEY_META, next);
      syncMetaToCloud(next);
      return next;
    });
  }, [syncMetaToCloud]);

  const getRestaurantInfo = useCallback((restaurantId: string): RestaurantMeta | undefined => {
    if (restaurantMeta[restaurantId]) return restaurantMeta[restaurantId];
    const rated = ratings.find((r) => r.restaurantId === restaurantId);
    if (rated) return { id: rated.restaurantId, name: rated.name, image: rated.image, cuisine: rated.cuisine, price: rated.price, address: rated.address };
    const wished = wishlist.find((w) => w.restaurantId === restaurantId);
    if (wished) return { id: wished.restaurantId, name: wished.name, image: wished.image, cuisine: wished.cuisine, price: wished.price, address: wished.address };
    return undefined;
  }, [restaurantMeta, ratings, wishlist]);

  // Ratings
  /** Push one rating row's current fields to community_ratings (same payload
   *  shape as the boot-time bulk republish). Fire-and-forget. */
  const publishRatingRow = useCallback((uid: string, row: RestaurantRating) => {
    publishCommunityRating(uid, row.restaurantId, {
      name: row.name, score: row.score, notes: row.notes,
      cuisine: row.cuisine, price: row.price, address: row.address,
      visitDate: row.visitDate, tags: row.tags, wouldReturn: row.wouldReturn,
      friendIds: row.friendIds || [], photoUrl: row.image || '',
    });
  }, []);

  const rateRestaurant = useCallback((rating: RestaurantRating, options?: { isNewVisit?: boolean }) => {
    // When `isNewVisit` is true the caller is logging a brand-new
    // visit on top of an existing rating, and the previously-current
    // record needs to be pushed into visit history. When it's false
    // (or absent), this call is just editing the current rating in
    // place — we replace the row and leave visit history alone.
    const isNewVisit = options?.isNewVisit === true;
    // Re-rating a previously-deleted restaurant clears its tombstone so it
    // isn't filtered straight back out on the next load.
    untombstone('restaurants', rating.restaurantId);
    // Capture previous-state context for the toast: was this restaurant
    // already rated? Read from the closure ratings (committed state) since
    // the setRatings updater below runs during render — by then it's too
    // late to know the prior value.
    const wasRated = ratings.some((r) => r.restaurantId === rating.restaurantId);
    // Only archive the existing rating when this is genuinely a new visit.
    // Skipping this on edits is what stops "Update Current" from creating a
    // phantom history entry every time the user tweaks a note or a tag. Done
    // OUTSIDE the setRatings updater (using the committed `ratings` closure, the
    // same source `wasRated` reads) so the localStorage blob is updated before
    // we mirror it to the cloud, and so we don't run side effects in a render
    // updater. The write goes to localStorage (synchronous, survives reloads),
    // the durable user_app_data stash (cross-device, always works), AND the
    // best-effort visit_history table (a no-op where the table is absent).
    const existingForArchive = ratings.find((r) => r.restaurantId === rating.restaurantId);
    if (existingForArchive && isNewVisit) {
      appendLocalVisitRecord(existingForArchive.restaurantId, {
        score: existingForArchive.score,
        notes: existingForArchive.notes,
        visit_date: existingForArchive.visitDate,
        tags: existingForArchive.tags,
        would_return: existingForArchive.wouldReturn,
        photos: (existingForArchive.photos || []).map((p) => ({
          url: p.url,
          caption: p.caption || '',
          isFavorite: !!p.isFavorite,
        })),
        friend_ids: existingForArchive.friendIds || [],
      });
      syncVisitHistoryToCloud();
      if (userIdRef.current) {
        saveVisitRecord(userIdRef.current, {
          restaurantId: existingForArchive.restaurantId,
          score: existingForArchive.score,
          notes: existingForArchive.notes,
          visitDate: existingForArchive.visitDate,
          tags: existingForArchive.tags,
          wouldReturn: existingForArchive.wouldReturn,
          photos: existingForArchive.photos || [],
          friendIds: existingForArchive.friendIds || [],
        }).catch(() => console.warn('[VisitHistory] Failed to save visit record'));
      }
    }
    // Beli-style settle: a score-changing save may shift tier-mates so the
    // ranked order gets breathing room (crowding fix). Computed from the
    // committed `ratings` closure — the same source `wasRated` reads — so the
    // settled array is available to the publish + toast below. Note-only
    // edits keep the score identical and must NOT settle (drift guard).
    const scoreChanged = !existingForArchive || existingForArchive.score !== rating.score;
    const baseNext = [rating, ...ratings.filter((r) => r.restaurantId !== rating.restaurantId)];
    const settleChanges: SettleChange[] = scoreChanged
      ? settleScores(baseNext, {
          justRatedId: rating.restaurantId,
          previousScore: existingForArchive ? existingForArchive.score : undefined,
        })
      : [];
    const next = applySettleChanges(baseNext, settleChanges);
    const settledSelf = next.find((r) => r.restaurantId === rating.restaurantId) ?? rating;
    const otherChanged = settleChanges.filter((c) => c.restaurantId !== rating.restaurantId);
    setRatings(() => {
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
    // Update lists to include this restaurant in selected lists
    if (rating.listIds && rating.listIds.length > 0) {
      setLists((prev) => {
        const next = prev.map((l) => {
          if (rating.listIds.includes(l.id) && !l.restaurantIds.includes(rating.restaurantId)) {
            return { ...l, restaurantIds: [...l.restaurantIds, rating.restaurantId] };
          }
          if (!rating.listIds.includes(l.id) && l.restaurantIds.includes(rating.restaurantId)) {
            return { ...l, restaurantIds: l.restaurantIds.filter((r) => r !== rating.restaurantId) };
          }
          return l;
        });
        saveToStorage(STORAGE_KEY_LISTS, next);
        syncListsToCloud(next);
        return next;
      });
    }
    cacheRestaurantMeta({ id: rating.restaurantId, name: rating.name, image: rating.image, cuisine: rating.cuisine, price: rating.price, address: rating.address });
    // Add new ratings to top of custom order
    setCustomOrderState((prev) => {
      if (prev.includes(rating.restaurantId)) return prev;
      const next = [rating.restaurantId, ...prev];
      saveToStorage(STORAGE_KEY_CUSTOM_ORDER, next);
      return next;
    });
    // Publish to community
    if (userIdRef.current) {
      // The rated row publishes its SETTLED score (may differ from the raw
      // slider/H2H value); every other row the settle moved is republished
      // too, sequential fire-and-forget like the boot-time bulk sync.
      publishRatingRow(userIdRef.current, settledSelf);
      for (const c of otherChanged) {
        const row = next.find((r) => r.restaurantId === c.restaurantId);
        if (row) publishRatingRow(userIdRef.current, row);
      }
      // Reconcile the community gallery with this save: publish the
      // current photo set when the account is public; otherwise (photos
      // removed, or account private) clear any previously published rows.
      // Skipping the clear was how removed photos lived on forever on
      // restaurant pages.
      if (rating.photos && rating.photos.length > 0 && isPublicRef.current) {
        publishCommunityPhotos(userIdRef.current, rating.restaurantId, rating.photos).catch(() => {
          console.warn('[Supabase] Failed to publish photos — they may be too large for the database');
        });
      } else {
        removeCommunityPhotos(userIdRef.current, rating.restaurantId);
      }
    }
    showToast(
      wasRated ? 'Rating updated' : 'Added to rated restaurants',
      {
        subtitle: `${rating.name} · ${settledSelf.score.toFixed(1)} / 10${otherChanged.length > 0 ? ' · nearby ratings adjusted' : ''}`,
        variant: wasRated ? 'rating-updated' : 'rated',
      },
    );
  }, [ratings, cacheRestaurantMeta, syncRatingsToCloud, syncListsToCloud, showToast, untombstone, syncVisitHistoryToCloud, publishRatingRow]);

  const updateRating = useCallback((restaurantId: string, partial: Partial<RestaurantRating>) => {
    setRatings((prev) => {
      const next = prev.map((r) => r.restaurantId === restaurantId ? { ...r, ...partial } : r);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      // Keep the community copy in step — without this, reorder/edit paths
      // left profiles showing the stale pre-edit score until next boot.
      const row = next.find((r) => r.restaurantId === restaurantId);
      if (row && userIdRef.current) publishRatingRow(userIdRef.current, row);
      return next;
    });
  }, [syncRatingsToCloud, publishRatingRow]);

  const applySettledScores = useCallback((changes: SettleChange[]) => {
    if (changes.length === 0) return;
    setRatings((prev) => {
      // Drop no-ops so a save with nothing to do stays a no-op end to end.
      const real = changes.filter((c) => {
        const row = prev.find((r) => r.restaurantId === c.restaurantId);
        return row !== undefined && row.score !== c.score;
      });
      if (real.length === 0) return prev;
      const next = applySettleChanges(prev, real);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      const uid = userIdRef.current;
      if (uid) {
        for (const c of real) {
          const row = next.find((r) => r.restaurantId === c.restaurantId);
          if (row) publishRatingRow(uid, row);
        }
      }
      return next;
    });
  }, [syncRatingsToCloud, publishRatingRow]);

  const removeRating = useCallback((restaurantId: string) => {
    // Tombstone the restaurant so the load-time union can't resurrect it from a
    // stale cloud copy (which is what produced the broken, nameless cards).
    tombstone('restaurants', restaurantId);
    setRatings((prev) => {
      const next = prev.filter((r) => r.restaurantId !== restaurantId);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
    // A deleted rating must also leave every list it was in — otherwise the
    // list keeps a dangling id that the reconciliation renders as an empty
    // "Location unavailable" card after reload.
    setLists((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        const restaurantIds = l.restaurantIds.filter((id) => id !== restaurantId);
        const wishlistIds = (l.wishlistIds || []).filter((id) => id !== restaurantId);
        if (restaurantIds.length !== l.restaurantIds.length || wishlistIds.length !== (l.wishlistIds || []).length) {
          changed = true;
          return { ...l, restaurantIds, wishlistIds };
        }
        return l;
      });
      if (!changed) return prev;
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    setCustomOrderState((prev) => {
      const next = prev.filter((id) => id !== restaurantId);
      saveToStorage(STORAGE_KEY_CUSTOM_ORDER, next);
      return next;
    });
    // Tear down the whole rating footprint — current rating, list
    // memberships, community publication, AND visit history. Without
    // wiping visit history here, a user who deletes a rating and
    // then rates the same restaurant again sees their old visits
    // resurface in the timeline, because both the localStorage
    // mirror and the Supabase visit_history table outlive the
    // current rating row.
    clearLocalVisitHistory(restaurantId);
    syncVisitHistoryToCloud();
    if (userIdRef.current) {
      removeCommunityRating(userIdRef.current, restaurantId);
      removeCommunityPhotos(userIdRef.current, restaurantId);
      deleteAllVisitRecordsForRestaurant(userIdRef.current, restaurantId).catch(() => {
        console.warn('[VisitHistory] Failed to delete visit records for', restaurantId);
      });
    }
  }, [syncRatingsToCloud, syncListsToCloud, tombstone, syncVisitHistoryToCloud]);

  const getRating = useCallback((restaurantId: string) => ratings.find((r) => r.restaurantId === restaurantId), [ratings]);

  // Delete a single visit from the timeline. The timeline lists the
  // current (active) rating alongside historical records; the id
  // 'current' targets the active rating. Deleting the active visit
  // promotes the newest remaining visit back to being the current
  // rating so the user's most recent kept visit stays on the card.
  const deleteVisit = useCallback(async (restaurantId: string, visitId: string) => {
    if (visitId === 'current') {
      // Find the newest remaining historical visit from both local
      // storage and Supabase, and promote it.
      const localRecs = readLocalVisitHistory(restaurantId);
      let remoteRecs: any[] = [];
      if (userIdRef.current) {
        try { remoteRecs = await getVisitHistory(userIdRef.current, restaurantId); } catch {}
      }
      const byId = new Map<string, any>();
      for (const r of [...localRecs, ...remoteRecs]) byId.set(r.id, r);
      const sorted = Array.from(byId.values()).sort((a, b) => {
        const ad = a.visit_date || a.created_at || '';
        const bd = b.visit_date || b.created_at || '';
        return bd.localeCompare(ad);
      });
      const promote = sorted[0];
      if (!promote) {
        // No other visits — remove the rating entirely.
        removeRating(restaurantId);
        return;
      }
      // Pull the promoted record OUT of history (both stores) so it
      // doesn't appear twice once it becomes the active rating.
      removeLocalVisitRecord(restaurantId, promote.id);
      syncVisitHistoryToCloud();
      if (userIdRef.current && !String(promote.id).startsWith('local-')) {
        deleteVisitRecord(userIdRef.current, promote.id).catch(() => {});
      }
      // Rewrite the current rating using the promoted visit's data,
      // keeping the restaurant metadata from the active rating so
      // fields like address / cuisine / lists are preserved.
      let promotedForPublish: RestaurantRating | null = null;
      setRatings((prev) => {
        const existing = prev.find((r) => r.restaurantId === restaurantId);
        if (!existing) return prev;
        const promoted: RestaurantRating = {
          ...existing,
          score: Number(promote.score),
          notes: promote.notes || '',
          visitDate: promote.visit_date || '',
          tags: promote.tags || [],
          wouldReturn: promote.would_return !== undefined ? !!promote.would_return : existing.wouldReturn,
          photos: promote.photos || [],
          friendIds: promote.friend_ids || [],
          createdAt: Date.now(),
        };
        promotedForPublish = promoted;
        const next = [promoted, ...prev.filter((r) => r.restaurantId !== restaurantId)];
        saveToStorage(STORAGE_KEY_RATINGS, next);
        syncRatingsToCloud(next);
        return next;
      });
      // Keep the community-published row in sync with the promoted data.
      if (userIdRef.current && promotedForPublish) {
        const p = promotedForPublish;
        publishCommunityRating(userIdRef.current, restaurantId, {
          name: p.name,
          score: p.score,
          notes: p.notes,
          cuisine: p.cuisine,
          price: p.price,
          address: p.address,
          visitDate: p.visitDate,
          tags: p.tags,
          wouldReturn: p.wouldReturn,
          friendIds: p.friendIds || [],
          photoUrl: p.image || '',
        });
        // The promoted visit's photo set replaces the deleted visit's in
        // the community gallery (or clears it if the promoted visit has
        // no photos) — the gallery must always mirror the *current* visit.
        if (p.photos && p.photos.length > 0 && isPublicRef.current) {
          publishCommunityPhotos(userIdRef.current, restaurantId, p.photos).catch(() => {});
        } else {
          removeCommunityPhotos(userIdRef.current, restaurantId);
        }
      }
      return;
    }

    // Historical visit — just drop it from both stores.
    removeLocalVisitRecord(restaurantId, visitId);
    syncVisitHistoryToCloud();
    if (userIdRef.current && !String(visitId).startsWith('local-')) {
      deleteVisitRecord(userIdRef.current, visitId).catch(() => {});
    }
    // Bump the fingerprint trigger so useRestaurantDetail refetches.
    setRatings((prev) => {
      const existing = prev.find((r) => r.restaurantId === restaurantId);
      if (!existing) return prev;
      const next = prev.map((r) => r.restaurantId === restaurantId
        ? { ...r, createdAt: Date.now() }
        : r);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
  }, [removeRating, syncRatingsToCloud, syncVisitHistoryToCloud]);

  // Lists
  const createList = useCallback((name: string, emoji: string, type?: CustomList['type']): CustomList => {
    const created: CustomList = { id: `list-${Date.now()}`, name, emoji, ...(type ? { type } : {}), restaurantIds: [], wishlistIds: [], createdAt: Date.now() };
    setLists((prev) => {
      const next = [...prev, created];
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    return created;
  }, [syncListsToCloud]);

  const deleteList = useCallback((id: string) => {
    // Built-in Want to Cook / Cooked lists are permanent — silently no-op.
    if (id === DEFAULT_WANT_TO_COOK_ID || id === DEFAULT_COOKED_ID) return;
    tombstone('lists', id);
    setLists((prev) => {
      const next = prev.filter((l) => l.id !== id);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, tombstone]);

  const renameList = useCallback((id: string, name: string, emoji: string) => {
    if (id === DEFAULT_WANT_TO_COOK_ID || id === DEFAULT_COOKED_ID) return;
    setLists((prev) => {
      const next = prev.map((l) => l.id === id ? { ...l, name, emoji } : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const addToList = useCallback((listId: string, restaurantId: string) => {
    // Re-adding clears any "removed from this list" / "deleted restaurant"
    // tombstone so the load reconciliation won't strip it back out.
    untombstone('members', memberKey(listId, restaurantId));
    untombstone('restaurants', restaurantId);
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId && !l.restaurantIds.includes(restaurantId)
        ? { ...l, restaurantIds: [...l.restaurantIds, restaurantId] }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    // Keep the rating's listIds in sync so the load-time reconciliation
    // doesn't fight against local changes.
    setRatings((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (r.restaurantId === restaurantId && !r.listIds.includes(listId)) {
          changed = true;
          return { ...r, listIds: [...r.listIds, listId] };
        }
        return r;
      });
      if (!changed) return prev;
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, syncRatingsToCloud, untombstone]);

  const removeFromList = useCallback((listId: string, restaurantId: string) => {
    // Tombstone this membership so the reconciliation can't re-add it from a
    // stale rating.listIds in the cloud.
    tombstone('members', memberKey(listId, restaurantId));
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId
        ? { ...l, restaurantIds: l.restaurantIds.filter((r) => r !== restaurantId) }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    // Also strip the listId from the rating so it doesn't get re-added by
    // the load-time reconciliation in loadFromSupabase.
    setRatings((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (r.restaurantId === restaurantId && r.listIds.includes(listId)) {
          changed = true;
          return { ...r, listIds: r.listIds.filter((id) => id !== listId) };
        }
        return r;
      });
      if (!changed) return prev;
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
  }, [syncListsToCloud, syncRatingsToCloud, tombstone]);

  const addToWishlistInList = useCallback((listId: string, restaurantId: string) => {
    untombstone('members', memberKey(listId, restaurantId));
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId && !l.wishlistIds.includes(restaurantId)
        ? { ...l, wishlistIds: [...l.wishlistIds, restaurantId] }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    setWishlist((prev) => {
      let changed = false;
      const next = prev.map((w) => {
        if (w.restaurantId === restaurantId && !w.listIds.includes(listId)) {
          changed = true;
          return { ...w, listIds: [...w.listIds, listId] };
        }
        return w;
      });
      if (!changed) return prev;
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      syncWishlistToCloud(next);
      return next;
    });
  }, [syncListsToCloud, syncWishlistToCloud, untombstone]);

  const removeFromWishlistInList = useCallback((listId: string, restaurantId: string) => {
    tombstone('members', memberKey(listId, restaurantId));
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId
        ? { ...l, wishlistIds: l.wishlistIds.filter((r) => r !== restaurantId) }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    setWishlist((prev) => {
      let changed = false;
      const next = prev.map((w) => {
        if (w.restaurantId === restaurantId && w.listIds.includes(listId)) {
          changed = true;
          return { ...w, listIds: w.listIds.filter((id) => id !== listId) };
        }
        return w;
      });
      if (!changed) return prev;
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      syncWishlistToCloud(next);
      return next;
    });
  }, [syncListsToCloud, syncWishlistToCloud, tombstone]);

  const getListsForRestaurant = useCallback((restaurantId: string) => lists.filter((l) => l.restaurantIds.includes(restaurantId)), [lists]);

  const setListRating = useCallback((listId: string, rating: RestaurantRating) => {
    setLists((prev) => {
      const next = prev.map((l) => {
        if (l.id !== listId) return l;
        const listRatings = { ...(l.listRatings || {}), [rating.restaurantId]: rating };
        const restaurantIds = l.restaurantIds.includes(rating.restaurantId) ? l.restaurantIds : [...l.restaurantIds, rating.restaurantId];
        return { ...l, listRatings, restaurantIds };
      });
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
    cacheRestaurantMeta({ id: rating.restaurantId, name: rating.name, image: rating.image, cuisine: rating.cuisine, price: rating.price, address: rating.address });
  }, [syncListsToCloud, cacheRestaurantMeta]);

  const getListRating = useCallback((listId: string, restaurantId: string): RestaurantRating | undefined => {
    const list = lists.find((l) => l.id === listId);
    return list?.listRatings?.[restaurantId];
  }, [lists]);

  // Wishlist
  const addToWishlist = useCallback((item: WishlistItem) => {
    untombstone('wishlist', item.restaurantId);
    setWishlist((prev) => {
      const existing = prev.find((w) => w.restaurantId === item.restaurantId);
      const next = existing
        ? prev.map((w) => w.restaurantId === item.restaurantId ? item : w)
        : [item, ...prev];
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      syncWishlistToCloud(next);
      return next;
    });
    if (item.listIds && item.listIds.length > 0) {
      setLists((prev) => {
        const next = prev.map((l) => {
          if (item.listIds.includes(l.id) && !l.wishlistIds.includes(item.restaurantId)) {
            return { ...l, wishlistIds: [...l.wishlistIds, item.restaurantId] };
          }
          if (!item.listIds.includes(l.id) && l.wishlistIds.includes(item.restaurantId)) {
            return { ...l, wishlistIds: l.wishlistIds.filter((r) => r !== item.restaurantId) };
          }
          return l;
        });
        saveToStorage(STORAGE_KEY_LISTS, next);
        syncListsToCloud(next);
        return next;
      });
    }
    cacheRestaurantMeta({ id: item.restaurantId, name: item.name, image: item.image, cuisine: item.cuisine, price: item.price, address: item.address });
  }, [cacheRestaurantMeta, syncWishlistToCloud, syncListsToCloud, untombstone]);

  const removeFromWishlist = useCallback((restaurantId: string) => {
    tombstone('wishlist', restaurantId);
    setWishlist((prev) => {
      const next = prev.filter((w) => w.restaurantId !== restaurantId);
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      syncWishlistToCloud(next);
      return next;
    });
    setLists((prev) => {
      const next = prev.map((l) => l.wishlistIds.includes(restaurantId)
        ? { ...l, wishlistIds: l.wishlistIds.filter((r) => r !== restaurantId) }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncWishlistToCloud, syncListsToCloud, tombstone]);

  const isWishlisted = useCallback((restaurantId: string) => wishlist.some((w) => w.restaurantId === restaurantId), [wishlist]);

  const getWishlistItem = useCallback((restaurantId: string) => wishlist.find((w) => w.restaurantId === restaurantId), [wishlist]);

  // One-tap toggle. Decides add-vs-remove from the currently committed
  // wishlist (closure value) so the toast we fire below sees the right
  // direction — the setWishlist updater runs during render, AFTER this
  // function returns, so reading from inside it left `removed` always
  // false and the toast always read "Added".
  const toggleWishlist = useCallback((restaurant: RestaurantMeta) => {
    cacheRestaurantMeta(restaurant);
    const isOn = wishlist.some((w) => w.restaurantId === restaurant.id);
    // Removing tombstones the entry; re-adding clears it.
    if (isOn) tombstone('wishlist', restaurant.id);
    else untombstone('wishlist', restaurant.id);
    setWishlist((prev) => {
      // Re-check inside the updater so two fast taps still produce the
      // right end state — prev is the most up-to-date queue value.
      const onNow = prev.some((w) => w.restaurantId === restaurant.id);
      const next: WishlistItem[] = onNow
        ? prev.filter((w) => w.restaurantId !== restaurant.id)
        : [{
            restaurantId: restaurant.id,
            name: restaurant.name,
            image: safeImage(restaurant.image),
            cuisine: restaurant.cuisine,
            price: restaurant.price,
            address: restaurant.address,
            notes: '',
            listIds: [],
            addedAt: Date.now(),
          }, ...prev];
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      syncWishlistToCloud(next);
      return next;
    });
    // When removing, also strip the restaurant from any custom list that
    // had it on its wishlistIds so the lists view doesn't show a ghost.
    if (isOn) {
      setLists((prev) => {
        let changed = false;
        const next = prev.map((l) => {
          if (l.wishlistIds.includes(restaurant.id)) {
            changed = true;
            return { ...l, wishlistIds: l.wishlistIds.filter((r) => r !== restaurant.id) };
          }
          return l;
        });
        if (!changed) return prev;
        saveToStorage(STORAGE_KEY_LISTS, next);
        syncListsToCloud(next);
        return next;
      });
    }
    showToast(isOn ? 'Removed from wishlist' : 'Added to wishlist', {
      subtitle: restaurant.name,
      variant: isOn ? 'wishlist-remove' : 'wishlist-add',
    });
  }, [wishlist, cacheRestaurantMeta, syncWishlistToCloud, syncListsToCloud, showToast, tombstone, untombstone]);

  // Modals
  const openRatingModal = useCallback((restaurant: RestaurantMeta) => {
    if (!userIdRef.current) { requireSignIn('Sign in to rate restaurants'); return; }
    cacheRestaurantMeta(restaurant);
    setRatingModalRestaurant(restaurant);
    setRatingModalOpen(true);
  }, [cacheRestaurantMeta, requireSignIn]);
  const closeRatingModal = useCallback(() => { setRatingModalOpen(false); setRatingModalRestaurant(null); }, []);

  const openAddToListModal = useCallback((restaurantId: string, meta?: RestaurantMeta) => {
    if (!userIdRef.current) { requireSignIn('Sign in to save to a list'); return; }
    if (meta) cacheRestaurantMeta(meta);
    setAddToListRestaurantId(restaurantId);
    setAddToListModalOpen(true);
  }, [cacheRestaurantMeta, requireSignIn]);
  const closeAddToListModal = useCallback(() => { setAddToListModalOpen(false); setAddToListRestaurantId(null); }, []);

  const openAddRestaurantModal = useCallback((restaurant: RestaurantMeta, initialPage?: string) => {
    if (!userIdRef.current) { requireSignIn('Sign in to rate restaurants'); return; }
    cacheRestaurantMeta(restaurant);
    setAddRestaurantModalMeta(restaurant);
    setAddRestaurantModalInitialPage(initialPage || null);
    setAddRestaurantModalOpen(true);
  }, [cacheRestaurantMeta, requireSignIn]);
  const closeAddRestaurantModal = useCallback(() => { setAddRestaurantModalOpen(false); setAddRestaurantModalMeta(null); setAddRestaurantModalInitialPage(null); }, []);

  const openHomeMealModal = useCallback((meal?: HomeMeal, opts?: { onBackToDraft?: () => void }) => {
    if (!userIdRef.current) { requireSignIn('Sign in to log a home meal'); return; }
    setHomeMealModalData(meal || null);
    // Store as a value-returning thunk so React doesn't treat the
    // callback as a state updater.
    setHomeMealModalBackToDraft(() => opts?.onBackToDraft ?? null);
    setHomeMealModalOpen(true);
  }, []);
  const closeHomeMealModal = useCallback(() => {
    setHomeMealModalOpen(false);
    setHomeMealModalData(null);
    setHomeMealModalBackToDraft(null);
  }, []);

  return (
    <ListsContext.Provider value={{
      ratings, rateRestaurant, updateRating, applySettledScores, removeRating, getRating, deleteVisit,
      lists, createList, deleteList, renameList, addToList, removeFromList, addToWishlistInList, removeFromWishlistInList, getListsForRestaurant, setListRating, getListRating,
      restaurantMeta, cacheRestaurantMeta, getRestaurantInfo, stashMetaKey,
      wishlist, addToWishlist, removeFromWishlist, toggleWishlist, isWishlisted, getWishlistItem,
      ratingModalOpen, ratingModalRestaurant, openRatingModal, closeRatingModal,
      addToListModalOpen, addToListRestaurantId, openAddToListModal, closeAddToListModal,
      addRestaurantModalOpen, addRestaurantModalMeta, addRestaurantModalInitialPage, openAddRestaurantModal, closeAddRestaurantModal,
      addRecipe, updateRecipe, removeRecipe, getRecipes,
      addRecipeToList, addRecipeToCookedList, removeRecipeFromCookedList, removeRecipeFromList, getListsForRecipe,
      addRecipeToCookbook, removeRecipeFromCookbook,
      addRecipeModalOpen, addRecipeModalListId, addRecipeModalRecipe, openAddRecipeModal, closeAddRecipeModal,
      trips, createTrip, updateTrip, deleteTrip, addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip, addHotelToTrip, updateHotel, removeHotelFromTrip,
      customOrder, setCustomOrder,
      homeMeals, createHomeMeal, createHomeMealsBulk, updateHomeMeal, deleteHomeMeal, getHomeMeal,
      homeMealModalOpen, homeMealModalData, homeMealModalBackToDraft, openHomeMealModal, closeHomeMealModal,
    }}>
      {children}
    </ListsContext.Provider>
  );
};

export function useLists() {
  const ctx = useContext(ListsContext);
  if (!ctx) throw new Error('useLists must be used within ListsProvider');
  return ctx;
}
