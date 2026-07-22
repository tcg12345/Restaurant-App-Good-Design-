import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { supabaseConfigured } from '../lib/supabase';
import { loadUserData, saveRatings, saveLists, saveWishlistData, saveMetaData, saveUserData, saveRecentViews, saveTrips, saveHomeMeals, saveCustomOrder, saveVisitHistoryColumn, type UserAppData } from '../lib/supabase-db';
import { mergeRatings, mergeLists, mergeWishlist, mergeTrips, mergeHomeMeals } from '../lib/mergeUserData';
import { MAX_INLINE_PHOTO_BYTES, uploadPhoto } from '../lib/images';
import { collectPendingPhotoUploads, countPendingPhotoUploads, applyPhotoUrlReplacements } from '../lib/pendingPhotos';
import { publishCommunityRating, removeCommunityRating, publishCommunityPhotos, removeCommunityPhotos, saveVisitRecord, deleteVisitRecord, deleteAllVisitRecordsForRestaurant, getVisitHistory, getUserRatings } from '../lib/supabase-community';
import { useAuth } from './AuthContext';
import { useSignInModal } from './SignInModalContext';
import { useToast } from './ToastContext';
import { safeImage, localISODate } from '../lib/utils';
import { applySettleChanges, type SettleChange } from '../lib/settleScores';
import { applyRatingSave } from '../lib/applyRatingSave';

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
  createdAt: number;      // timestamp (first rated)
  /** Last-modified timestamp — bumped on every rate/update/settle. Drives
   *  the multi-device merge (mergeUserData): when the same rating exists on
   *  two devices, the newer `updatedAt` wins, so an edit is never clobbered
   *  by a stale copy. Optional for backward-compat with rows saved before
   *  this field existed; the merge falls back to createdAt when absent. */
  updatedAt?: number;
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
  /** When `hours` was last fetched (Date.now()). Schedules change, so
   *  cached hours older than the freshness window (see hasFreshHours) are
   *  refetched instead of trusted forever. Absent on entries written
   *  before this field existed — treated as stale. */
  hoursFetchedAt?: number;
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
  /** Last-edited timestamp (Date.now()). Stamped by every mutator that edits
   *  this recipe so the multi-device merge (mergeUserData) keeps the newer
   *  copy; absent on entries created before it existed (merge falls back to
   *  createdAt). */
  updatedAt?: number;
  /** When this recipe was saved from another user's recipe, who
   *  originally authored it. Drives the "by @author" byline on cards.
   *  Unset for the user's own recipes. */
  sourceAuthorId?: string;
  sourceAuthorName?: string;
  sourceAuthorUsername?: string;
  /** The original meal's id when this is a saved copy. Together with
   *  sourceAuthorId this is the STABLE save identity — matching on title
   *  meant repeat saves duplicated and renames broke membership. */
  sourceMealId?: string;
  /* Advanced-builder fields, carried on list copies so the detail page's
     cooked-list fallback renders the full rich recipe instead of a
     degraded flat one when the canonical HomeMeal is gone (original
     deleted / made private). Optional — flat recipes never set them. */
  introParagraph?: string;
  course?: string[];
  chillTime?: number;
  yieldDescription?: string;
  ingredientGroups?: RecipeIngredientGroup[];
  equipment?: string[];
  notes?: RecipeNote[];
  stepDetails?: RecipeStepDetail[];
  stepGroups?: RecipeStepGroup[];
  linkedRecipes?: LinkedRecipeRef[];
}

export interface CustomList {
  id: string;
  name: string;
  emoji: string;
  type?: 'default' | 'home-cooking'; // special list types
  restaurantIds: string[];   // rated restaurants
  wishlistIds: string[];     // wishlisted restaurants
  listRatings?: Record<string, RestaurantRating>; // per-list rating overrides keyed by restaurantId
  recipes?: Recipe[];        // home-cooking recipes
  createdAt: number;
  /** Last-edited timestamp; see Recipe.updatedAt. Stamped on scalar edits
   *  (rename) and listRatings edits so the newer list wins the merge. */
  updatedAt?: number;
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
  /** Last-edited timestamp; see Recipe.updatedAt. Stamped on note edits so a
   *  note changed offline wins the merge (addedAt alone would tie the cloud
   *  copy and lose). */
  updatedAt?: number;
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

export interface Trip {
  id: string;
  name: string;
  destination: string;
  destinationLat: number;
  destinationLng: number;
  startDate: string;
  endDate: string;
  coverImage?: string;
  restaurants: TripRestaurant[];
  notes?: string;
  status: 'planning' | 'active' | 'completed';
  createdAt: number;
  /** Last-edited timestamp; see Recipe.updatedAt. Trips merge as a whole
   *  entity (newer wins), so every trip edit stamps this. */
  updatedAt?: number;
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
  /** Last-edited timestamp; see Recipe.updatedAt. Home meals merge as a whole
   *  entity (newer wins), so every edit stamps this. */
  updatedAt?: number;
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
  /** Set when this recipe came in through the Import tab: the source URL,
   *  or 'photo' / 'text'. Drives the "Imported from …" note on the recipe
   *  page (shown INSTEAD of the AI note). Survives editing + publishing. */
  importedFrom?: string;
  /** When this meal was saved from another user's recipe, who
   *  originally authored it. Drives the "by @author" byline shown on
   *  cookbook / list / profile cards. Unset for the user's own meals. */
  sourceAuthorId?: string;
  sourceAuthorName?: string;
  sourceAuthorUsername?: string;
  /** The original meal's id when this is a saved copy — the stable save
   *  identity (see Recipe.sourceMealId). */
  sourceMealId?: string;
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
   *  visit record gets created.
   *
   *  Pass `settleOrder` (descending restaurant ids) when the score came out
   *  of a head-to-head — it carries the search's exact placement through the
   *  settle pass, so a score collision with a bracketing neighbor can't
   *  invert the order the user just decided. */
  rateRestaurant: (rating: RestaurantRating, options?: { isNewVisit?: boolean; settleOrder?: string[]; skipSettle?: boolean }) => void;
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
  /** Photos still stored as inline data: URLs — the Storage upload failed or
   *  the user was offline/signed out when they were added. They render
   *  locally but haven't reached the cloud or other devices yet; uploads are
   *  retried automatically on foreground / connectivity regain / sign-in. */
  pendingPhotoUploadCount: number;
  /** Re-attempt the Storage upload for every pending inline photo now
   *  (the settings row's "tap to retry"). Safe to call repeatedly. */
  retryPendingPhotoUploads: () => void;

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
  toggleWishlist: (restaurant: RestaurantMeta, opts?: { undoable?: boolean; silent?: boolean }) => void;
  isWishlisted: (restaurantId: string) => boolean;
  getWishlistItem: (restaurantId: string) => WishlistItem | undefined;

  // Modals
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
  /** When the modal was opened from a specific recipe list ("Add recipe"
   *  on a list page), the created meal is also added to this list on
   *  save — every builder tab (Basic / Advanced / AI) honors it. */
  homeMealModalTargetListId: string | null;
  openHomeMealModal: (meal?: HomeMeal, opts?: { onBackToDraft?: () => void; targetListId?: string; initialMethod?: 'link' | 'photo' | 'text' | 'custom' | 'ai' }) => void;
  /** Creation method preselected by the caller (Create page surface) —
   *  the modal skips its chooser and opens that flow directly. */
  homeMealModalInitialMethod: 'link' | 'photo' | 'text' | 'custom' | 'ai' | null;
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

// ── Community-publish delta tracking ──
// The boot-time sync used to republish EVERY rating to community_ratings on
// every successful load — hundreds of writes per session for heavy raters,
// each resetting the row's updated_at (which is what orders the friends
// feed). Persist a fingerprint of what was last published per restaurant and
// skip rows that haven't changed.
const STORAGE_KEY_PUBLISHED_SIGS = 'gourmad-published-sigs';

/** Stable fingerprint of the fields publishCommunityRating sends (plus the
 *  photo set that syncCommunityPhotos reconciles). URLs are length+prefix
 *  hashed so legacy inline base64 photos don't balloon the stored map. */
function publishSignature(r: RestaurantRating): string {
  const urlSig = (u: string | undefined | null) => { const s = u || ''; return `${s.length}:${s.slice(0, 32)}`; };
  return JSON.stringify([
    r.name, r.score, r.notes, r.cuisine, r.price, r.address, r.visitDate,
    r.tags, r.wouldReturn, r.friendIds || [], urlSig(r.image),
    (r.photos || []).map((p) => `${urlSig(p.url)}|${p.isFavorite ? 1 : 0}|${p.caption || ''}`),
  ]);
}

function loadPublishedSigs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PUBLISHED_SIGS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePublishedSigs(sigs: Record<string, string>): void {
  try { localStorage.setItem(STORAGE_KEY_PUBLISHED_SIGS, JSON.stringify(sigs)); } catch { /* quota */ }
}

/** Stamp one rating's published fingerprint (after a per-row publish). */
function stampPublishedSig(r: RestaurantRating): void {
  const sigs = loadPublishedSigs();
  sigs[r.restaurantId] = publishSignature(r);
  savePublishedSigs(sigs);
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

/** Legacy hotels feature: rated hotels were stored with cuisine 'Hotel'
 *  (Discover's hotels map mode) or 'Hotel Breakfast' (the hotel detail
 *  pages) — the same predicate the old rating engine used to keep them
 *  off the main rated list. The feature is gone, so these entries must
 *  never surface again anywhere. */
function isLegacyHotelEntry(cuisine: string | undefined): boolean {
  const c = (cuisine || '').trim().toLowerCase();
  return c === 'hotel' || c === 'hotel breakfast';
}
/** restaurantIds of hotel entries the migrations dropped this session.
 *  Drained by the purge effect in ListsProvider, which finishes the
 *  deletion the way removeRating would (tombstones, list membership,
 *  community rows/photos, visit records). */
const purgedHotelIds = new Set<string>();
const purgedHotelWishlistIds = new Set<string>();

// Migration: add listIds, photos to ratings that don't have them. Also strips
// stale Google Places photo URLs cached before photo fetching was disabled —
// rendering them would trigger a billed Google API call per image. Runs on
// every load path (local, cloud, community recovery), so it also permanently
// drops legacy hotel entries — they can never re-enter from a stale copy.
function migrateRatings(ratings: RestaurantRating[]): RestaurantRating[] {
  if (!Array.isArray(ratings)) return [];
  return ratings
    .filter((r) => {
      if (!isLegacyHotelEntry(r?.cuisine)) return true;
      if (r.restaurantId) purgedHotelIds.add(r.restaurantId);
      return false;
    })
    .map((r) => ({
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
    date: localISODate(new Date(r.createdAt || Date.now())),
    score: r.score ?? 0,
    wouldMakeAgain: (r.score ?? 0) >= 7,
    description: r.description ?? '',
    photos: r.photos ?? [],
    tags: r.tags ?? [],
    dishes: [],
    // A sourceAuthorId means this is a copy of someone else's recipe (it's only
    // ever stamped on saves from another user). Such a copy is ALWAYS private
    // until the saver explicitly publishes it — never inherit the original's
    // public flag, which would republish it under the saver's name.
    isPublic: r.sourceAuthorId ? false : !r.isPrivate,
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
    sourceMealId: r.sourceMealId,
    introParagraph: r.introParagraph,
    course: r.course,
    chillTime: r.chillTime,
    yieldDescription: r.yieldDescription,
    ingredientGroups: r.ingredientGroups,
    equipment: r.equipment,
    notes: r.notes,
    stepDetails: r.stepDetails,
    stepGroups: r.stepGroups,
    linkedRecipes: r.linkedRecipes,
  };
}

// Inverse of recipeToHomeMeal: collapse a HomeMeal into the list-Recipe
// shape stored on home-cooking lists. Advanced-builder fields ride along
// so the detail page's cooked-list fallback (which renders from this copy
// when the canonical HomeMeal is private/deleted) shows the full rich
// recipe instead of a degraded flat one.
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
    sourceMealId: m.sourceMealId,
    introParagraph: m.introParagraph,
    course: m.course,
    chillTime: m.chillTime,
    yieldDescription: m.yieldDescription,
    ingredientGroups: m.ingredientGroups,
    equipment: m.equipment,
    notes: m.notes,
    stepDetails: m.stepDetails,
    stepGroups: m.stepGroups,
    linkedRecipes: m.linkedRecipes,
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
  return items
    .filter((w) => {
      if (!isLegacyHotelEntry(w?.cuisine)) return true;
      if (w.restaurantId) purgedHotelWishlistIds.add(w.restaurantId);
      return false;
    })
    .map((w) => ({
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
  // Always-fresh mirrors of `ratings`/`wishlist` for rateRestaurant. Reading
  // the render closure there loses same-tick saves: two rateRestaurant calls
  // in one tick (bulk import, fast double-save) would both derive from the
  // same stale array and the second would silently drop the first — from
  // state, localStorage, AND the cloud payload. rateRestaurant assigns
  // ratingsRef eagerly when it commits, so the next same-tick call builds on
  // it; the render-time assignments below re-sync both refs to committed
  // truth after React processes the queue.
  const ratingsRef = useRef(ratings);
  ratingsRef.current = ratings;
  const wishlistRef = useRef(wishlist);
  wishlistRef.current = wishlist;
  // Same always-fresh mirror for restaurantMeta — commitMeta (below) computes
  // the next blob from this ref OUTSIDE the setState updater, so persistence
  // and cloud sync run exactly once per mutation (side effects inside
  // updaters fire twice under StrictMode's double-invoke).
  const restaurantMetaRef = useRef(restaurantMeta);
  restaurantMetaRef.current = restaurantMeta;
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
  // Set true whenever a mutation's cloud sync is skipped because the initial
  // load hadn't finished (cloudReadyRef false). The load, once it commits the
  // merged state, checks this and pushes the freshly-merged localStorage
  // snapshot to the cloud — so a change made DURING sign-in (which the merge
  // already folded into state via the localStorage re-read) also reaches the
  // server, instead of living only on this device until the next mutation.
  const dirtyDuringLoadRef = useRef(false);
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
  // Default to FALSE (private) while the profile is still loading or absent:
  // treating unknown visibility as public let a private user's photos get
  // published to the world-readable community_photos table during sign-in
  // (before the profile resolved). Every publishCommunityPhotos call is gated
  // on this ref, so an unknown/private account never publishes photos. Flips
  // to the real value once authProfile loads. (community_photos RLS in
  // migration 046 also enforces this server-side.)
  const isPublicRef = useRef(authProfile?.is_public ?? false);
  isPublicRef.current = authProfile?.is_public ?? false;
  // Whether isPublicRef is AUTHORITATIVE: false while the auth profile is
  // still loading. The distinction matters — "unknown" must never be treated
  // as "private, so clear the gallery" (that deleted a public user's
  // published photos when they rated right after sign-in).
  const isPublicKnownRef = useRef(!!authProfile);
  isPublicKnownRef.current = !!authProfile;
  // Photo publishes deferred because visibility was unknown at save time,
  // keyed by restaurantId (latest photo set wins). Flushed once the profile
  // lands; dropped on sign-out/user switch.
  const pendingPhotoPublishRef = useRef<Map<string, PhotoItem[]>>(new Map());

  /** Reconcile the community gallery for one restaurant with `photos`.
   *
   *  - No photos → the user removed them (or the visit has none): clear the
   *    published rows. Safe regardless of visibility.
   *  - Photos + account KNOWN public → publish.
   *  - Photos + account KNOWN private → leave the table alone; migration
   *    046's RLS already hides any historical rows from non-followers.
   *  - Photos + visibility UNKNOWN (profile still loading) → defer: queue the
   *    publish for when the profile lands. Never delete on "unknown" — that
   *    branch is what silently wiped a public user's existing gallery.
   */
  const syncCommunityPhotos = useCallback((restaurantId: string, photos: PhotoItem[] | undefined) => {
    const uid = userIdRef.current;
    if (!uid) return;
    if (!photos || photos.length === 0) {
      pendingPhotoPublishRef.current.delete(restaurantId);
      removeCommunityPhotos(uid, restaurantId);
      return;
    }
    if (!isPublicKnownRef.current) {
      pendingPhotoPublishRef.current.set(restaurantId, photos);
      return;
    }
    pendingPhotoPublishRef.current.delete(restaurantId);
    if (isPublicRef.current) {
      publishCommunityPhotos(uid, restaurantId, photos).catch(() => {
        console.warn('[Supabase] Failed to publish photos — they may be too large for the database');
      });
    }
  }, []);

  // Flush deferred publishes once the profile resolves. Private accounts just
  // drop the queue (nothing was published, nothing needs deleting).
  useEffect(() => {
    if (!authProfile || !userIdRef.current) return;
    const pending = pendingPhotoPublishRef.current;
    if (pending.size === 0) return;
    const entries = [...pending.entries()];
    pending.clear();
    if (!isPublicRef.current) return;
    for (const [restaurantId, photos] of entries) {
      publishCommunityPhotos(userIdRef.current, restaurantId, photos).catch(() => {});
    }
  }, [authProfile]);

  // ── Load data from Supabase when user signs in ──
  useEffect(() => {
    // Block all cloud writes until THIS user's data has been loaded once.
    cloudReadyRef.current = false;
    dirtyDuringLoadRef.current = false;
    // Deferred photo publishes belong to the previous identity — drop them.
    pendingPhotoPublishRef.current.clear();
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
      // Reset state to empty (keep the eager meta ref in step so a
      // same-tick commitMeta can't resurrect the old blob)
      setRatings([]);
      setLists(DEFAULT_LISTS);
      setWishlist([]);
      restaurantMetaRef.current = {};
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

        // ── Real multi-device merge (mergeUserData) ──
        // Every entity is keyed by id; the newer copy wins (updatedAt →
        // createdAt), and array memberships are UNIONED. This replaces the
        // old "cloud wins wholesale, then union only ids cloud lacked"
        // logic, which silently dropped an EDIT to an entry that existed on
        // both sides (e.g. a re-rate made on this device while the sign-in
        // load was still in flight). recoveredRatings only feeds in when
        // both sides are genuinely empty (community_ratings recovery).
        const cloudRatingsBase = migrateRatings(cloud.ratings.length > 0 ? cloud.ratings : recoveredRatings);
        const localRatingsMig = migrateRatings(localRatings);
        let cloudRatings = mergeRatings(localRatingsMig, cloudRatingsBase);
        const ratingsMergedFromLocal =
          cloudRatings.length !== cloudRatingsBase.length
          || cloudRatings.some((r, i) => r !== cloudRatingsBase[i]);

        const baseCloudLists = migrateLists(cloud.lists.length > 0 ? cloud.lists : DEFAULT_LISTS);
        const cloudLists = mergeLists(migrateLists(localLists), baseCloudLists);
        const listsMergedFromLocal =
          cloudLists.length !== baseCloudLists.length
          || cloudLists.some((l, i) => l !== baseCloudLists[i]);

        const cloudWishlistBase = migrateWishlist(cloud.wishlist.length > 0 ? cloud.wishlist : []);
        let cloudWishlist = mergeWishlist(migrateWishlist(localWishlist), cloudWishlistBase);

        const cloudMeta = cloud.restaurantMeta || {};
        // Trips: dedicated column (migration 012) is the source of truth;
        // fall back to the legacy restaurant_meta.__trips__ mirror for rows
        // written by older clients, then merge this device's local trips.
        const cloudTripsBase: Trip[] = ((cloud as any).trips && (cloud as any).trips.length > 0)
          ? (cloud as any).trips
          : (Array.isArray((cloudMeta as any).__trips__) ? (cloudMeta as any).__trips__ as Trip[] : []);
        let cloudTrips = mergeTrips(loadFromStorage<Trip[]>(STORAGE_KEY_TRIPS, []), cloudTripsBase);
        const cloudRecentViews = cloud.recentViews || [];
        // Custom order: dedicated column (migration 038) is the source of
        // truth; fall back to the legacy __custom_order__ mirror, then this
        // device's saved order. It's an ordering not a set, so no merge —
        // the freshest available wins (column > legacy meta > local).
        let cloudCustomOrder = (Array.isArray((cloud as any).customOrder) && (cloud as any).customOrder.length > 0)
          ? (cloud as any).customOrder as string[]
          : Array.isArray((cloudMeta as any).__custom_order__)
            ? (cloudMeta as any).__custom_order__ as string[]
            : loadFromStorage<string[]>(STORAGE_KEY_CUSTOM_ORDER, []);

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

        // Ratings/wishlist were already unioned local+cloud by mergeRatings /
        // mergeWishlist above (newer-wins, listIds unioned), and the tombstone
        // pass just filtered the merged result. Whether the merge rescued
        // anything local-only gates the cloud backfill push below.
        const wishlistMergedFromLocal =
          cloudWishlist.length !== cloudWishlistBase.length
          || cloudWishlist.some((w, i) => w !== cloudWishlistBase[i]);

        // ── Restore visit history ──
        // Three sources, merged by record id per restaurant: the dedicated
        // visit_history COLUMN (migration 058 — the preferred per-action
        // write channel), the legacy restaurant_meta.__visit_history__ stash
        // (written by older clients / pre-migration schemas), and this
        // device's localStorage blob. The merged set is written back to
        // localStorage so the detail page — which seeds history from local —
        // shows it after a reload, a new deploy, or on another device.
        const rawCloudVisitHistory = (cloudMeta as Record<string, unknown>).__visit_history__;
        const stashVisitHistory: Record<string, LocalVisitRecord[]> =
          rawCloudVisitHistory && typeof rawCloudVisitHistory === 'object' && !Array.isArray(rawCloudVisitHistory)
            ? (rawCloudVisitHistory as Record<string, LocalVisitRecord[]>)
            : {};
        const columnVisitHistory = (cloud.visitHistory ?? {}) as Record<string, LocalVisitRecord[]>;
        const localVisitHistory = loadLocalVisitHistory();
        const mergedVisitHistory: Record<string, LocalVisitRecord[]> = {};
        for (const rid of new Set([
          ...Object.keys(localVisitHistory),
          ...Object.keys(stashVisitHistory),
          ...Object.keys(columnVisitHistory),
        ])) {
          const byId = new Map<string, LocalVisitRecord>();
          for (const rec of (stashVisitHistory[rid] || [])) if (rec && rec.id) byId.set(rec.id, rec);
          for (const rec of (columnVisitHistory[rid] || [])) if (rec && rec.id) byId.set(rec.id, rec);
          for (const rec of (localVisitHistory[rid] || [])) if (rec && rec.id) byId.set(rec.id, rec);
          const arr = Array.from(byId.values());
          if (arr.length) mergedVisitHistory[rid] = arr;
        }
        saveToStorage(STORAGE_KEY_VISIT_HISTORY, mergedVisitHistory);
        const mergedVHCount = Object.values(mergedVisitHistory).reduce((n, a) => n + a.length, 0);
        // Stale when the merged union has records the preferred channel (the
        // column, falling back to the stash pre-migration) doesn't.
        const columnVHCount = Object.values(columnVisitHistory).reduce((n, a) => n + (a?.length || 0), 0);
        const stashVHCount = Object.values(stashVisitHistory).reduce((n, a) => n + (a?.length || 0), 0);
        const visitHistoryStale = mergedVHCount !== Math.max(columnVHCount, stashVHCount);
        // Backfill the dedicated column whenever the union differs from what
        // it holds (no-op where the column doesn't exist yet).
        if (mergedVHCount !== columnVHCount) {
          void saveVisitHistoryColumn(userId, mergedVisitHistory as unknown as Record<string, unknown[]>);
        }
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

        const unionedHomeMeals = migrateHomeMeals(mergeHomeMeals(localHomeMeals, baseCloudHomeMeals));
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
        // Local-only meta keys survive the swap: cached hours/coords and the
        // durable __stash__ keys written while this load was in flight (or
        // never synced) would otherwise be discarded wholesale. Cloud wins
        // on every key it has — this only rescues keys the cloud lacks.
        const localMetaSnapshot = migrateMeta(loadFromStorage<Record<string, RestaurantMeta>>(STORAGE_KEY_META, {}));
        const localOnlyMeta: Record<string, RestaurantMeta> = {};
        let metaMergedFromLocal = false;
        for (const [mk, mv] of Object.entries(localMetaSnapshot)) {
          if (!(mk in cloudMeta)) { localOnlyMeta[mk] = mv; metaMergedFromLocal = true; }
        }
        // Legacy sync channels: trips and custom order used to be mirrored
        // into the meta blob (__trips__/__custom_order__), which doubled the
        // clobber surface — every unrelated meta write rewrote them. They now
        // have dedicated columns (trips: 012, custom_order: 038) and were
        // already read into cloudTrips / cloudCustomOrder above, so strip the
        // keys here on load; the app no longer writes them.
        const stripLegacyMetaKeys = (m: Record<string, unknown>) => {
          const { __trips__, __custom_order__, ...rest } = m;
          void __trips__; void __custom_order__;
          return rest;
        };
        const cloudMetaWithMeals = {
          ...stripLegacyMetaKeys(localOnlyMeta),
          ...stripLegacyMetaKeys(migrateMeta(cloudMeta)),
          __home_meals__: cloudHomeMeals as unknown as RestaurantMeta,
          __deleted_meals__: Array.from(mergedDeletedIds) as unknown as RestaurantMeta,
          __tombstones__: tombstonesToJSON(tomb) as unknown as RestaurantMeta,
          __visit_history__: mergedVisitHistory as unknown as RestaurantMeta,
        };

        setRatings(cloudRatings);
        setLists(ensureDefaultRecipeList(finalLists));
        setWishlist(cloudWishlist);
        restaurantMetaRef.current = cloudMetaWithMeals;
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
        // Migrating trips/custom-order out of the meta blob: if the cloud row
        // still carried either legacy dunder key, push back so the stripped
        // meta + the dedicated trips/custom_order columns replace it.
        const legacyDunderPresent =
          '__trips__' in (cloudMeta as Record<string, unknown>)
          || '__custom_order__' in (cloudMeta as Record<string, unknown>);
        if ((cloud.ratings.length === 0 && cloudRatings.length > 0) || listsChanged || listsMergedFromLocal || ratingsMergedFromLocal || wishlistMergedFromLocal || metaMergedFromLocal || homeMealsUsedLocalFallback || metaStashStale || tombstonesRemovedSomething || cloudTombstonesStale || tombGrew || tombstonesRemovedData || cloudTombHadFewer || visitHistoryStale || legacyDunderPresent) {
          await saveUserData(userId, { ratings: cloudRatings, lists: finalLists, wishlist: cloudWishlist, restaurantMeta: cloudMetaWithMeals, recentViews: cloudRecentViews, trips: cloudTrips as Trip[], homeMeals: cloudHomeMeals, customOrder: cloudCustomOrder });
        }

        // Sync ratings to community_ratings (ensures they're visible on user
        // profiles) — DELTAS ONLY. Republishing every row on every load was
        // hundreds of writes per session for heavy raters, and each write
        // reset updated_at, which is what orders the friends feed.
        if (cloudRatings.length > 0) {
          const prevSigs = loadPublishedSigs();
          const nextSigs: Record<string, string> = {};
          for (const r of cloudRatings) {
            const sig = publishSignature(r);
            nextSigs[r.restaurantId] = sig;
            if (prevSigs[r.restaurantId] === sig) continue; // unchanged since last publish
            publishCommunityRating(userId, r.restaurantId, {
              name: r.name, score: r.score, notes: r.notes,
              cuisine: r.cuisine, price: r.price, address: r.address,
              visitDate: r.visitDate, tags: r.tags, wouldReturn: r.wouldReturn,
              friendIds: r.friendIds || [], photoUrl: r.image || '',
            });
            // Reconcile each rating's gallery: publish when known public,
            // clear when there are no photos, and — crucially — DEFER (not
            // delete) when the profile hasn't resolved yet, so a public
            // user's existing photos republish once visibility is known
            // instead of vanishing during sign-in.
            syncCommunityPhotos(r.restaurantId, r.photos);
          }
          // Rebuilt from the current rating set, so deleted ratings' stale
          // signatures fall away instead of accumulating.
          savePublishedSigs(nextSigs);
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
        restaurantMetaRef.current = localMeta;
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
          });
        }
      }

      // Load succeeded (row found, or genuine no-row) — cloud writes are safe.
      cloudLoadFailedRef.current = false;
      cloudReadyRef.current = true;
      setCloudLoaded(true);

      // A mutation landed while the load was in flight: its state change was
      // folded into the merge (the load re-reads localStorage), but its cloud
      // sync was skipped because cloudReadyRef was false. Push the merged
      // localStorage snapshot once so the server converges too. Re-read at
      // call time so anything committed up to this tick is included.
      if (dirtyDuringLoadRef.current) {
        dirtyDuringLoadRef.current = false;
        const uid = userIdRef.current;
        if (uid && supabaseConfigured) {
          saveUserData(uid, {
            ratings: migrateRatings(loadFromStorage<RestaurantRating[]>(STORAGE_KEY_RATINGS, [])),
            lists: migrateLists(loadFromStorage<CustomList[]>(STORAGE_KEY_LISTS, DEFAULT_LISTS)),
            wishlist: migrateWishlist(loadFromStorage<WishlistItem[]>(STORAGE_KEY_WISHLIST, [])),
            restaurantMeta: migrateMeta(loadFromStorage<Record<string, RestaurantMeta>>(STORAGE_KEY_META, {})),
            recentViews: loadFromStorage<unknown[]>('gourmad-recent-views', []),
            trips: loadFromStorage<Trip[]>(STORAGE_KEY_TRIPS, []),
            homeMeals: migrateHomeMeals(loadFromStorage<HomeMeal[]>(STORAGE_KEY_HOME_MEALS, [])),
            customOrder: loadFromStorage<string[]>(STORAGE_KEY_CUSTOM_ORDER, []),
          }).catch(() => { /* best-effort; next mutation/reload will retry */ });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ── Helper to save to Supabase in the background ──
  // A mutation whose sync is skipped because the load is still in flight marks
  // the session dirty; the load's post-commit reconcile pushes the merged
  // localStorage snapshot so the change reaches the cloud (see load effect).
  const skippedBecauseLoading = () => {
    if (userIdRef.current && supabaseConfigured && !cloudReadyRef.current) dirtyDuringLoadRef.current = true;
  };
  // Coalesce same-channel cloud writes issued in one tick. Many legacy
  // mutators still run their sync call inside a setState updater, which
  // StrictMode double-invokes — two immediate writes of (equal) full arrays.
  // Deferring to a microtask and keeping only the LAST payload per channel
  // collapses those duplicates to a single write without rewriting every
  // updater. (localStorage double-writes are idempotent and stay as-is.)
  const pendingCloudWritesRef = useRef(new Map<string, () => void>());
  const queueCloudWrite = useCallback((channel: string, write: () => void) => {
    const pending = pendingCloudWritesRef.current;
    const needsFlush = pending.size === 0;
    pending.set(channel, write);
    if (needsFlush) {
      queueMicrotask(() => {
        const writes = [...pending.values()];
        pending.clear();
        for (const w of writes) w();
      });
    }
  }, []);
  const syncRatingsToCloud = useCallback((data: RestaurantRating[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) {
      queueCloudWrite('ratings', () => {
        if (!userIdRef.current) return;
        // Photos now upload to Storage and are stored as short URLs (see
        // src/lib/images.ts), so oversized inline base64 should be rare. As a
        // safety net, DROP (skip) any remaining data: URL over the limit —
        // never slice it (a sliced base64 is an undecodable image that would
        // sync back down and permanently replace the intact local photo) and
        // never blank it to '' (that leaves a broken empty PhotoItem). Http(s)
        // Storage URLs are always kept regardless of length.
        const stripped = data.map((r) => {
          const kept = r.photos.filter((p) => !(p.url.startsWith('data:') && p.url.length > MAX_INLINE_PHOTO_BYTES));
          if (kept.length !== r.photos.length) {
            console.warn(`[Lists] Dropped ${r.photos.length - kept.length} oversized inline photo(s) for "${r.name}" before cloud sync (upload to Storage instead).`);
          }
          return kept.length === r.photos.length ? r : { ...r, photos: kept };
        });
        saveRatings(userIdRef.current, stripped);
      });
    } else skippedBecauseLoading();
  }, [queueCloudWrite]);
  const syncListsToCloud = useCallback((data: CustomList[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) {
      queueCloudWrite('lists', () => { if (userIdRef.current) saveLists(userIdRef.current, data); });
    } else skippedBecauseLoading();
  }, [queueCloudWrite]);
  const syncWishlistToCloud = useCallback((data: WishlistItem[]) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) {
      queueCloudWrite('wishlist', () => { if (userIdRef.current) saveWishlistData(userIdRef.current, data); });
    } else skippedBecauseLoading();
  }, [queueCloudWrite]);
  const syncMetaToCloud = useCallback((data: Record<string, RestaurantMeta>) => {
    if (cloudReadyRef.current && userIdRef.current && supabaseConfigured) {
      queueCloudWrite('meta', () => { if (userIdRef.current) saveMetaData(userIdRef.current, data); });
    } else skippedBecauseLoading();
  }, [queueCloudWrite]);

  // ── Pending photo upload retry ──
  // processPhoto falls back to an inline data: URL when the Storage upload
  // fails (offline, signed out, transient error) so the photo still renders —
  // but syncRatingsToCloud drops oversized inline URLs from the cloud payload,
  // so without a retry that photo would live on this device forever. The
  // queue is derived (any photo url starting with `data:` is pending — see
  // src/lib/pendingPhotos.ts); this re-runs the upload for each and swaps the
  // inline URL for the Storage URL, then persists + syncs the ratings so the
  // photo finally reaches the cloud and other devices.
  const photoRetryInFlightRef = useRef(false);
  const retryPendingPhotoUploads = useCallback(() => {
    if (photoRetryInFlightRef.current) return;
    if (!supabaseConfigured || !userIdRef.current) return; // upload needs a session
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const pending = collectPendingPhotoUploads(ratingsRef.current);
    if (pending.length === 0) return;
    photoRetryInFlightRef.current = true;
    void (async () => {
      try {
        // Sequential, best-effort: a photo that fails again just stays inline
        // (still in the derived queue) and the next trigger retries it.
        const replacements = new Map<string, string>();
        for (const item of pending) {
          try {
            replacements.set(item.url, await uploadPhoto(item.url));
          } catch { /* still offline / no session — retried on the next trigger */ }
        }
        if (replacements.size === 0) return;
        const { next, changedIds } = applyPhotoUrlReplacements(ratingsRef.current, replacements, Date.now());
        if (changedIds.length === 0) return;
        ratingsRef.current = next;
        setRatings(next);
        saveToStorage(STORAGE_KEY_RATINGS, next);
        syncRatingsToCloud(next);
        // The community gallery mirrors the current visit's photo set — swap
        // the freshly uploaded URLs in there too (visibility gating and the
        // deferred-publish path live inside syncCommunityPhotos).
        for (const id of changedIds) {
          const row = next.find((r) => r.restaurantId === id);
          if (row) syncCommunityPhotos(id, row.photos);
        }
      } finally {
        photoRetryInFlightRef.current = false;
      }
    })();
  }, [syncRatingsToCloud, syncCommunityPhotos]);

  // Retry triggers: boot/sign-in (cloudLoaded flips true after the load
  // reconcile, so the scan sees the merged ratings), app foreground, and
  // connectivity regain. Each run is cheap when nothing is pending.
  useEffect(() => {
    if (!cloudLoaded) return;
    retryPendingPhotoUploads();
    const onOnline = () => retryPendingPhotoUploads();
    const onVisible = () => { if (document.visibilityState === 'visible') retryPendingPhotoUploads(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [cloudLoaded, userId, retryPendingPhotoUploads]);

  // Pure-updater-safe meta commit: computes the next blob from the eager
  // restaurantMetaRef OUTSIDE setState (same-tick calls build on each other),
  // then persists exactly once. The old pattern ran saveToStorage +
  // syncMetaToCloud INSIDE the updater, which StrictMode double-invokes.
  const commitMeta = useCallback((mutate: (prev: Record<string, RestaurantMeta>) => Record<string, RestaurantMeta>) => {
    const prev = restaurantMetaRef.current;
    const next = mutate(prev);
    if (next === prev) return;
    restaurantMetaRef.current = next;
    setRestaurantMeta(next);
    saveToStorage(STORAGE_KEY_META, next);
    syncMetaToCloud(next);
  }, [syncMetaToCloud]);

  // Persist the unified tombstone set to localStorage (always) and the durable
  // __tombstones__ meta stash (cloud, when ready) so deletions stick locally
  // and converge across devices.
  const persistTombstones = useCallback(() => {
    const json = tombstonesToJSON(tombstonesRef.current);
    saveToStorage(STORAGE_KEY_TOMBSTONES, json);
    commitMeta((prev) => ({ ...prev, __tombstones__: json as unknown as RestaurantMeta }));
  }, [commitMeta]);
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

  // Persist the whole local visit-history blob to the cloud. Preferred
  // channel: the dedicated visit_history column (migration 058) — a small,
  // column-scoped write. Fallback: the durable restaurant_meta
  // __visit_history__ stash (always-present column), which re-uploads the
  // entire meta blob — that used to be the ONLY channel, making every
  // logged visit a write-amplifier. Call after any local visit-history
  // mutation. The load path merges BOTH sources.
  const syncVisitHistoryToCloud = useCallback(() => {
    const blob = loadLocalVisitHistory();
    const uid = userIdRef.current;
    if (uid && supabaseConfigured && cloudReadyRef.current) {
      void saveVisitHistoryColumn(uid, blob as unknown as Record<string, unknown[]>).then((ok) => {
        if (!ok) commitMeta((prev) => ({ ...prev, __visit_history__: blob as unknown as RestaurantMeta }));
      });
    } else {
      // Cloud not ready — keep the stash channel so the dirty-during-load
      // reconcile (which pushes the meta blob) carries it.
      commitMeta((prev) => ({ ...prev, __visit_history__: blob as unknown as RestaurantMeta }));
    }
  }, [commitMeta]);
  const syncTripsToCloud = useCallback((data: Trip[]) => {
    if (!userIdRef.current || !supabaseConfigured) return;
    if (!cloudReadyRef.current) { dirtyDuringLoadRef.current = true; return; }
    // Dedicated trips column only (migration 012) — no longer mirrored into
    // restaurant_meta.__trips__, which used to double the clobber surface.
    queueCloudWrite('trips', () => { if (userIdRef.current) saveTrips(userIdRef.current, data); });
  }, [queueCloudWrite]);

  // ── Custom Order ──
  const setCustomOrder = useCallback((order: string[]) => {
    setCustomOrderState(order);
    saveToStorage(STORAGE_KEY_CUSTOM_ORDER, order);
    // Dedicated custom_order column only (migration 038) — no longer mirrored
    // into restaurant_meta.__custom_order__.
    if (!userIdRef.current || !supabaseConfigured) return;
    if (!cloudReadyRef.current) { dirtyDuringLoadRef.current = true; return; }
    queueCloudWrite('customOrder', () => { if (userIdRef.current) saveCustomOrder(userIdRef.current, order); });
  }, [queueCloudWrite]);

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
      // Stamp updatedAt so this edit wins the multi-device merge (trips merge
      // as a whole entity — an unstamped edit would tie the stale cloud copy
      // and lose).
      const next = prev.map((t) => t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t);
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
      const next = prev.map((t) => t.id === tripId ? { ...t, restaurants: [...t.restaurants, restaurant], updatedAt: Date.now() } : t);
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
        updatedAt: Date.now(),
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
        updatedAt: Date.now(),
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
    queueCloudWrite('homeMeals', () => { if (userIdRef.current) saveHomeMeals(userIdRef.current, data); });
    commitMeta((prev) => ({
      ...prev,
      __home_meals__: data as unknown as RestaurantMeta,
      // Carry deletion tombstones in the same durable stash so removals reach
      // the cloud and survive the union on every device.
      __deleted_meals__: Array.from(deletedMealIdsRef.current) as unknown as RestaurantMeta,
    }));
  }, [queueCloudWrite, commitMeta]);

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
      const now = Date.now();
      const next = prev.map((l) => l.id === listId ? { ...l, recipes: (l.recipes || []).map((r) => {
        if (r.id !== recipeId) return r;
        const merged = { ...r, ...updates, updatedAt: now };
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
      const now = Date.now();
      const next = prev.map((m) => {
        if (m.id !== recipeId) return m;
        const merged = { ...m, ...recipeUpdatesToHomeMeal(updates), updatedAt: now };
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
    commitMeta((prev) => {
      const stash = ((prev as Record<string, unknown>).__cook_photos__ ?? {}) as Record<string, unknown>;
      if (!(recipeId in stash)) return prev;
      const nextStash = { ...stash };
      delete nextStash[recipeId];
      return { ...prev, __cook_photos__: nextStash as unknown as RestaurantMeta };
    });
  }, [removeRecipe, commitMeta]);

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
      const now = Date.now();
      const next = prev.map((m) => {
        if (m.id !== id) return m;
        // Stamp updatedAt so an offline edit wins the merge (home meals merge
        // whole-entity newer-wins).
        const merged = { ...m, ...updates, updatedAt: now };
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

  const [addToListModalOpen, setAddToListModalOpen] = useState(false);
  const [addToListRestaurantId, setAddToListRestaurantId] = useState<string | null>(null);
  const [addRestaurantModalOpen, setAddRestaurantModalOpen] = useState(false);
  const [addRestaurantModalMeta, setAddRestaurantModalMeta] = useState<RestaurantMeta | null>(null);
  const [addRestaurantModalInitialPage, setAddRestaurantModalInitialPage] = useState<string | null>(null);
  const [homeMealModalOpen, setHomeMealModalOpen] = useState(false);
  const [homeMealModalData, setHomeMealModalData] = useState<HomeMeal | null>(null);
  const [homeMealModalBackToDraft, setHomeMealModalBackToDraft] = useState<(() => void) | null>(null);
  const [homeMealModalInitialMethod, setHomeMealModalInitialMethod] = useState<'link' | 'photo' | 'text' | 'custom' | 'ai' | null>(null);
  const [homeMealModalTargetListId, setHomeMealModalTargetListId] = useState<string | null>(null);

  // Restaurant metadata cache
  const cacheRestaurantMeta = useCallback((meta: Partial<RestaurantMeta> & { id: string }) => {
    // Defensively strip any Google Places photo URL so we never persist a
    // URL whose render would trigger a billed Google API call.
    const cleaned: Partial<RestaurantMeta> & { id: string } = {
      ...meta,
      ...(meta.image !== undefined ? { image: safeImage(meta.image) } : {}),
    };
    commitMeta((prev) => {
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
      return { ...prev, [cleaned.id]: merged };
    });
  }, [commitMeta]);

  const stashMetaKey = useCallback((key: string, value: unknown) => {
    commitMeta((prev) => ({ ...prev, [key]: value as RestaurantMeta }));
  }, [commitMeta]);

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
    // Record what was published so the boot-time delta sync skips this row.
    stampPublishedSig(row);
  }, []);

  const rateRestaurant = useCallback((rating: RestaurantRating, options?: { isNewVisit?: boolean; settleOrder?: string[]; skipSettle?: boolean }) => {
    // When `isNewVisit` is true the caller is logging a brand-new
    // visit on top of an existing rating, and the previously-current
    // record needs to be pushed into visit history. When it's false
    // (or absent), this call is just editing the current rating in
    // place — we replace the row and leave visit history alone.
    const isNewVisit = options?.isNewVisit === true;
    // Re-rating a previously-deleted restaurant clears its tombstone so it
    // isn't filtered straight back out on the next load.
    untombstone('restaurants', rating.restaurantId);
    // Derive the save from the freshest ratings we know about — ratingsRef,
    // not the render closure. Same-tick saves (bulk import, fast double-save)
    // each assign the ref before returning, so every call builds on the one
    // before it instead of deriving from the same pre-save snapshot and
    // silently dropping the earlier save. All side effects (persistence,
    // cloud mirror, publish, toast) stay OUT of the setRatings updater —
    // updaters run during render and StrictMode invokes them twice.
    const prevRatings = ratingsRef.current;
    const { next, existing: existingForArchive, settledSelf, otherChanged } = applyRatingSave(
      prevRatings,
      rating,
      { now: Date.now(), settleOrder: options?.settleOrder, skipSettle: options?.skipSettle },
    );
    const wasRated = existingForArchive !== undefined;
    // Only archive the existing rating when this is genuinely a new visit.
    // Skipping this on edits is what stops "Update Current" from creating a
    // phantom history entry every time the user tweaks a note or a tag. The
    // write goes to localStorage (synchronous, survives reloads), the durable
    // user_app_data stash (cross-device, always works), AND the best-effort
    // visit_history table (a no-op where the table is absent).
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
    // Commit. The eager ref assignment is what serializes a same-tick
    // follow-up save (it reads `next` instead of a stale snapshot); the
    // render-time sync re-aligns the ref with committed state afterwards.
    ratingsRef.current = next;
    setRatings(next);
    saveToStorage(STORAGE_KEY_RATINGS, next);
    syncRatingsToCloud(next);
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
    // Rating a wishlisted restaurant graduates it off the wishlist — it has
    // been visited now. Mirrors removeFromWishlist (declared below, so the
    // logic is inlined): tombstone the entry so a stale cloud copy can't
    // resurrect it, drop it from the wishlist array, and strip it from every
    // list's want-to-try (wishlistIds) section. The listIds block above may
    // have just added the restaurant to those lists' RATED section, so this
    // reads as "moved from want-to-try to been".
    const wasWishlisted = wishlistRef.current.some((w) => w.restaurantId === rating.restaurantId);
    if (wasWishlisted) {
      tombstone('wishlist', rating.restaurantId);
      // Eagerly drop it from the mirror so a second same-tick save of this
      // restaurant doesn't tombstone + toast "removed from wishlist" again.
      // The state update stays a functional updater: bulk import queues
      // addToWishlist calls in the same tick, and a direct set from the ref
      // would clobber them. Render-time sync re-aligns the ref afterwards.
      wishlistRef.current = wishlistRef.current.filter((w) => w.restaurantId !== rating.restaurantId);
      setWishlist((prev) => {
        const nextW = prev.filter((w) => w.restaurantId !== rating.restaurantId);
        saveToStorage(STORAGE_KEY_WISHLIST, nextW);
        syncWishlistToCloud(nextW);
        return nextW;
      });
      setLists((prev) => {
        const nextL = prev.map((l) => l.wishlistIds.includes(rating.restaurantId)
          ? { ...l, wishlistIds: l.wishlistIds.filter((r) => r !== rating.restaurantId) }
          : l);
        saveToStorage(STORAGE_KEY_LISTS, nextL);
        syncListsToCloud(nextL);
        return nextL;
      });
    }
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
      // Reconcile the community gallery with this save. Removal happens ONLY
      // when the photo set is empty (an intentional removal); a save made
      // before the profile resolves defers the publish rather than deleting
      // — the old "else remove" branch wiped a public user's existing gallery
      // when they rated right after sign-in (isPublicRef still false).
      syncCommunityPhotos(rating.restaurantId, rating.photos);
    }
    showToast(
      wasRated ? 'Rating updated' : 'Added to rated restaurants',
      {
        subtitle: `${rating.name} · ${settledSelf.score.toFixed(1)} / 10${wasWishlisted ? ' · removed from wishlist' : ''}${otherChanged.length > 0 ? ' · nearby ratings adjusted' : ''}`,
        variant: wasRated ? 'rating-updated' : 'rated',
      },
    );
  }, [cacheRestaurantMeta, syncRatingsToCloud, syncListsToCloud, syncWishlistToCloud, showToast, tombstone, untombstone, syncVisitHistoryToCloud, publishRatingRow]);

  const updateRating = useCallback((restaurantId: string, partial: Partial<RestaurantRating>) => {
    // Compute from the eager ref and keep every side effect OUT of the
    // setState updater — StrictMode double-invokes updaters, which used to
    // publish the community row twice per edit.
    const prev = ratingsRef.current;
    const now = Date.now();
    const next = prev.map((r) => r.restaurantId === restaurantId ? { ...r, ...partial, updatedAt: now } : r);
    ratingsRef.current = next;
    setRatings(next);
    saveToStorage(STORAGE_KEY_RATINGS, next);
    syncRatingsToCloud(next);
    // Keep the community copy in step — without this, reorder/edit paths
    // left profiles showing the stale pre-edit score until next boot.
    const row = next.find((r) => r.restaurantId === restaurantId);
    if (row && userIdRef.current) publishRatingRow(userIdRef.current, row);
  }, [syncRatingsToCloud, publishRatingRow]);

  const applySettledScores = useCallback((changes: SettleChange[]) => {
    if (changes.length === 0) return;
    const prev = ratingsRef.current;
    // Drop no-ops so a save with nothing to do stays a no-op end to end.
    const real = changes.filter((c) => {
      const row = prev.find((r) => r.restaurantId === c.restaurantId);
      return row !== undefined && row.score !== c.score;
    });
    if (real.length === 0) return;
    const now = Date.now();
    const changedIds = new Set(real.map((c) => c.restaurantId));
    const next = applySettleChanges(prev, real)
      .map((r) => (changedIds.has(r.restaurantId) ? { ...r, updatedAt: now } : r));
    ratingsRef.current = next;
    setRatings(next);
    saveToStorage(STORAGE_KEY_RATINGS, next);
    syncRatingsToCloud(next);
    const uid = userIdRef.current;
    if (uid) {
      for (const c of real) {
        const row = next.find((r) => r.restaurantId === c.restaurantId);
        if (row) publishRatingRow(uid, row);
      }
    }
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
      // Drop any deferred publish first so it can't republish this gallery
      // after we clear it.
      pendingPhotoPublishRef.current.delete(restaurantId);
      removeCommunityRating(userIdRef.current, restaurantId);
      removeCommunityPhotos(userIdRef.current, restaurantId);
      deleteAllVisitRecordsForRestaurant(userIdRef.current, restaurantId).catch(() => {
        console.warn('[VisitHistory] Failed to delete visit records for', restaurantId);
      });
    }
  }, [syncRatingsToCloud, syncListsToCloud, tombstone, syncVisitHistoryToCloud]);

  // ── Legacy hotels purge ──
  // migrateRatings / migrateWishlist silently drop legacy hotel entries
  // (cuisine 'Hotel' / 'Hotel Breakfast') on every load. Once the cloud
  // load settles, finish the job the way removeRating would: tombstone the
  // ids (so a stale device's copy can't resurrect them), clear their list
  // memberships and custom-order slots, and delete the published community
  // rows / photo galleries / visit records. Also sweeps MY community_ratings
  // rows directly — a published hotel row can outlive its local copy.
  const hotelPurgeDoneForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cloudLoaded || !userId || hotelPurgeDoneForRef.current === userId) return;
    hotelPurgeDoneForRef.current = userId;
    (async () => {
      const ids = new Set(purgedHotelIds);
      if (supabaseConfigured) {
        try {
          const mine = await getUserRatings(userId);
          for (const row of mine) {
            if (isLegacyHotelEntry(row.cuisine)) ids.add(row.restaurant_id);
          }
        } catch { /* best-effort — local ids still purge */ }
      }
      for (const id of purgedHotelWishlistIds) tombstone('wishlist', id);
      purgedHotelWishlistIds.clear();
      if (ids.size === 0) return;
      for (const id of ids) tombstone('restaurants', id);
      setLists((prev) => {
        let changed = false;
        const next = prev.map((l) => {
          const restaurantIds = l.restaurantIds.filter((id) => !ids.has(id));
          const wishlistIds = (l.wishlistIds || []).filter((id) => !ids.has(id));
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
        const next = prev.filter((id) => !ids.has(id));
        if (next.length === prev.length) return prev;
        saveToStorage(STORAGE_KEY_CUSTOM_ORDER, next);
        return next;
      });
      for (const id of ids) {
        pendingPhotoPublishRef.current.delete(id);
        clearLocalVisitHistory(id);
        if (supabaseConfigured) {
          removeCommunityRating(userId, id);
          removeCommunityPhotos(userId, id);
          deleteAllVisitRecordsForRestaurant(userId, id).catch(() => {
            console.warn('[Hotels purge] Failed to delete visit records for', id);
          });
        }
      }
      syncVisitHistoryToCloud();
      purgedHotelIds.clear();
    })();
  }, [cloudLoaded, userId, tombstone, syncListsToCloud, syncVisitHistoryToCloud]);

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
      // fields like address / cuisine / lists are preserved. Computed
      // from ratingsRef BEFORE the set (same pattern as rateRestaurant):
      // the old version assigned the promoted row inside the setRatings
      // updater and read it right after, but React only runs updaters
      // later (at render), so the publish below saw null and silently
      // skipped — friends kept seeing the deleted visit's score until
      // the next boot-time full republish.
      const existing = ratingsRef.current.find((r) => r.restaurantId === restaurantId);
      if (existing) {
        const now = Date.now();
        const promoted: RestaurantRating = {
          ...existing,
          score: Number(promote.score),
          notes: promote.notes || '',
          visitDate: promote.visit_date || '',
          tags: promote.tags || [],
          wouldReturn: promote.would_return !== undefined ? !!promote.would_return : existing.wouldReturn,
          photos: promote.photos || [],
          friendIds: promote.friend_ids || [],
          createdAt: now,
          // Stamp updatedAt too: the merge reads it with PRECEDENCE over
          // createdAt, so spreading `existing` would carry the old stamp
          // and let a stale pre-promotion copy from another device win.
          updatedAt: now,
        };
        const next = [promoted, ...ratingsRef.current.filter((r) => r.restaurantId !== restaurantId)];
        ratingsRef.current = next;
        setRatings(next);
        saveToStorage(STORAGE_KEY_RATINGS, next);
        syncRatingsToCloud(next);
        // Keep the community-published row in sync with the promoted data.
        if (userIdRef.current) {
          publishCommunityRating(userIdRef.current, restaurantId, {
            name: promoted.name,
            score: promoted.score,
            notes: promoted.notes,
            cuisine: promoted.cuisine,
            price: promoted.price,
            address: promoted.address,
            visitDate: promoted.visitDate,
            tags: promoted.tags,
            wouldReturn: promoted.wouldReturn,
            friendIds: promoted.friendIds || [],
            photoUrl: promoted.image || '',
          });
          // The promoted visit's photo set replaces the deleted visit's in
          // the community gallery (or clears it if the promoted visit has
          // no photos) — the gallery must always mirror the *current* visit.
          // Same decoupling as rateRestaurant: only an empty set removes;
          // unknown visibility defers rather than deleting.
          syncCommunityPhotos(restaurantId, promoted.photos);
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
      // Stamp updatedAt so a rename made offline wins the merge (list scalar
      // fields merge newer-wins; without a stamp the rename ties the stale
      // cloud name and loses).
      const next = prev.map((l) => l.id === id ? { ...l, name, emoji, updatedAt: Date.now() } : l);
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
      const now = Date.now();
      const next = prev.map((l) => {
        if (l.id !== listId) return l;
        // Stamp both the rating and the LIST: the merge picks a list's
        // listRatings map by the LIST's updatedAt (whole-map), so the edit only
        // survives if this list wins.
        const listRatings = { ...(l.listRatings || {}), [rating.restaurantId]: { ...rating, updatedAt: now } };
        const restaurantIds = l.restaurantIds.includes(rating.restaurantId) ? l.restaurantIds : [...l.restaurantIds, rating.restaurantId];
        return { ...l, listRatings, restaurantIds, updatedAt: now };
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
    // Stamp updatedAt: this is the note-edit path (an existing item is replaced
    // with edited notes/listIds), and addedAt alone would tie the stale cloud
    // copy in the merge and lose the edit.
    const stamped: WishlistItem = { ...item, updatedAt: Date.now() };
    setWishlist((prev) => {
      const existing = prev.find((w) => w.restaurantId === stamped.restaurantId);
      const next = existing
        ? prev.map((w) => w.restaurantId === stamped.restaurantId ? stamped : w)
        : [stamped, ...prev];
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
  // `opts.undoable` adds an Undo action to the toast — used when the AI
  // assistant makes the change, so a prompt-injected toggle is trivially
  // reversible. `opts.silent` suppresses the toast (used by the Undo action
  // itself so reversing doesn't spawn another toast).
  const toggleWishlist = useCallback((restaurant: RestaurantMeta, opts?: { undoable?: boolean; silent?: boolean }) => {
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
    if (opts?.silent) return;
    showToast(isOn ? 'Removed from wishlist' : 'Added to wishlist', {
      subtitle: restaurant.name,
      variant: isOn ? 'wishlist-remove' : 'wishlist-add',
      // Undo re-toggles through the latest closure (fresh wishlist state),
      // silently so it doesn't chain another toast.
      ...(opts?.undoable
        ? { action: { label: 'Undo', onClick: () => toggleWishlistRef.current(restaurant, { silent: true }) } }
        : {}),
    });
  }, [wishlist, cacheRestaurantMeta, syncWishlistToCloud, syncListsToCloud, showToast, tombstone, untombstone]);

  // Ref to the latest toggleWishlist so a toast's Undo action (captured at
  // show time) always reverses against current state.
  const toggleWishlistRef = useRef(toggleWishlist);
  useEffect(() => { toggleWishlistRef.current = toggleWishlist; }, [toggleWishlist]);

  // Modals
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

  const openHomeMealModal = useCallback((meal?: HomeMeal, opts?: { onBackToDraft?: () => void; targetListId?: string; initialMethod?: 'link' | 'photo' | 'text' | 'custom' | 'ai' }) => {
    if (!userIdRef.current) { requireSignIn('Sign in to log a home meal'); return; }
    setHomeMealModalData(meal || null);
    // Store as a value-returning thunk so React doesn't treat the
    // callback as a state updater.
    setHomeMealModalBackToDraft(() => opts?.onBackToDraft ?? null);
    setHomeMealModalTargetListId(opts?.targetListId ?? null);
    setHomeMealModalInitialMethod(opts?.initialMethod ?? null);
    setHomeMealModalOpen(true);
  }, []);
  const closeHomeMealModal = useCallback(() => {
    setHomeMealModalOpen(false);
    setHomeMealModalData(null);
    setHomeMealModalBackToDraft(null);
    setHomeMealModalTargetListId(null);
    setHomeMealModalInitialMethod(null);
  }, []);

  // Derived pending-upload badge for the settings sheet — recomputed only
  // when ratings actually change.
  const pendingPhotoUploadCount = useMemo(() => countPendingPhotoUploads(ratings), [ratings]);

  return (
    <ListsContext.Provider value={{
      ratings, rateRestaurant, updateRating, applySettledScores, removeRating, getRating, deleteVisit,
      pendingPhotoUploadCount, retryPendingPhotoUploads,
      lists, createList, deleteList, renameList, addToList, removeFromList, addToWishlistInList, removeFromWishlistInList, getListsForRestaurant, setListRating, getListRating,
      restaurantMeta, cacheRestaurantMeta, getRestaurantInfo, stashMetaKey,
      wishlist, addToWishlist, removeFromWishlist, toggleWishlist, isWishlisted, getWishlistItem,
      addToListModalOpen, addToListRestaurantId, openAddToListModal, closeAddToListModal,
      addRestaurantModalOpen, addRestaurantModalMeta, addRestaurantModalInitialPage, openAddRestaurantModal, closeAddRestaurantModal,
      addRecipe, updateRecipe, removeRecipe, getRecipes,
      addRecipeToList, addRecipeToCookedList, removeRecipeFromCookedList, removeRecipeFromList, getListsForRecipe,
      addRecipeToCookbook, removeRecipeFromCookbook,
      addRecipeModalOpen, addRecipeModalListId, addRecipeModalRecipe, openAddRecipeModal, closeAddRecipeModal,
      trips, createTrip, updateTrip, deleteTrip, addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip,
      customOrder, setCustomOrder,
      homeMeals, createHomeMeal, createHomeMealsBulk, updateHomeMeal, deleteHomeMeal, getHomeMeal,
      homeMealModalOpen, homeMealModalData, homeMealModalBackToDraft, homeMealModalTargetListId, homeMealModalInitialMethod, openHomeMealModal, closeHomeMealModal,
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
