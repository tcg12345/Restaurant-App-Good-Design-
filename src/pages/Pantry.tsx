import React, { useState } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Star, Bookmark, ChevronRight, Plus, Heart, Trash2, X, ArrowLeft, ListPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type CustomList } from '../contexts/ListsContext';
import { Link } from 'react-router-dom';

type Tab = 'lists' | 'rated' | 'wishlist';

/* ── Shared restaurant card used in list detail + rated tab ── */
const RestaurantRow: React.FC<{
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  score?: number;
  tags?: string[];
  notes?: string;
  visitDate?: string;
  wouldReturn?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}> = ({ restaurantId, name, image, cuisine, price, score, tags, notes, visitDate, wouldReturn, onEdit, onRemove, removeLabel }) => {
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
            <p className="text-xs text-on-surface/40 mt-1.5 line-clamp-2 italic">"{notes}"</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-on-surface/5">
          <span className="text-[10px] text-on-surface/30">
            {visitDate ? new Date(visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
            {wouldReturn && (visitDate ? ' · ' : '') + 'Would return'}
          </span>
          <div className="flex items-center gap-3">
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

/* ── List Detail View (shows all restaurants in a specific list) ── */
const ListDetailView: React.FC<{
  list: CustomList;
  onBack: () => void;
}> = ({ list, onBack }) => {
  const { ratings, wishlist, getRestaurantInfo, removeFromList, openRatingModal, deleteList } = useLists();

  const restaurants = list.restaurantIds.map((id) => {
    const info = getRestaurantInfo(id);
    const rating = ratings.find((r) => r.restaurantId === id);
    return { id, info, rating };
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
          <ArrowLeft size={20} />
        </button>
        <span className="text-2xl">{list.emoji}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif font-bold text-xl">{list.name}</h2>
          <p className="text-xs text-on-surface/40">
            {list.restaurantIds.length} restaurant{list.restaurantIds.length !== 1 ? 's' : ''}
            {restaurants.filter((r) => r.rating).length > 0 && ` · ${restaurants.filter((r) => r.rating).length} rated`}
          </p>
        </div>
        <button
          onClick={() => { deleteList(list.id); onBack(); }}
          className="p-2 text-red-400 hover:text-red-500 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {restaurants.length === 0 ? (
        <div className="text-center py-16">
          <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">This list is empty</p>
          <p className="text-xs text-on-surface/30 mt-1">Add restaurants from their detail page</p>
        </div>
      ) : (
        <div className="space-y-3">
          {restaurants.map(({ id, info, rating }) => {
            const name = info?.name ?? id;
            const image = info?.image ?? '';
            const cuisine = info?.cuisine ?? '';
            const price = info?.price ?? '';

            return (
              <RestaurantRow
                key={id}
                restaurantId={id}
                name={name}
                image={image}
                cuisine={cuisine}
                price={price}
                score={rating?.score}
                tags={rating?.tags}
                notes={rating?.notes}
                visitDate={rating?.visitDate}
                wouldReturn={rating?.wouldReturn}
                onEdit={info ? () => openRatingModal({ id, name, image, cuisine, price, address: info.address }) : undefined}
                onRemove={() => removeFromList(list.id, id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Main Page ── */
export const Pantry: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('lists');
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListEmoji, setNewListEmoji] = useState('📋');
  const [selectedList, setSelectedList] = useState<CustomList | null>(null);

  const {
    lists, createList,
    ratings, openRatingModal,
    wishlist, removeFromWishlist,
    getListsForRestaurant,
  } = useLists();

  const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

  const handleCreateList = () => {
    if (!newListName.trim()) return;
    createList(newListName.trim(), newListEmoji);
    setNewListName('');
    setNewListEmoji('📋');
    setCreatingList(false);
  };

  // Keep selectedList in sync with lists state
  const currentList = selectedList ? lists.find((l) => l.id === selectedList.id) ?? null : null;

  return (
    <div className="pb-32">
      <TopBar title="My Lists" />

      <main className="px-5">
        {/* If a list is selected, show detail view */}
        {currentList ? (
          <ListDetailView list={currentList} onBack={() => setSelectedList(null)} />
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex gap-1 bg-on-surface/5 rounded-2xl p-1 mb-6">
              {([
                { key: 'lists' as Tab, label: 'Lists', count: lists.length },
                { key: 'rated' as Tab, label: 'Rated', count: ratings.length },
                { key: 'wishlist' as Tab, label: 'Wishlist', count: wishlist.length },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                    activeTab === tab.key
                      ? "bg-white text-on-surface shadow-sm"
                      : "text-on-surface/40"
                  )}
                >
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={cn(
                      "ml-1.5 text-[10px]",
                      activeTab === tab.key ? "text-primary" : "text-on-surface/30"
                    )}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Lists Tab ── */}
            {activeTab === 'lists' && (
              <div className="space-y-3">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => setSelectedList(list)}
                    className="w-full flex items-center gap-3.5 p-4 bg-white rounded-2xl border border-on-surface/8 shadow-sm hover:shadow-md transition-all text-left group"
                  >
                    <span className="text-2xl">{list.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-serif font-bold text-base">{list.name}</h3>
                      <p className="text-[11px] text-on-surface/40 font-medium">
                        {list.restaurantIds.length} restaurant{list.restaurantIds.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-on-surface/30 group-hover:text-on-surface/50 transition-colors" />
                  </button>
                ))}

                {/* Create new list */}
                {creatingList ? (
                  <div className="p-4 bg-white rounded-2xl border border-primary/20 shadow-sm space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {EMOJI_OPTIONS.map((e) => (
                        <button
                          key={e}
                          onClick={() => setNewListEmoji(e)}
                          className={cn(
                            "w-9 h-9 rounded-lg flex items-center justify-center text-base transition-all",
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
                      className="w-full bg-surface border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setCreatingList(false); setNewListName(''); }}
                        className="flex-1 py-2.5 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateList}
                        disabled={!newListName.trim()}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreatingList(true)}
                    className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all"
                  >
                    <Plus size={18} />
                    <span className="text-sm font-semibold">Create New List</span>
                  </button>
                )}
              </div>
            )}

            {/* ── Rated Tab ── */}
            {activeTab === 'rated' && (
              <div>
                {ratings.length === 0 ? (
                  <div className="text-center py-16">
                    <Star size={32} className="mx-auto text-on-surface/15 mb-3" />
                    <p className="text-sm font-medium text-on-surface/40">No ratings yet</p>
                    <p className="text-xs text-on-surface/30 mt-1">Rate restaurants from their detail page</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Summary bar */}
                    <div className="flex items-center gap-4 px-1 mb-2">
                      <p className="text-xs text-on-surface/40">
                        <span className="font-bold text-on-surface">{ratings.length}</span> rated
                      </p>
                      <p className="text-xs text-on-surface/40">
                        Avg: <span className="font-bold text-on-surface">{(ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length).toFixed(1)}</span>/10
                      </p>
                    </div>

                    {ratings.map((r) => {
                      const inLists = getListsForRestaurant(r.restaurantId);
                      return (
                        <div key={r.restaurantId}>
                          <RestaurantRow
                            restaurantId={r.restaurantId}
                            name={r.name}
                            image={r.image}
                            cuisine={r.cuisine}
                            price={r.price}
                            score={r.score}
                            tags={r.tags}
                            notes={r.notes}
                            visitDate={r.visitDate}
                            wouldReturn={r.wouldReturn}
                            onEdit={() => openRatingModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                          />
                          {inLists.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5 ml-1">
                              {inLists.map((l) => (
                                <span key={l.id} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/8 text-secondary/70 font-medium">
                                  {l.emoji} {l.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Wishlist Tab ── */}
            {activeTab === 'wishlist' && (
              <div>
                {wishlist.length === 0 ? (
                  <div className="text-center py-16">
                    <Bookmark size={32} className="mx-auto text-on-surface/15 mb-3" />
                    <p className="text-sm font-medium text-on-surface/40">Your wishlist is empty</p>
                    <p className="text-xs text-on-surface/30 mt-1">Save restaurants you want to try</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {wishlist.map((w) => (
                      <RestaurantRow
                        key={w.restaurantId}
                        restaurantId={w.restaurantId}
                        name={w.name}
                        image={w.image}
                        cuisine={w.cuisine}
                        price={w.price}
                        onRemove={() => removeFromWishlist(w.restaurantId)}
                        removeLabel="Remove"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
