import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

/* ── Types ──────────────────────────────────────────────────────────── */

export type ReelKind = 'restaurant' | 'recipe';

export interface ReelRestaurant {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  address: string;
  image?: string;
  score?: number;
  distanceMi?: number;
}

export interface ReelRecipe {
  id: string;
  title: string;
  prepTime: number;   // minutes
  cookTime: number;   // minutes
  servings: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  image?: string;
}

export interface Reel {
  id: string;
  kind: ReelKind;
  authorId: string;
  authorUsername: string;
  authorDisplayName?: string;
  authorAvatarColor: string;   // tailwind bg-* class for the avatar pill
  authorInitials: string;      // 2 letters
  isExpert: boolean;
  videoUrl?: string;           // object URL or remote URL; absent → placeholder
  posterUrl?: string;          // optional poster frame
  bgGradient: string;          // tailwind gradient classes for the placeholder
  bgLabel?: string;            // small label centered in placeholder ("PASTA PULL SHOT")
  caption: string;
  audioLabel: string;          // "♪ Cafe Del Mar — Sunset"
  restaurant?: ReelRestaurant; // present when kind === 'restaurant'
  recipe?: ReelRecipe;         // present when kind === 'recipe'
  likes: number;
  comments: number;
  saves: number;
  liked: boolean;
  saved: boolean;
  following: boolean;
  createdAt: number;
}

interface ReelsContextValue {
  reels: Reel[];
  restaurantReels: Reel[];
  recipeReels: Reel[];

  addReel: (reel: Omit<Reel, 'id' | 'likes' | 'comments' | 'saves' | 'liked' | 'saved' | 'following' | 'createdAt'>) => Reel;
  toggleLike: (reelId: string) => void;
  toggleSave: (reelId: string) => void;
  toggleFollow: (authorId: string) => void;

  // Modal state
  addReelModalOpen: boolean;
  addReelInitialKind: ReelKind | null;
  openAddReelModal: (kind?: ReelKind) => void;
  closeAddReelModal: () => void;
}

/* ── Seed data ──────────────────────────────────────────────────────── */

// Seed reels matching the design references — gradient backgrounds with
// a centered label stand in for actual videos so the page looks right
// out of the box. Each kind has a few entries so the vertical-scroll feed
// has something to scroll through.
const SEED_REELS: Reel[] = [
  {
    id: 'seed-r1',
    kind: 'restaurant',
    authorId: 'seed-ninak',
    authorUsername: 'ninak',
    authorDisplayName: 'Nina K',
    authorAvatarColor: 'bg-emerald-700',
    authorInitials: 'NK',
    isExpert: false,
    bgGradient: 'from-orange-900 via-orange-700 to-orange-900',
    bgLabel: 'PASTA PULL SHOT',
    caption: 'The cacio e pepe at Via Carota is everything they say it is. Pull up.',
    audioLabel: 'Cafe Del Mar — Sunset',
    restaurant: {
      id: 'seed-via-carota',
      name: 'Via Carota',
      cuisine: 'Italian',
      price: '$$$',
      address: '51 Grove St, New York, NY',
      score: 9.1,
      distanceMi: 0.4,
    },
    likes: 12_400,
    comments: 284,
    saves: 1823,
    liked: false,
    saved: false,
    following: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: 'seed-r2',
    kind: 'restaurant',
    authorId: 'seed-marcoeats',
    authorUsername: 'marcoeats',
    authorDisplayName: 'Marco',
    authorAvatarColor: 'bg-rose-700',
    authorInitials: 'MR',
    isExpert: true,
    bgGradient: 'from-stone-900 via-amber-900 to-stone-900',
    bgLabel: 'TARTARE BITE',
    caption: 'Steak tartare at Estela. The crisp + the raw beef + the bone marrow. A trinity.',
    audioLabel: 'Original audio',
    restaurant: {
      id: 'seed-estela',
      name: 'Estela',
      cuisine: 'New American',
      price: '$$$',
      address: '47 E Houston St, New York, NY',
      score: 9.4,
      distanceMi: 1.1,
    },
    likes: 8_900,
    comments: 132,
    saves: 2410,
    liked: false,
    saved: false,
    following: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 22,
  },
  {
    id: 'seed-r3',
    kind: 'restaurant',
    authorId: 'seed-ayako',
    authorUsername: 'ayakoeats',
    authorDisplayName: 'Ayako',
    authorAvatarColor: 'bg-indigo-700',
    authorInitials: 'AY',
    isExpert: false,
    bgGradient: 'from-zinc-900 via-rose-900/70 to-zinc-900',
    bgLabel: 'OMAKASE',
    caption: 'Fifteen courses, three hours, zero regrets. Sushi Noz delivers.',
    audioLabel: 'Floating Points — Last Bloom',
    restaurant: {
      id: 'seed-sushi-noz',
      name: 'Sushi Noz',
      cuisine: 'Sushi',
      price: '$$$$',
      address: '181 E 78th St, New York, NY',
      score: 9.6,
      distanceMi: 2.7,
    },
    likes: 21_300,
    comments: 412,
    saves: 5180,
    liked: false,
    saved: false,
    following: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 30,
  },
  {
    id: 'seed-c1',
    kind: 'recipe',
    authorId: 'seed-sofiareyes',
    authorUsername: 'sofiareyes',
    authorDisplayName: 'Sofia Reyes',
    authorAvatarColor: 'bg-amber-600',
    authorInitials: 'SR',
    isExpert: true,
    bgGradient: 'from-orange-900 via-orange-800 to-orange-950',
    bgLabel: 'SALSA MACHA POUR',
    caption: 'Three-ingredient salsa macha. Blender, done.',
    audioLabel: 'Tropicalia',
    recipe: {
      id: 'seed-salsa-macha',
      title: 'Salsa Macha',
      prepTime: 5,
      cookTime: 7,
      servings: 4,
      difficulty: 'Easy',
    },
    likes: 34_500,
    comments: 512,
    saves: 18_900,
    liked: false,
    saved: false,
    following: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 9,
  },
  {
    id: 'seed-c2',
    kind: 'recipe',
    authorId: 'seed-jacobcooks',
    authorUsername: 'jacobcooks',
    authorDisplayName: 'Jacob',
    authorAvatarColor: 'bg-emerald-700',
    authorInitials: 'JC',
    isExpert: false,
    bgGradient: 'from-amber-900 via-orange-900 to-rose-950',
    bgLabel: 'CACIO E PEPE',
    caption: 'No cream. No butter. Just pasta water and patience.',
    audioLabel: 'Phoenix — Lisztomania',
    recipe: {
      id: 'seed-cacio-e-pepe',
      title: 'Cacio e Pepe',
      prepTime: 5,
      cookTime: 15,
      servings: 2,
      difficulty: 'Medium',
    },
    likes: 12_100,
    comments: 218,
    saves: 7_640,
    liked: false,
    saved: false,
    following: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 16,
  },
  {
    id: 'seed-c3',
    kind: 'recipe',
    authorId: 'seed-priyab',
    authorUsername: 'priyab',
    authorDisplayName: 'Priya',
    authorAvatarColor: 'bg-rose-700',
    authorInitials: 'PB',
    isExpert: true,
    bgGradient: 'from-yellow-900 via-amber-800 to-rose-950',
    bgLabel: 'DAL TADKA',
    caption: 'A bowl of dal tadka, the way my grandmother makes it.',
    audioLabel: 'Original audio',
    recipe: {
      id: 'seed-dal-tadka',
      title: 'Dal Tadka',
      prepTime: 10,
      cookTime: 35,
      servings: 4,
      difficulty: 'Easy',
    },
    likes: 9_200,
    comments: 174,
    saves: 4_310,
    liked: false,
    saved: false,
    following: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 40,
  },
];

/* ── Provider ───────────────────────────────────────────────────────── */

const ReelsContext = createContext<ReelsContextValue | null>(null);

export const ReelsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Reels are session-only: we don't persist to localStorage because video
  // bytes would blow the quota, and blob URLs don't survive a reload anyway.
  // Seed entries provide the out-of-the-box look; user-added reels live in
  // memory until the page is refreshed.
  const [reels, setReels] = useState<Reel[]>(SEED_REELS);
  const [followedAuthors, setFollowedAuthors] = useState<Set<string>>(new Set());

  const [addReelModalOpen, setAddReelModalOpen] = useState(false);
  const [addReelInitialKind, setAddReelInitialKind] = useState<ReelKind | null>(null);

  const addReel = useCallback((reel: Omit<Reel, 'id' | 'likes' | 'comments' | 'saves' | 'liked' | 'saved' | 'following' | 'createdAt'>): Reel => {
    const created: Reel = {
      ...reel,
      id: `reel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      likes: 0,
      comments: 0,
      saves: 0,
      liked: false,
      saved: false,
      following: false,
      createdAt: Date.now(),
    };
    setReels((prev) => [created, ...prev]);
    return created;
  }, []);

  const toggleLike = useCallback((reelId: string) => {
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      const liked = !r.liked;
      return { ...r, liked, likes: r.likes + (liked ? 1 : -1) };
    }));
  }, []);

  const toggleSave = useCallback((reelId: string) => {
    setReels((prev) => prev.map((r) => {
      if (r.id !== reelId) return r;
      const saved = !r.saved;
      return { ...r, saved, saves: r.saves + (saved ? 1 : -1) };
    }));
  }, []);

  const toggleFollow = useCallback((authorId: string) => {
    setFollowedAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(authorId)) next.delete(authorId);
      else next.add(authorId);
      return next;
    });
  }, []);

  // Materialize the per-reel `following` flag from the followedAuthors set
  // so reels of the same author stay in sync.
  const reelsWithFollow = useMemo(
    () => reels.map((r) => ({ ...r, following: followedAuthors.has(r.authorId) })),
    [reels, followedAuthors],
  );

  const restaurantReels = useMemo(
    () => reelsWithFollow.filter((r) => r.kind === 'restaurant'),
    [reelsWithFollow],
  );
  const recipeReels = useMemo(
    () => reelsWithFollow.filter((r) => r.kind === 'recipe'),
    [reelsWithFollow],
  );

  const openAddReelModal = useCallback((kind?: ReelKind) => {
    setAddReelInitialKind(kind ?? null);
    setAddReelModalOpen(true);
  }, []);

  const closeAddReelModal = useCallback(() => {
    setAddReelModalOpen(false);
    setAddReelInitialKind(null);
  }, []);

  const value: ReelsContextValue = {
    reels: reelsWithFollow,
    restaurantReels,
    recipeReels,
    addReel,
    toggleLike,
    toggleSave,
    toggleFollow,
    addReelModalOpen,
    addReelInitialKind,
    openAddReelModal,
    closeAddReelModal,
  };

  return <ReelsContext.Provider value={value}>{children}</ReelsContext.Provider>;
};

export function useReels(): ReelsContextValue {
  const ctx = useContext(ReelsContext);
  if (!ctx) throw new Error('useReels must be used within ReelsProvider');
  return ctx;
}
