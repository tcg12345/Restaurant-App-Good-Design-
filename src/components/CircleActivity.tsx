import React, { useState, useMemo } from 'react';
import { Search, Star, Heart, Bookmark, Users, UserCircle, MapPin, SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';

/* ── Types ── */

type SourceType = 'friend' | 'expert';
type ListType = 'rated' | 'wishlist';

interface CircleRestaurant {
  id: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  rating: number | null;       // null = wishlisted only, not rated
  listType: ListType;
  source: SourceType;
  sourceName: string;
  sourceImage: string;
  addedAt: string;             // relative time string
}

/* ── Mock Data ── */
// This will be replaced with real data from the backend

const MOCK_CIRCLE_RESTAURANTS: CircleRestaurant[] = [
  {
    id: 'circle-1',
    name: "L'Artusi",
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Italian',
    price: '$$$',
    address: '228 W 10th St, New York',
    rating: 4.8,
    listType: 'rated',
    source: 'friend',
    sourceName: 'Sarah Chen',
    sourceImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
    addedAt: '2 hours ago',
  },
  {
    id: 'circle-2',
    name: 'Sushi Nakazawa',
    image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Japanese',
    price: '$$$$',
    address: '23 Commerce St, New York',
    rating: null,
    listType: 'wishlist',
    source: 'friend',
    sourceName: 'Marcus Rivera',
    sourceImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    addedAt: '5 hours ago',
  },
  {
    id: 'circle-3',
    name: 'Gramercy Tavern',
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=600',
    cuisine: 'American',
    price: '$$$$',
    address: '42 E 20th St, New York',
    rating: 4.6,
    listType: 'rated',
    source: 'expert',
    sourceName: 'Chef Antoine',
    sourceImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200',
    addedAt: '1 day ago',
  },
  {
    id: 'circle-4',
    name: 'Via Carota',
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Italian',
    price: '$$$',
    address: '51 Grove St, New York',
    rating: 4.9,
    listType: 'rated',
    source: 'friend',
    sourceName: 'Emily Zhang',
    sourceImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200',
    addedAt: '1 day ago',
  },
  {
    id: 'circle-5',
    name: 'Tatiana by Kwame',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Caribbean',
    price: '$$$',
    address: 'Lincoln Center, New York',
    rating: null,
    listType: 'wishlist',
    source: 'expert',
    sourceName: 'Maya Williams',
    sourceImage: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200',
    addedAt: '2 days ago',
  },
  {
    id: 'circle-6',
    name: "Joe's Pizza",
    image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Pizza',
    price: '$',
    address: '7 Carmine St, New York',
    rating: 4.5,
    listType: 'rated',
    source: 'friend',
    sourceName: 'Alex Thompson',
    sourceImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
    addedAt: '2 days ago',
  },
  {
    id: 'circle-7',
    name: 'Le Bernardin',
    image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=600',
    cuisine: 'French',
    price: '$$$$',
    address: '155 W 51st St, New York',
    rating: 4.9,
    listType: 'rated',
    source: 'expert',
    sourceName: 'Chef Antoine',
    sourceImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200',
    addedAt: '3 days ago',
  },
  {
    id: 'circle-8',
    name: 'Dhamaka',
    image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Indian',
    price: '$$',
    address: '119 Delancey St, New York',
    rating: null,
    listType: 'wishlist',
    source: 'friend',
    sourceName: 'Sarah Chen',
    sourceImage: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
    addedAt: '3 days ago',
  },
  {
    id: 'circle-9',
    name: 'Atomix',
    image: 'https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Korean',
    price: '$$$$',
    address: '104 E 30th St, New York',
    rating: 5.0,
    listType: 'rated',
    source: 'expert',
    sourceName: 'Maya Williams',
    sourceImage: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200',
    addedAt: '4 days ago',
  },
  {
    id: 'circle-10',
    name: 'Los Tacos No. 1',
    image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Mexican',
    price: '$',
    address: '75 9th Ave, New York',
    rating: 4.3,
    listType: 'rated',
    source: 'friend',
    sourceName: 'Marcus Rivera',
    sourceImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    addedAt: '5 days ago',
  },
  {
    id: 'circle-11',
    name: 'Eleven Madison Park',
    image: 'https://images.unsplash.com/photo-1550966871-3ed3cdb51f3a?auto=format&fit=crop&q=80&w=600',
    cuisine: 'American',
    price: '$$$$',
    address: '11 Madison Ave, New York',
    rating: null,
    listType: 'wishlist',
    source: 'expert',
    sourceName: 'Chef Antoine',
    sourceImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200',
    addedAt: '1 week ago',
  },
  {
    id: 'circle-12',
    name: 'Thai Diner',
    image: 'https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?auto=format&fit=crop&q=80&w=600',
    cuisine: 'Thai',
    price: '$$',
    address: '186 Mott St, New York',
    rating: 4.4,
    listType: 'rated',
    source: 'friend',
    sourceName: 'Emily Zhang',
    sourceImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200',
    addedAt: '1 week ago',
  },
];

/* ── Filter Chips ── */

const SOURCE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'friend', label: 'Friends' },
  { value: 'expert', label: 'Experts' },
] as const;

const LIST_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'rated', label: 'Rated' },
  { value: 'wishlist', label: 'Wishlisted' },
] as const;

/* ── Component ── */

export const CircleActivity: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | SourceType>('all');
  const [listFilter, setListFilter] = useState<'all' | ListType>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'rating' | 'name'>('recent');

  const filtered = useMemo(() => {
    let items = MOCK_CIRCLE_RESTAURANTS;

    // Source filter
    if (sourceFilter !== 'all') {
      items = items.filter((r) => r.source === sourceFilter);
    }

    // List type filter
    if (listFilter !== 'all') {
      items = items.filter((r) => r.listType === listFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.sourceName.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q)
      );
    }

    // Sort
    const sorted = [...items];
    switch (sortBy) {
      case 'rating':
        sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'recent':
      default:
        break; // already in recency order
    }

    return sorted;
  }, [searchQuery, sourceFilter, listFilter, sortBy]);

  const ratedCount = MOCK_CIRCLE_RESTAURANTS.filter((r) => r.listType === 'rated').length;
  const wishlistCount = MOCK_CIRCLE_RESTAURANTS.filter((r) => r.listType === 'wishlist').length;

  return (
    <div>
      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-2xl p-4 border border-on-surface/8 text-center">
          <p className="text-2xl font-serif font-bold text-primary">{MOCK_CIRCLE_RESTAURANTS.length}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface/40 mt-1">Total</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-on-surface/8 text-center">
          <p className="text-2xl font-serif font-bold text-primary">{ratedCount}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface/40 mt-1">Rated</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-on-surface/8 text-center">
          <p className="text-2xl font-serif font-bold text-primary">{wishlistCount}</p>
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface/40 mt-1">Wishlisted</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
          <Search size={18} />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search restaurants, friends, experts..."
          className="w-full bg-white rounded-2xl py-3.5 pl-11 pr-4 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        />
      </div>

      {/* Source filter chips */}
      <div className="flex gap-2 mb-3">
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setSourceFilter(f.value as any)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all",
              sourceFilter === f.value
                ? "bg-primary text-white border-primary"
                : "bg-white border-muted hover:border-primary hover:text-primary"
            )}
          >
            {f.value === 'friend' && <Users size={12} className="inline mr-1.5 -mt-0.5" />}
            {f.value === 'expert' && <UserCircle size={12} className="inline mr-1.5 -mt-0.5" />}
            {f.label}
          </button>
        ))}
      </div>

      {/* List type filter chips */}
      <div className="flex gap-2 mb-3">
        {LIST_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setListFilter(f.value as any)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest border transition-all",
              listFilter === f.value
                ? "bg-secondary text-white border-secondary"
                : "bg-white border-muted hover:border-secondary hover:text-secondary"
            )}
          >
            {f.value === 'rated' && <Star size={12} className="inline mr-1.5 -mt-0.5" />}
            {f.value === 'wishlist' && <Bookmark size={12} className="inline mr-1.5 -mt-0.5" />}
            {f.label}
          </button>
        ))}
      </div>

      {/* Sort row */}
      <div className="flex items-center justify-between mb-5">
        <p className="text-on-surface/40 text-xs font-bold uppercase tracking-widest">
          {filtered.length} restaurant{filtered.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface/30">Sort:</span>
          {(['recent', 'rating', 'name'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                sortBy === s
                  ? "bg-on-surface/10 text-on-surface"
                  : "text-on-surface/30 hover:text-on-surface/60"
              )}
            >
              {s === 'recent' ? 'Recent' : s === 'rating' ? 'Rating' : 'A-Z'}
            </button>
          ))}
        </div>
      </div>

      {/* Restaurant list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-on-surface/40 text-sm font-medium">No restaurants match your filters</p>
          <p className="text-on-surface/30 text-xs mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((restaurant) => (
            <Link key={restaurant.id} to={`/restaurant/${restaurant.id}`} className="block">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-on-surface/8 shadow-md overflow-hidden flex active:scale-[0.98] transition-transform"
              >
                {/* Image */}
                <div className="w-28 sm:w-32 flex-shrink-0">
                  <img
                    src={restaurant.image}
                    alt={restaurant.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>

                {/* Content */}
                <div className="flex-1 p-4 sm:p-5 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-serif font-bold text-[15px] leading-tight line-clamp-1">{restaurant.name}</h3>
                      {restaurant.rating !== null ? (
                        <div className="flex items-center gap-0.5 text-primary flex-shrink-0">
                          <Star size={12} className="fill-primary" />
                          <span className="text-xs font-bold">{restaurant.rating}</span>
                        </div>
                      ) : (
                        <Bookmark size={14} className="text-secondary flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-on-surface/40 font-medium uppercase tracking-wider">
                      <span>{restaurant.cuisine}</span>
                      <span>·</span>
                      <span>{restaurant.price}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-on-surface/50">
                      <MapPin size={10} className="flex-shrink-0" />
                      <span className="truncate">{restaurant.address}</span>
                    </div>
                  </div>

                  {/* Source attribution */}
                  <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-on-surface/5">
                    <img
                      src={restaurant.sourceImage}
                      alt={restaurant.sourceName}
                      className="w-5 h-5 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <span className="text-[10px] text-on-surface/40 truncate">
                      <span className="font-semibold text-on-surface/60">{restaurant.sourceName}</span>
                      {' · '}
                      {restaurant.listType === 'rated' ? 'Rated' : 'Wishlisted'}
                      {' · '}
                      {restaurant.addedAt}
                    </span>
                  </div>
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
