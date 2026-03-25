import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ── Types ── */

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
  photos: string[];       // base64 data-urls of user-uploaded photos
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
  restaurantIds: string[];
  createdAt: number;
}

export interface WishlistItem {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  addedAt: number;
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
  createList: (name: string, emoji: string) => void;
  deleteList: (id: string) => void;
  renameList: (id: string, name: string, emoji: string) => void;
  addToList: (listId: string, restaurantId: string) => void;
  removeFromList: (listId: string, restaurantId: string) => void;
  getListsForRestaurant: (restaurantId: string) => CustomList[];

  // Restaurant metadata cache
  restaurantMeta: Record<string, RestaurantMeta>;
  cacheRestaurantMeta: (meta: RestaurantMeta) => void;
  getRestaurantInfo: (restaurantId: string) => RestaurantMeta | undefined;

  // Wishlist
  wishlist: WishlistItem[];
  addToWishlist: (item: WishlistItem) => void;
  removeFromWishlist: (restaurantId: string) => void;
  isWishlisted: (restaurantId: string) => boolean;

  // Modals
  ratingModalOpen: boolean;
  ratingModalRestaurant: RestaurantMeta | null;
  openRatingModal: (restaurant: RestaurantMeta) => void;
  closeRatingModal: () => void;

  addToListModalOpen: boolean;
  addToListRestaurantId: string | null;
  openAddToListModal: (restaurantId: string, meta?: RestaurantMeta) => void;
  closeAddToListModal: () => void;

  // Unified add restaurant modal
  addRestaurantModalOpen: boolean;
  addRestaurantModalMeta: RestaurantMeta | null;
  openAddRestaurantModal: (restaurant: RestaurantMeta) => void;
  closeAddRestaurantModal: () => void;
}

const STORAGE_KEY_RATINGS = 'gourmad-ratings';
const STORAGE_KEY_LISTS = 'gourmad-lists';
const STORAGE_KEY_WISHLIST = 'gourmad-wishlist';
const STORAGE_KEY_META = 'gourmad-restaurant-meta';

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
  { id: 'date-nights', name: 'Date Nights', emoji: '🕯️', restaurantIds: [], createdAt: Date.now() - 4000 },
  { id: 'hidden-gems', name: 'Hidden Gems', emoji: '💎', restaurantIds: [], createdAt: Date.now() - 3000 },
  { id: 'best-cocktails', name: 'Best Cocktails', emoji: '🍸', restaurantIds: [], createdAt: Date.now() - 2000 },
  { id: 'quick-bites', name: 'Quick Bites', emoji: '⚡', restaurantIds: [], createdAt: Date.now() - 1000 },
];

const ListsContext = createContext<ListsContextValue | null>(null);

export const ListsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [ratings, setRatings] = useState<RestaurantRating[]>(() => loadFromStorage(STORAGE_KEY_RATINGS, []));
  const [lists, setLists] = useState<CustomList[]>(() => loadFromStorage(STORAGE_KEY_LISTS, DEFAULT_LISTS));
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => loadFromStorage(STORAGE_KEY_WISHLIST, []));
  const [restaurantMeta, setRestaurantMeta] = useState<Record<string, RestaurantMeta>>(() => loadFromStorage(STORAGE_KEY_META, {}));

  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [ratingModalRestaurant, setRatingModalRestaurant] = useState<RestaurantMeta | null>(null);
  const [addToListModalOpen, setAddToListModalOpen] = useState(false);
  const [addToListRestaurantId, setAddToListRestaurantId] = useState<string | null>(null);
  const [addRestaurantModalOpen, setAddRestaurantModalOpen] = useState(false);
  const [addRestaurantModalMeta, setAddRestaurantModalMeta] = useState<RestaurantMeta | null>(null);

  // Restaurant metadata cache
  const cacheRestaurantMeta = useCallback((meta: RestaurantMeta) => {
    setRestaurantMeta((prev) => {
      const next = { ...prev, [meta.id]: meta };
      saveToStorage(STORAGE_KEY_META, next);
      return next;
    });
  }, []);

  const getRestaurantInfo = useCallback((restaurantId: string): RestaurantMeta | undefined => {
    // Check cache first, then ratings, then wishlist
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
      return next;
    });
    // Also cache the metadata
    cacheRestaurantMeta({ id: rating.restaurantId, name: rating.name, image: rating.image, cuisine: rating.cuisine, price: rating.price, address: rating.address });
  }, [cacheRestaurantMeta]);

  const updateRating = useCallback((restaurantId: string, partial: Partial<RestaurantRating>) => {
    setRatings((prev) => {
      const next = prev.map((r) => r.restaurantId === restaurantId ? { ...r, ...partial } : r);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      return next;
    });
  }, []);

  const removeRating = useCallback((restaurantId: string) => {
    setRatings((prev) => {
      const next = prev.filter((r) => r.restaurantId !== restaurantId);
      saveToStorage(STORAGE_KEY_RATINGS, next);
      return next;
    });
  }, []);

  const getRating = useCallback((restaurantId: string) => ratings.find((r) => r.restaurantId === restaurantId), [ratings]);

  // Lists
  const createList = useCallback((name: string, emoji: string) => {
    setLists((prev) => {
      const next = [...prev, { id: `list-${Date.now()}`, name, emoji, restaurantIds: [], createdAt: Date.now() }];
      saveToStorage(STORAGE_KEY_LISTS, next);
      return next;
    });
  }, []);

  const deleteList = useCallback((id: string) => {
    setLists((prev) => {
      const next = prev.filter((l) => l.id !== id);
      saveToStorage(STORAGE_KEY_LISTS, next);
      return next;
    });
  }, []);

  const renameList = useCallback((id: string, name: string, emoji: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === id ? { ...l, name, emoji } : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      return next;
    });
  }, []);

  const addToList = useCallback((listId: string, restaurantId: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId && !l.restaurantIds.includes(restaurantId)
        ? { ...l, restaurantIds: [...l.restaurantIds, restaurantId] }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      return next;
    });
  }, []);

  const removeFromList = useCallback((listId: string, restaurantId: string) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === listId
        ? { ...l, restaurantIds: l.restaurantIds.filter((r) => r !== restaurantId) }
        : l);
      saveToStorage(STORAGE_KEY_LISTS, next);
      return next;
    });
  }, []);

  const getListsForRestaurant = useCallback((restaurantId: string) => lists.filter((l) => l.restaurantIds.includes(restaurantId)), [lists]);

  // Wishlist
  const addToWishlist = useCallback((item: WishlistItem) => {
    setWishlist((prev) => {
      if (prev.some((w) => w.restaurantId === item.restaurantId)) return prev;
      const next = [item, ...prev];
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      return next;
    });
    // Also cache the metadata
    cacheRestaurantMeta({ id: item.restaurantId, name: item.name, image: item.image, cuisine: item.cuisine, price: item.price, address: item.address });
  }, [cacheRestaurantMeta]);

  const removeFromWishlist = useCallback((restaurantId: string) => {
    setWishlist((prev) => {
      const next = prev.filter((w) => w.restaurantId !== restaurantId);
      saveToStorage(STORAGE_KEY_WISHLIST, next);
      return next;
    });
  }, []);

  const isWishlisted = useCallback((restaurantId: string) => wishlist.some((w) => w.restaurantId === restaurantId), [wishlist]);

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

  const openAddRestaurantModal = useCallback((restaurant: RestaurantMeta) => {
    cacheRestaurantMeta(restaurant);
    setAddRestaurantModalMeta(restaurant);
    setAddRestaurantModalOpen(true);
  }, [cacheRestaurantMeta]);
  const closeAddRestaurantModal = useCallback(() => { setAddRestaurantModalOpen(false); setAddRestaurantModalMeta(null); }, []);

  return (
    <ListsContext.Provider value={{
      ratings, rateRestaurant, updateRating, removeRating, getRating,
      lists, createList, deleteList, renameList, addToList, removeFromList, getListsForRestaurant,
      restaurantMeta, cacheRestaurantMeta, getRestaurantInfo,
      wishlist, addToWishlist, removeFromWishlist, isWishlisted,
      ratingModalOpen, ratingModalRestaurant, openRatingModal, closeRatingModal,
      addToListModalOpen, addToListRestaurantId, openAddToListModal, closeAddToListModal,
      addRestaurantModalOpen, addRestaurantModalMeta, openAddRestaurantModal, closeAddRestaurantModal,
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
