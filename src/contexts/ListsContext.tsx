import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { supabaseConfigured } from '../lib/supabase';
import { loadUserData, saveRatings, saveLists, saveWishlistData, saveMetaData, saveUserData, saveRecentViews, saveTrips, saveHomeMeals } from '../lib/supabase-db';
import { publishCommunityRating, removeCommunityRating, publishCommunityPhotos, removeCommunityPhotos } from '../lib/supabase-community';
import { useAuth } from './AuthContext';

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
}

export interface CustomList {
  id: string;
  name: string;
  emoji: string;
  type?: 'default' | 'hotel-breakfast'; // special list types
  restaurantIds: string[];   // rated restaurants
  wishlistIds: string[];     // wishlisted restaurants
  listRatings?: Record<string, RestaurantRating>; // per-list rating overrides keyed by restaurantId
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

export interface HomeMeal {
  id: string;
  name: string;
  date: string;            // ISO date string
  score: number;           // 0–10
  description: string;
  photos: PhotoItem[];
  tags: string[];
  dishes: HomeMealDish[];
  isPublic: boolean;
  createdAt: number;
}

interface ListsContextValue {
  // Ratings
  ratings: RestaurantRating[];
  rateRestaurant: (rating: RestaurantRating) => void;
  updateRating: (restaurantId: string, rating: Partial<RestaurantRating>) => void;
  removeRating: (restaurantId: string) => void;
  getRating: (restaurantId: string) => RestaurantRating | undefined;

  // Custom lists
  lists: CustomList[];
  createList: (name: string, emoji: string, type?: CustomList['type']) => void;
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
  cacheRestaurantMeta: (meta: RestaurantMeta) => void;
  getRestaurantInfo: (restaurantId: string) => RestaurantMeta | undefined;

  // Wishlist
  wishlist: WishlistItem[];
  addToWishlist: (item: WishlistItem) => void;
  removeFromWishlist: (restaurantId: string) => void;
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
  wishlistModalOpen: boolean;
  wishlistModalMeta: RestaurantMeta | null;
  openWishlistModal: (restaurant: RestaurantMeta) => void;
  closeWishlistModal: () => void;

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

  // Home meals
  homeMeals: HomeMeal[];
  createHomeMeal: (meal: Omit<HomeMeal, 'id' | 'createdAt'>) => HomeMeal;
  updateHomeMeal: (id: string, updates: Partial<HomeMeal>) => void;
  deleteHomeMeal: (id: string) => void;
  getHomeMeal: (id: string) => HomeMeal | undefined;

  // Home meal modal
  homeMealModalOpen: boolean;
  homeMealModalData: HomeMeal | null;
  openHomeMealModal: (meal?: HomeMeal) => void;
  closeHomeMealModal: () => void;
}

const STORAGE_KEY_RATINGS = 'gourmad-ratings';
const STORAGE_KEY_LISTS = 'gourmad-lists';
const STORAGE_KEY_WISHLIST = 'gourmad-wishlist';
const STORAGE_KEY_META = 'gourmad-restaurant-meta';
const STORAGE_KEY_TRIPS = 'gourmad-trips';
const STORAGE_KEY_HOME_MEALS = 'gourmad-home-meals';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

const DEFAULT_LISTS: CustomList[] = [
  { id: 'date-nights', name: 'Date Nights', emoji: '🕯️', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 4000 },
  { id: 'hidden-gems', name: 'Hidden Gems', emoji: '💎', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 3000 },
  { id: 'best-cocktails', name: 'Best Cocktails', emoji: '🍸', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 2000 },
  { id: 'quick-bites', name: 'Quick Bites', emoji: '⚡', restaurantIds: [], wishlistIds: [], createdAt: Date.now() - 1000 },
];

// Migration: add wishlistIds to lists that don't have it
function migrateLists(lists: CustomList[]): CustomList[] {
  return lists.map((l) => ({
    ...l,
    wishlistIds: l.wishlistIds ?? [],
  }));
}

// Migration: add listIds, photos to ratings that don't have them
function migrateRatings(ratings: RestaurantRating[]): RestaurantRating[] {
  return ratings.map((r) => ({
    ...r,
    listIds: r.listIds ?? [],
    friendIds: r.friendIds ?? [],
    photos: (r.photos ?? []).map((p: PhotoItem | string) =>
      typeof p === 'string' ? { url: p, caption: '', isFavorite: false } : p
    ),
  }));
}

// Migration: add notes, listIds to wishlist items that don't have them
function migrateWishlist(items: WishlistItem[]): WishlistItem[] {
  return items.map((w) => ({
    ...w,
    notes: w.notes ?? '',
    listIds: w.listIds ?? [],
  }));
}

const ListsContext = createContext<ListsContextValue | null>(null);

export const ListsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, profile: authProfile } = useAuth();
  const userId = user?.id ?? null;

  const [ratings, setRatings] = useState<RestaurantRating[]>(() => migrateRatings(loadFromStorage(STORAGE_KEY_RATINGS, [])));
  const [lists, setLists] = useState<CustomList[]>(() => migrateLists(loadFromStorage(STORAGE_KEY_LISTS, DEFAULT_LISTS)));
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => migrateWishlist(loadFromStorage(STORAGE_KEY_WISHLIST, [])));
  const [restaurantMeta, setRestaurantMeta] = useState<Record<string, RestaurantMeta>>(() => loadFromStorage(STORAGE_KEY_META, {}));
  const [trips, setTrips] = useState<Trip[]>(() => loadFromStorage(STORAGE_KEY_TRIPS, []));
  const [homeMeals, setHomeMeals] = useState<HomeMeal[]>(() => loadFromStorage(STORAGE_KEY_HOME_MEALS, []));
  const [cloudLoaded, setCloudLoaded] = useState(false);

  // Track userId and profile for cloud save helpers
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const isPublicRef = useRef(authProfile?.is_public ?? true);
  isPublicRef.current = authProfile?.is_public ?? true;

  // ── Load data from Supabase when user signs in ──
  useEffect(() => {
    if (!userId || !supabaseConfigured) {
      if (!supabaseConfigured) console.warn('[Supabase] Not configured — data will only be in localStorage');
      if (!userId) console.log('[Supabase] No user signed in');
      return;
    }

    // Check if localStorage belongs to a different user — if so, clear it
    const storedUserId = localStorage.getItem('gourmad-user-id');
    if (storedUserId && storedUserId !== userId) {
      console.log('[Supabase] Different user detected, clearing local cache');
      localStorage.removeItem(STORAGE_KEY_RATINGS);
      localStorage.removeItem(STORAGE_KEY_LISTS);
      localStorage.removeItem(STORAGE_KEY_WISHLIST);
      localStorage.removeItem(STORAGE_KEY_META);
      localStorage.removeItem(STORAGE_KEY_TRIPS);
      localStorage.removeItem(STORAGE_KEY_HOME_MEALS);
      localStorage.removeItem('gourmad-recent-views');
      // Reset state to empty
      setRatings([]);
      setLists(DEFAULT_LISTS);
      setWishlist([]);
      setRestaurantMeta({});
      setTrips([]);
      setHomeMeals([]);
    }
    localStorage.setItem('gourmad-user-id', userId);

    let cancelled = false;
    console.log('[Supabase] Loading cloud data for user:', userId);

    (async () => {
      const cloud = await loadUserData(userId);
      if (cancelled) return;

      if (cloud && (cloud.ratings.length > 0 || cloud.lists.length > 0 || cloud.wishlist.length > 0)) {
        // Cloud data found with actual content — use it
        const cloudRatings = migrateRatings(cloud.ratings || []);
        const cloudLists = migrateLists(cloud.lists.length > 0 ? cloud.lists : DEFAULT_LISTS);
        const cloudWishlist = migrateWishlist(cloud.wishlist || []);
        const cloudMeta = cloud.restaurantMeta || {};
        // Restore trips: try dedicated column first, fall back to __trips__ in meta
        const cloudTrips = ((cloud as any).trips && (cloud as any).trips.length > 0)
          ? (cloud as any).trips
          : (Array.isArray((cloudMeta as any).__trips__) ? (cloudMeta as any).__trips__ : []);
        const cloudRecentViews = cloud.recentViews || [];
        const cloudHomeMeals = cloud.homeMeals || [];

        setRatings(cloudRatings);
        setLists(cloudLists);
        setWishlist(cloudWishlist);
        setRestaurantMeta(cloudMeta);
        setTrips(cloudTrips as Trip[]);
        setHomeMeals(cloudHomeMeals);

        // Also update localStorage as cache
        saveToStorage(STORAGE_KEY_RATINGS, cloudRatings);
        saveToStorage(STORAGE_KEY_LISTS, cloudLists);
        saveToStorage(STORAGE_KEY_WISHLIST, cloudWishlist);
        saveToStorage(STORAGE_KEY_META, cloudMeta);
        saveToStorage(STORAGE_KEY_TRIPS, cloudTrips);
        saveToStorage(STORAGE_KEY_HOME_MEALS, cloudHomeMeals);
        if (cloudRecentViews.length > 0) {
          localStorage.setItem('gourmad-recent-views', JSON.stringify(cloudRecentViews));
        }

        console.log('[Supabase] Loaded user data from cloud:', cloudRatings.length, 'ratings,', cloudLists.length, 'lists,', cloudWishlist.length, 'wishlist,', cloudRecentViews.length, 'recent views');

        // Sync all ratings to community_ratings (ensures they're visible on user profiles)
        if (cloudRatings.length > 0) {
          console.log('[Supabase] Syncing', cloudRatings.length, 'ratings to community_ratings...');
          for (const r of cloudRatings) {
            publishCommunityRating(userId, r.restaurantId, {
              name: r.name, score: r.score, notes: r.notes,
              cuisine: r.cuisine, price: r.price, address: r.address,
              visitDate: r.visitDate, tags: r.tags, wouldReturn: r.wouldReturn,
              friendIds: r.friendIds || [], photoUrl: r.image || '',
            });
            if (r.photos && r.photos.length > 0 && isPublicRef.current) {
              publishCommunityPhotos(userId, r.restaurantId, r.photos).catch(() => {});
            }
          }
        }
      } else {
        // No cloud data — start fresh for this user (don't sync stale localStorage)
        console.log('[Supabase] No cloud data found for user, starting fresh');
        setRatings([]);
        setLists(DEFAULT_LISTS);
        setWishlist([]);
        setRestaurantMeta({});
        setTrips([]);
        setHomeMeals([]);

        // Save empty state to cloud
        await saveUserData(userId, {
          ratings: [],
          lists: DEFAULT_LISTS,
          wishlist: [],
          restaurantMeta: {},
          recentViews: [],
          trips: [],
          homeMeals: [],
        });

        // Clear localStorage
        saveToStorage(STORAGE_KEY_RATINGS, []);
        saveToStorage(STORAGE_KEY_LISTS, DEFAULT_LISTS);
        saveToStorage(STORAGE_KEY_WISHLIST, []);
        saveToStorage(STORAGE_KEY_META, {});
        saveToStorage(STORAGE_KEY_TRIPS, []);
        saveToStorage(STORAGE_KEY_HOME_MEALS, []);
        localStorage.setItem('gourmad-recent-views', '[]');
      }

      setCloudLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ── Helper to save to Supabase in the background ──
  const syncRatingsToCloud = useCallback((data: RestaurantRating[]) => {
    if (userIdRef.current && supabaseConfigured) {
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
    if (userIdRef.current && supabaseConfigured) saveLists(userIdRef.current, data);
  }, []);
  const syncWishlistToCloud = useCallback((data: WishlistItem[]) => {
    if (userIdRef.current && supabaseConfigured) saveWishlistData(userIdRef.current, data);
  }, []);
  const syncMetaToCloud = useCallback((data: Record<string, RestaurantMeta>) => {
    if (userIdRef.current && supabaseConfigured) saveMetaData(userIdRef.current, data);
  }, []);
  const syncTripsToCloud = useCallback((data: Trip[]) => {
    if (userIdRef.current && supabaseConfigured) {
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
    setTrips((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveToStorage(STORAGE_KEY_TRIPS, next);
      syncTripsToCloud(next);
      return next;
    });
  }, [syncTripsToCloud]);

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

  // ── Home Meal sync + CRUD ──
  const syncHomeMealsToCloud = useCallback((data: HomeMeal[]) => {
    if (userIdRef.current && supabaseConfigured) saveHomeMeals(userIdRef.current, data);
  }, []);

  const createHomeMeal = useCallback((meal: Omit<HomeMeal, 'id' | 'createdAt'>): HomeMeal => {
    const newMeal: HomeMeal = { ...meal, id: `meal-${Date.now()}`, createdAt: Date.now() };
    setHomeMeals((prev) => {
      const next = [...prev, newMeal];
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
    return newMeal;
  }, [syncHomeMealsToCloud]);

  const updateHomeMeal = useCallback((id: string, updates: Partial<HomeMeal>) => {
    setHomeMeals((prev) => {
      const next = prev.map((m) => m.id === id ? { ...m, ...updates } : m);
      saveToStorage(STORAGE_KEY_HOME_MEALS, next);
      syncHomeMealsToCloud(next);
      return next;
    });
  }, [syncHomeMealsToCloud]);

  const deleteHomeMeal = useCallback((id: string) => {
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
  const [wishlistModalOpen, setWishlistModalOpen] = useState(false);
  const [wishlistModalMeta, setWishlistModalMeta] = useState<RestaurantMeta | null>(null);
  const [homeMealModalOpen, setHomeMealModalOpen] = useState(false);
  const [homeMealModalData, setHomeMealModalData] = useState<HomeMeal | null>(null);

  // Restaurant metadata cache
  const cacheRestaurantMeta = useCallback((meta: RestaurantMeta) => {
    setRestaurantMeta((prev) => {
      const next = { ...prev, [meta.id]: meta };
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
  const rateRestaurant = useCallback((rating: RestaurantRating) => {
    setRatings((prev) => {
      const next = [rating, ...prev.filter((r) => r.restaurantId !== rating.restaurantId)];
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
    // Publish to community
    if (userIdRef.current) {
      publishCommunityRating(userIdRef.current, rating.restaurantId, {
        name: rating.name, score: rating.score, notes: rating.notes,
        cuisine: rating.cuisine, price: rating.price, address: rating.address,
        visitDate: rating.visitDate, tags: rating.tags, wouldReturn: rating.wouldReturn,
        friendIds: rating.friendIds || [], photoUrl: rating.image || '',
      });
      // Only publish photos to community if account is public
      if (rating.photos && rating.photos.length > 0 && isPublicRef.current) {
        publishCommunityPhotos(userIdRef.current, rating.restaurantId, rating.photos).catch(() => {
          console.warn('[Supabase] Failed to publish photos — they may be too large for the database');
        });
      }
    }
  }, [cacheRestaurantMeta, syncRatingsToCloud, syncListsToCloud]);

  const updateRating = useCallback((restaurantId: string, partial: Partial<RestaurantRating>) => {
    setRatings((prev) => {
      const next = prev.map((r) => r.restaurantId === restaurantId ? { ...r, ...partial } : r);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
  }, [syncRatingsToCloud]);

  const removeRating = useCallback((restaurantId: string) => {
    setRatings((prev) => {
      const next = prev.filter((r) => r.restaurantId !== restaurantId);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      syncRatingsToCloud(next);
      return next;
    });
    if (userIdRef.current) {
      removeCommunityRating(userIdRef.current, restaurantId);
      removeCommunityPhotos(userIdRef.current, restaurantId);
    }
  }, [syncRatingsToCloud]);

  const getRating = useCallback((restaurantId: string) => ratings.find((r) => r.restaurantId === restaurantId), [ratings]);

  // Lists
  const createList = useCallback((name: string, emoji: string, type?: CustomList['type']) => {
    setLists((prev) => {
      const next = [...prev, { id: `list-${Date.now()}`, name, emoji, ...(type ? { type } : {}), restaurantIds: [], wishlistIds: [], createdAt: Date.now() }];
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const deleteList = useCallback((id: string) => {
    setLists((prev) => {
      const next = prev.filter((l) => l.id !== id);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const renameList = useCallback((id: string, name: string, emoji: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === id ? { ...l, name, emoji } : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const addToList = useCallback((listId: string, restaurantId: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId && !l.restaurantIds.includes(restaurantId)
        ? { ...l, restaurantIds: [...l.restaurantIds, restaurantId] }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const removeFromList = useCallback((listId: string, restaurantId: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId
        ? { ...l, restaurantIds: l.restaurantIds.filter((r) => r !== restaurantId) }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const addToWishlistInList = useCallback((listId: string, restaurantId: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId && !l.wishlistIds.includes(restaurantId)
        ? { ...l, wishlistIds: [...l.wishlistIds, restaurantId] }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

  const removeFromWishlistInList = useCallback((listId: string, restaurantId: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId
        ? { ...l, wishlistIds: l.wishlistIds.filter((r) => r !== restaurantId) }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      syncListsToCloud(next);
      return next;
    });
  }, [syncListsToCloud]);

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
  }, [cacheRestaurantMeta, syncWishlistToCloud, syncListsToCloud]);

  const removeFromWishlist = useCallback((restaurantId: string) => {
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
  }, [syncWishlistToCloud, syncListsToCloud]);

  const isWishlisted = useCallback((restaurantId: string) => wishlist.some((w) => w.restaurantId === restaurantId), [wishlist]);

  const getWishlistItem = useCallback((restaurantId: string) => wishlist.find((w) => w.restaurantId === restaurantId), [wishlist]);

  // Modals
  const openRatingModal = useCallback((restaurant: RestaurantMeta) => {
    cacheRestaurantMeta(restaurant);
    setRatingModalRestaurant(restaurant);
    setRatingModalOpen(true);
  }, [cacheRestaurantMeta]);
  const closeRatingModal = useCallback(() => { setRatingModalOpen(false); setRatingModalRestaurant(null); }, []);

  const openAddToListModal = useCallback((restaurantId: string, meta?: RestaurantMeta) => {
    if (meta) cacheRestaurantMeta(meta);
    setAddToListRestaurantId(restaurantId);
    setAddToListModalOpen(true);
  }, [cacheRestaurantMeta]);
  const closeAddToListModal = useCallback(() => { setAddToListModalOpen(false); setAddToListRestaurantId(null); }, []);

  const openAddRestaurantModal = useCallback((restaurant: RestaurantMeta, initialPage?: string) => {
    cacheRestaurantMeta(restaurant);
    setAddRestaurantModalMeta(restaurant);
    setAddRestaurantModalInitialPage(initialPage || null);
    setAddRestaurantModalOpen(true);
  }, [cacheRestaurantMeta]);
  const closeAddRestaurantModal = useCallback(() => { setAddRestaurantModalOpen(false); setAddRestaurantModalMeta(null); setAddRestaurantModalInitialPage(null); }, []);

  const openWishlistModal = useCallback((restaurant: RestaurantMeta) => {
    cacheRestaurantMeta(restaurant);
    setWishlistModalMeta(restaurant);
    setWishlistModalOpen(true);
  }, [cacheRestaurantMeta]);
  const closeWishlistModal = useCallback(() => { setWishlistModalOpen(false); setWishlistModalMeta(null); }, []);

  const openHomeMealModal = useCallback((meal?: HomeMeal) => {
    setHomeMealModalData(meal || null);
    setHomeMealModalOpen(true);
  }, []);
  const closeHomeMealModal = useCallback(() => { setHomeMealModalOpen(false); setHomeMealModalData(null); }, []);

  return (
    <ListsContext.Provider value={{
      ratings, rateRestaurant, updateRating, removeRating, getRating,
      lists, createList, deleteList, renameList, addToList, removeFromList, addToWishlistInList, removeFromWishlistInList, getListsForRestaurant, setListRating, getListRating,
      restaurantMeta, cacheRestaurantMeta, getRestaurantInfo,
      wishlist, addToWishlist, removeFromWishlist, isWishlisted, getWishlistItem,
      ratingModalOpen, ratingModalRestaurant, openRatingModal, closeRatingModal,
      addToListModalOpen, addToListRestaurantId, openAddToListModal, closeAddToListModal,
      addRestaurantModalOpen, addRestaurantModalMeta, addRestaurantModalInitialPage, openAddRestaurantModal, closeAddRestaurantModal,
      wishlistModalOpen, wishlistModalMeta, openWishlistModal, closeWishlistModal,
      trips, createTrip, updateTrip, deleteTrip, addRestaurantToTrip, updateTripRestaurant, removeRestaurantFromTrip, addHotelToTrip, updateHotel, removeHotelFromTrip,
      homeMeals, createHomeMeal, updateHomeMeal, deleteHomeMeal, getHomeMeal,
      homeMealModalOpen, homeMealModalData, openHomeMealModal, closeHomeMealModal,
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
