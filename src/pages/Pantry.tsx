import React, { useState } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Star, Bookmark, ChevronRight, Plus, Heart, Trash2, X, BookmarkCheck, ListPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';
import { Link } from 'react-router-dom';

type Tab = 'lists' | 'rated' | 'wishlist';

export const Pantry: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('lists');
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListEmoji, setNewListEmoji] = useState('📋');
  const [expandedList, setExpandedList] = useState<string | null>(null);

  const {
    lists, createList, deleteList,
    ratings, removeRating, openRatingModal,
    wishlist, removeFromWishlist,
  } = useLists();

  const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

  const handleCreateList = () => {
    if (!newListName.trim()) return;
    createList(newListName.trim(), newListEmoji);
    setNewListName('');
    setNewListEmoji('📋');
    setCreatingList(false);
  };

  const scoreColor = (score: number) => score >= 8 ? 'text-green-600' : score >= 5 ? 'text-yellow-600' : 'text-red-500';

  return (
    <div className="pb-32">
      <TopBar title="My Lists" />

      <main className="px-5">
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
              <div key={list.id}>
                <button
                  onClick={() => setExpandedList(expandedList === list.id ? null : list.id)}
                  className={cn(
                    "w-full flex items-center gap-3.5 p-4 bg-white rounded-2xl border border-on-surface/8 shadow-sm transition-all text-left",
                    expandedList === list.id && "ring-2 ring-primary/15"
                  )}
                >
                  <span className="text-2xl">{list.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-bold text-base">{list.name}</h3>
                    <p className="text-[11px] text-on-surface/40 font-medium">
                      {list.restaurantIds.length} restaurant{list.restaurantIds.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className={cn(
                      "text-on-surface/30 transition-transform",
                      expandedList === list.id && "rotate-90"
                    )}
                  />
                </button>

                <AnimatePresence>
                  {expandedList === list.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-2 pl-4 space-y-2">
                        {list.restaurantIds.length === 0 ? (
                          <p className="text-xs text-on-surface/30 py-3 pl-2">No restaurants yet. Add some from the map or search!</p>
                        ) : (
                          list.restaurantIds.map((id) => {
                            const rated = ratings.find((r) => r.restaurantId === id);
                            const wished = wishlist.find((w) => w.restaurantId === id);
                            const name = rated?.name ?? wished?.name ?? id;
                            const image = rated?.image ?? wished?.image;
                            return (
                              <Link
                                key={id}
                                to={`/restaurant/${id}`}
                                className="flex items-center gap-3 p-2.5 bg-on-surface/[0.02] rounded-xl hover:bg-on-surface/[0.05] transition-colors"
                              >
                                {image ? (
                                  <img src={image} alt={name} className="w-10 h-10 rounded-lg object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-xs font-bold">
                                    {name.charAt(0)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold truncate">{name}</p>
                                  {rated && (
                                    <p className={cn("text-xs font-bold", scoreColor(rated.score))}>{rated.score.toFixed(1)}/10</p>
                                  )}
                                </div>
                              </Link>
                            );
                          })
                        )}
                        <button
                          onClick={() => deleteList(list.id)}
                          className="flex items-center gap-2 text-xs text-red-400 hover:text-red-500 py-2 pl-2 transition-colors"
                        >
                          <Trash2 size={12} />
                          Delete list
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
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
              <div className="space-y-4">
                {ratings.map((r) => (
                  <Link key={r.restaurantId} to={`/restaurant/${r.restaurantId}`}>
                    <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden flex">
                      <div className="w-24 sm:w-28 flex-shrink-0">
                        {r.image ? (
                          <img src={r.image} alt={r.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-2xl font-serif font-bold">
                            {r.name.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 p-4 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-serif font-bold text-sm leading-tight">{r.name}</h3>
                            <div className={cn("text-lg font-serif font-bold flex-shrink-0", scoreColor(r.score))}>
                              {r.score.toFixed(1)}
                            </div>
                          </div>
                          <p className="text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
                            {r.cuisine} · {r.price}
                          </p>
                          {r.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {r.tags.slice(0, 3).map((tag) => (
                                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{tag}</span>
                              ))}
                              {r.tags.length > 3 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-on-surface/5 text-on-surface/30 font-medium">+{r.tags.length - 3}</span>
                              )}
                            </div>
                          )}
                          {r.notes && (
                            <p className="text-xs text-on-surface/40 mt-2 line-clamp-2 italic">"{r.notes}"</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-on-surface/5">
                          <span className="text-[10px] text-on-surface/30">
                            {r.visitDate ? new Date(r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                            {r.wouldReturn && ' · Would return'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openRatingModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address });
                            }}
                            className="text-[10px] font-bold text-primary uppercase tracking-wider hover:text-primary/70"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
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
              <div className="space-y-4">
                {wishlist.map((w) => (
                  <Link key={w.restaurantId} to={`/restaurant/${w.restaurantId}`}>
                    <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden flex">
                      <div className="w-24 sm:w-28 flex-shrink-0">
                        {w.image ? (
                          <img src={w.image} alt={w.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-2xl font-serif font-bold">
                            {w.name.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 p-4 min-w-0 flex flex-col justify-between">
                        <div>
                          <h3 className="font-serif font-bold text-sm leading-tight">{w.name}</h3>
                          <p className="text-[11px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
                            {w.cuisine} · {w.price}
                          </p>
                          <p className="text-xs text-on-surface/40 mt-1">{w.address}</p>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-on-surface/5">
                          <span className="text-[10px] text-on-surface/30">
                            Added {new Date(w.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeFromWishlist(w.restaurantId);
                            }}
                            className="text-[10px] font-bold text-red-400 uppercase tracking-wider hover:text-red-500"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
