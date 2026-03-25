import React, { useState, useRef, useMemo } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Star, ChevronRight, Plus, Trash2, ArrowLeft, ListPlus, MapPin, SlidersHorizontal, X, ChevronDown, Heart } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type CustomList } from '../contexts/ListsContext';
import { Link } from 'react-router-dom';

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

  return (
    <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden flex">
      <Link to={`/restaurant/${restaurantId}`} className="w-24 sm:w-28 flex-shrink-0 block">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full min-h-[6rem] bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-2xl font-serif font-bold">
            {name.charAt(0)}
          </div>
        )}
      </Link>
      <div className="flex-1 p-3.5 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <Link to={`/restaurant/${restaurantId}`} className="min-w-0">
              <h3 className="font-serif font-bold text-sm leading-tight truncate">{name}</h3>
            </Link>
            {score !== undefined && (
              <div className={cn("text-lg font-serif font-bold flex-shrink-0 leading-none", scoreColor(score))}>
                {score.toFixed(1)}
              </div>
            )}
          </div>
          <p className="text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
            {cuisine}{price ? ` · ${price}` : ''}
          </p>
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
          {notes && (
            <p className="text-xs text-on-surface/40 mt-1.5 line-clamp-2 italic">&ldquo;{notes}&rdquo;</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-on-surface/5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {listBadges && listBadges.length > 0 && (
              <div className="flex gap-1 overflow-hidden">
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
            {!listBadges?.length && (
              <span className="text-[10px] text-on-surface/30">
                {visitDate ? new Date(visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                {wouldReturn && (visitDate ? ' · ' : '') + 'Would return'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {onEdit && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                className="text-[10px] font-bold text-primary uppercase tracking-wider hover:text-primary/70"
              >
                Edit
              </button>
            )}
            {onRemove && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
                className="text-[10px] font-bold text-red-400 uppercase tracking-wider hover:text-red-500"
              >
                {removeLabel || 'Remove'}
              </button>
            )}
          </div>
        </div>
      </div>
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
            {cuisine}{price ? ` · ${price}` : ''}
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

/* ── List Detail View ── */
const ListDetailView: React.FC<{
  list: CustomList;
  onBack: () => void;
}> = ({ list, onBack }) => {
  const { ratings, getRestaurantInfo, removeFromList, removeFromWishlistInList, openRatingModal, deleteList, wishlist } = useLists();

  const ratedRestaurants = list.restaurantIds.map((id) => {
    const info = getRestaurantInfo(id);
    const rating = ratings.find((r) => r.restaurantId === id);
    return { id, info, rating };
  });

  const wishlistedRestaurants = (list.wishlistIds || []).map((id) => {
    const info = getRestaurantInfo(id);
    const wishItem = wishlist.find((w) => w.restaurantId === id);
    return { id, info, wishItem };
  }).filter(({ info }) => info); // only show if we have metadata

  const totalCount = list.restaurantIds.length + (list.wishlistIds?.length || 0);

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
            {totalCount} restaurant{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => { deleteList(list.id); onBack(); }}
          className="p-2 text-red-400 hover:text-red-500 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="text-center py-16">
          <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">This list is empty</p>
          <p className="text-xs text-on-surface/30 mt-1">Add restaurants from the + button or heart icon</p>
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
              <div className="space-y-3">
                {ratedRestaurants.map(({ id, info, rating }) => (
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
                    onEdit={info ? () => openRatingModal({ id, name: info.name, image: info.image, cuisine: info.cuisine, price: info.price, address: info.address }) : undefined}
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
                    onRemove={() => removeFromWishlistInList(list.id, id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Filter Popup ── */
const FilterPopup: React.FC<{
  open: boolean;
  onClose: () => void;
  scoreRange: [number, number];
  onScoreRange: (r: [number, number]) => void;
  showWouldReturn: boolean;
  onShowWouldReturn: (v: boolean) => void;
  sortBy: 'recent' | 'highest' | 'lowest';
  onSortBy: (v: 'recent' | 'highest' | 'lowest') => void;
}> = ({ open, onClose, scoreRange, onScoreRange, showWouldReturn, onShowWouldReturn, sortBy, onSortBy }) => {
  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-h-[70vh] overflow-y-auto"
          >
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-serif font-bold text-lg">Filters</h3>
                <button onClick={onClose} className="p-1 text-on-surface/40 hover:text-on-surface">
                  <X size={20} />
                </button>
              </div>

              {/* Sort */}
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2.5">Sort by</p>
                <div className="flex gap-2">
                  {([['recent', 'Recent'], ['highest', 'Highest rated'], ['lowest', 'Lowest rated']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => onSortBy(key)}
                      className={cn(
                        "px-3.5 py-2 rounded-full text-xs font-semibold transition-all",
                        sortBy === key ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/50"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Score range */}
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2.5">
                  Rating: {scoreRange[0]}–{scoreRange[1]}
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0} max={10} step={1}
                    value={scoreRange[0]}
                    onChange={(e) => onScoreRange([Math.min(+e.target.value, scoreRange[1]), scoreRange[1]])}
                    className="flex-1 accent-primary"
                  />
                  <input
                    type="range"
                    min={0} max={10} step={1}
                    value={scoreRange[1]}
                    onChange={(e) => onScoreRange([scoreRange[0], Math.max(+e.target.value, scoreRange[0])])}
                    className="flex-1 accent-primary"
                  />
                </div>
              </div>

              {/* Would return */}
              <div className="mb-5">
                <button
                  onClick={() => onShowWouldReturn(!showWouldReturn)}
                  className={cn(
                    "px-3.5 py-2 rounded-full text-xs font-semibold transition-all",
                    showWouldReturn ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/50"
                  )}
                >
                  Would return only
                </button>
              </div>

              <button
                onClick={onClose}
                className="w-full py-3 rounded-2xl bg-primary text-white text-sm font-bold"
              >
                Apply
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── Main Page ── */
export const Pantry: React.FC = () => {
  const [selectedList, setSelectedList] = useState<CustomList | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListEmoji, setNewListEmoji] = useState('📋');

  // Filters
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 10]);
  const [showWouldReturn, setShowWouldReturn] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'highest' | 'lowest'>('recent');

  // Dropdowns
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cuisineDropdownOpen, setCuisineDropdownOpen] = useState(false);

  const {
    lists, createList,
    ratings, openRatingModal,
    wishlist,
    getListsForRestaurant,
  } = useLists();

  const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];
  const listScrollRef = useRef<HTMLDivElement>(null);

  const handleCreateList = () => {
    if (!newListName.trim()) return;
    createList(newListName.trim(), newListEmoji);
    setNewListName('');
    setNewListEmoji('📋');
    setCreatingList(false);
  };

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

  // Extract unique cuisines from ratings
  const allCuisines = useMemo(() => {
    const cuisines = new Set<string>();
    ratings.forEach((r) => {
      if (r.cuisine) cuisines.add(r.cuisine);
    });
    return Array.from(cuisines).sort();
  }, [ratings]);

  // Filter and sort rated restaurants
  const filteredRatings = useMemo(() => {
    let result = [...ratings];

    if (cityFilter) {
      result = result.filter((r) => {
        const parts = r.address?.split(',').map((s) => s.trim()) || [];
        return parts.some((p) => p === cityFilter);
      });
    }

    if (cuisineFilter) {
      result = result.filter((r) => r.cuisine === cuisineFilter);
    }

    if (showWouldReturn) {
      result = result.filter((r) => r.wouldReturn);
    }

    result = result.filter((r) => r.score >= scoreRange[0] && r.score <= scoreRange[1]);

    if (sortBy === 'highest') result.sort((a, b) => b.score - a.score);
    else if (sortBy === 'lowest') result.sort((a, b) => a.score - b.score);

    return result;
  }, [ratings, cityFilter, cuisineFilter, showWouldReturn, scoreRange, sortBy]);

  const hasActiveFilters = cityFilter || cuisineFilter || showWouldReturn || scoreRange[0] > 0 || scoreRange[1] < 10 || sortBy !== 'recent';

  // Keep selectedList in sync
  const currentList = selectedList ? lists.find((l) => l.id === selectedList.id) ?? null : null;

  return (
    <div className="pb-32">
      <TopBar title="My Lists" />

      <main className="px-5">
        {currentList ? (
          <ListDetailView list={currentList} onBack={() => setSelectedList(null)} />
        ) : (
          <>
            {/* ── Horizontal list row ── */}
            <div className="mb-4">
              <div
                ref={listScrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-5 px-5"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
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
                {creatingList ? null : (
                  <button
                    onClick={() => setCreatingList(true)}
                    className="flex items-center gap-1 px-3 py-2 rounded-full border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all flex-shrink-0"
                  >
                    <Plus size={14} />
                    <span className="text-xs font-semibold whitespace-nowrap">New List</span>
                  </button>
                )}
              </div>

              {/* Inline create list form */}
              <AnimatePresence>
                {creatingList && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 p-4 bg-white rounded-2xl border border-primary/20 shadow-sm space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {EMOJI_OPTIONS.map((e) => (
                          <button
                            key={e}
                            onClick={() => setNewListEmoji(e)}
                            className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all",
                              newListEmoji === e ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-on-surface/5"
                            )}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="List name..."
                        autoFocus
                        className="w-full bg-surface border border-on-surface/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setCreatingList(false); setNewListName(''); }}
                          className="flex-1 py-2 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateList}
                          disabled={!newListName.trim()}
                          className="flex-1 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Filter chips ── */}
            <div className="flex gap-2 mb-5 overflow-x-auto scrollbar-hide -mx-5 px-5 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              {/* City filter */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => { setCityDropdownOpen(!cityDropdownOpen); setCuisineDropdownOpen(false); }}
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                    cityFilter
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-on-surface/5 text-on-surface/50 border-transparent"
                  )}
                >
                  <MapPin size={12} />
                  <span>{cityFilter || 'City'}</span>
                  {cityFilter ? (
                    <button onClick={(e) => { e.stopPropagation(); setCityFilter(null); setCityDropdownOpen(false); }} className="ml-0.5">
                      <X size={11} />
                    </button>
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>
                {cityDropdownOpen && allCities.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setCityDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-on-surface/10 z-40 min-w-[10rem] max-h-48 overflow-y-auto">
                      {allCities.map((city) => (
                        <button
                          key={city}
                          onClick={() => { setCityFilter(city); setCityDropdownOpen(false); }}
                          className={cn(
                            "w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-on-surface/5 transition-colors first:rounded-t-xl last:rounded-b-xl",
                            cityFilter === city ? "text-primary bg-primary/5" : "text-on-surface/70"
                          )}
                        >
                          {city}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Cuisine filter */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => { setCuisineDropdownOpen(!cuisineDropdownOpen); setCityDropdownOpen(false); }}
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                    cuisineFilter
                      ? "bg-primary/10 text-primary border-primary/20"
                      : "bg-on-surface/5 text-on-surface/50 border-transparent"
                  )}
                >
                  <span>{cuisineFilter || 'Cuisine'}</span>
                  {cuisineFilter ? (
                    <button onClick={(e) => { e.stopPropagation(); setCuisineFilter(null); setCuisineDropdownOpen(false); }} className="ml-0.5">
                      <X size={11} />
                    </button>
                  ) : (
                    <ChevronDown size={11} />
                  )}
                </button>
                {cuisineDropdownOpen && allCuisines.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setCuisineDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-on-surface/10 z-40 min-w-[10rem] max-h-48 overflow-y-auto">
                      {allCuisines.map((c) => (
                        <button
                          key={c}
                          onClick={() => { setCuisineFilter(c); setCuisineDropdownOpen(false); }}
                          className={cn(
                            "w-full text-left px-3.5 py-2 text-xs font-medium hover:bg-on-surface/5 transition-colors first:rounded-t-xl last:rounded-b-xl",
                            cuisineFilter === c ? "text-primary bg-primary/5" : "text-on-surface/70"
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Filters button */}
              <button
                onClick={() => { setFiltersOpen(true); setCityDropdownOpen(false); setCuisineDropdownOpen(false); }}
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border flex-shrink-0",
                  (showWouldReturn || scoreRange[0] > 0 || scoreRange[1] < 10 || sortBy !== 'recent')
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-on-surface/5 text-on-surface/50 border-transparent"
                )}
              >
                <SlidersHorizontal size={12} />
                <span>Filters</span>
              </button>

              {/* Clear all */}
              {hasActiveFilters && (
                <button
                  onClick={() => { setCityFilter(null); setCuisineFilter(null); setShowWouldReturn(false); setScoreRange([0, 10]); setSortBy('recent'); }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-red-400 hover:text-red-500 transition-all flex-shrink-0"
                >
                  <X size={11} />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* ── Summary bar ── */}
            {ratings.length > 0 && (
              <div className="flex items-center gap-4 px-1 mb-3">
                <p className="text-xs text-on-surface/40">
                  <span className="font-bold text-on-surface">{filteredRatings.length}</span>
                  {filteredRatings.length !== ratings.length && ` of ${ratings.length}`} rated
                </p>
                {filteredRatings.length > 0 && (
                  <p className="text-xs text-on-surface/40">
                    Avg: <span className="font-bold text-on-surface">{(filteredRatings.reduce((sum, r) => sum + r.score, 0) / filteredRatings.length).toFixed(1)}</span>/10
                  </p>
                )}
                {wishlist.length > 0 && (
                  <p className="text-xs text-on-surface/40">
                    <Heart size={10} className="inline text-red-400 fill-red-400 mr-0.5" />
                    <span className="font-bold text-on-surface">{wishlist.length}</span> wishlisted
                  </p>
                )}
              </div>
            )}

            {/* ── Restaurant list ── */}
            {ratings.length === 0 && wishlist.length === 0 ? (
              <div className="text-center py-16">
                <Star size={32} className="mx-auto text-on-surface/15 mb-3" />
                <p className="text-sm font-medium text-on-surface/40">No restaurants yet</p>
                <p className="text-xs text-on-surface/30 mt-1">Use the + button to rate or heart to wishlist</p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Rated section */}
                {filteredRatings.length > 0 ? (
                  <div className="space-y-3">
                    {filteredRatings.map((r) => {
                      const inLists = getListsForRestaurant(r.restaurantId);
                      return (
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
                          onEdit={() => openRatingModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                        />
                      );
                    })}
                  </div>
                ) : ratings.length > 0 ? (
                  <div className="text-center py-8">
                    <SlidersHorizontal size={28} className="mx-auto text-on-surface/15 mb-3" />
                    <p className="text-sm font-medium text-on-surface/40">No matches</p>
                    <p className="text-xs text-on-surface/30 mt-1">Try adjusting your filters</p>
                  </div>
                ) : null}

                {/* Wishlist section (global) */}
                {wishlist.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 mt-2">
                      <Heart size={14} className="text-red-400 fill-red-400" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface/50">Wishlist ({wishlist.length})</h3>
                    </div>
                    <div className="space-y-3">
                      {wishlist.map((w) => (
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

      {/* Filter popup */}
      <FilterPopup
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        scoreRange={scoreRange}
        onScoreRange={setScoreRange}
        showWouldReturn={showWouldReturn}
        onShowWouldReturn={setShowWouldReturn}
        sortBy={sortBy}
        onSortBy={setSortBy}
      />
    </div>
  );
};
