import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { Star, ChevronRight, Plus, Trash2, ArrowLeft, ListPlus, MapPin, SlidersHorizontal, X, ChevronDown, Heart, Upload, Search, Check, Edit3, LayoutGrid, List } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type CustomList } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { Link, useNavigate } from 'react-router-dom';

/* ── Preset list suggestions ── */
interface PresetList { name: string; emoji: string; category: string; }

const PRESET_LISTS: PresetList[] = [
  { name: 'Best Date Night Spots', emoji: '🕯️', category: 'Occasion & Vibe' },
  { name: 'Birthday & Celebrations', emoji: '🎂', category: 'Occasion & Vibe' },
  { name: 'Late Night Eats', emoji: '🌙', category: 'Occasion & Vibe' },
  { name: 'Solo Dining Friendly', emoji: '🧘', category: 'Occasion & Vibe' },
  { name: 'Group Dinner & Big Tables', emoji: '👥', category: 'Occasion & Vibe' },
  { name: 'Business Dinners', emoji: '💼', category: 'Occasion & Vibe' },
  { name: 'Outdoor Dining & Patios', emoji: '🌳', category: 'Occasion & Vibe' },
  { name: 'Cozy & Intimate', emoji: '🪵', category: 'Occasion & Vibe' },
  { name: 'Live Music & Dining', emoji: '🎵', category: 'Occasion & Vibe' },
  { name: 'Airport Food', emoji: '✈️', category: 'Travel & Location' },
  { name: 'Hotel Restaurants', emoji: '🏨', category: 'Travel & Location' },
  { name: 'Hotel Breakfasts', emoji: '🛏️', category: 'Travel & Location' },
  { name: 'Vacation Eats', emoji: '🏖️', category: 'Travel & Location' },
  { name: 'Road Trip Stops', emoji: '🚗', category: 'Travel & Location' },
  { name: 'Ski Resort Dining', emoji: '⛷️', category: 'Travel & Location' },
  { name: 'Beach Town Eats', emoji: '🏝️', category: 'Travel & Location' },
  { name: 'College Town Favorites', emoji: '🎓', category: 'Travel & Location' },
  { name: 'Hidden Gems', emoji: '💎', category: 'Insider & Opinion' },
  { name: 'Overrated Places', emoji: '👎', category: 'Insider & Opinion' },
  { name: 'Best Bang for Your Buck', emoji: '💰', category: 'Insider & Opinion' },
  { name: 'Worth the Hype', emoji: '🔥', category: 'Insider & Opinion' },
  { name: 'Tourist Traps vs Local Faves', emoji: '🗺️', category: 'Insider & Opinion' },
  { name: "Places I'd Never Go Back To", emoji: '🚫', category: 'Insider & Opinion' },
  { name: 'Underrated Spots', emoji: '🤫', category: 'Insider & Opinion' },
  { name: 'Best Burgers', emoji: '🍔', category: 'Food-Specific' },
  { name: 'Best Pizza', emoji: '🍕', category: 'Food-Specific' },
  { name: 'Best Pasta', emoji: '🍝', category: 'Food-Specific' },
  { name: 'Best Coffee Shops', emoji: '☕', category: 'Food-Specific' },
  { name: 'Best Desserts', emoji: '🍰', category: 'Food-Specific' },
  { name: 'Best Brunch', emoji: '🥞', category: 'Food-Specific' },
  { name: 'Best Steak', emoji: '🥩', category: 'Food-Specific' },
  { name: 'Best Sushi & Omakase', emoji: '🍣', category: 'Food-Specific' },
  { name: 'Best Cocktails', emoji: '🍸', category: 'Food-Specific' },
  { name: 'Best Tacos', emoji: '🌮', category: 'Food-Specific' },
  { name: 'Best Ramen & Noodles', emoji: '🍜', category: 'Food-Specific' },
  { name: 'Best Seafood', emoji: '🦞', category: 'Food-Specific' },
  { name: 'Michelin Star Experiences', emoji: '⭐', category: 'Luxury & Lifestyle' },
  { name: 'Best Tasting Menus', emoji: '🍽️', category: 'Luxury & Lifestyle' },
  { name: 'Luxury Dining', emoji: '👑', category: 'Luxury & Lifestyle' },
  { name: 'Best Rooftop Restaurants', emoji: '🏙️', category: 'Luxury & Lifestyle' },
  { name: 'Best Views', emoji: '🌅', category: 'Luxury & Lifestyle' },
  { name: "Chef's Table Experiences", emoji: '👨‍🍳', category: 'Luxury & Lifestyle' },
  { name: 'Quick Bites', emoji: '⚡', category: 'Functional & Daily' },
  { name: 'Best Takeout', emoji: '📦', category: 'Functional & Daily' },
  { name: 'Delivery Favorites', emoji: '🚲', category: 'Functional & Daily' },
  { name: 'Healthy Options', emoji: '🥗', category: 'Functional & Daily' },
  { name: 'Vegetarian & Vegan', emoji: '🌿', category: 'Functional & Daily' },
  { name: 'Gluten-Free Friendly', emoji: '🌾', category: 'Functional & Daily' },
  { name: 'Kid-Friendly', emoji: '👶', category: 'Functional & Daily' },
  { name: 'Budget Eats', emoji: '🪙', category: 'Functional & Daily' },
  { name: "Friends' Favorites", emoji: '👯', category: 'Social' },
  { name: "Places We've Been Together", emoji: '🤝', category: 'Social' },
  { name: 'Friend Recommendations', emoji: '💬', category: 'Social' },
  { name: 'Want to Try Together', emoji: '📌', category: 'Social' },
];

const PRESET_CATEGORIES = [...new Set(PRESET_LISTS.map((p) => p.category))];
const CUSTOM_EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃', '🍔', '🥩', '🍝', '🍰', '🌙', '👥', '💼', '✈️', '🏨', '🎂', '⭐', '👑', '🏙️', '🥗', '🪙', '👶'];

/* ── Create New List Bottom Sheet ── */
const CreateListSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, emoji: string) => void;
  existingListNames: string[];
}> = ({ open, onClose, onCreate, existingListNames }) => {
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'browse' | 'custom'>('browse');
  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('📋');

  const existingNamesLower = useMemo(() => new Set(existingListNames.map((n) => n.toLowerCase())), [existingListNames]);

  const filteredPresets = useMemo(() => {
    if (!search.trim()) return PRESET_LISTS;
    const q = search.toLowerCase();
    return PRESET_LISTS.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [search]);

  const groupedPresets = useMemo(() => {
    const groups: Record<string, PresetList[]> = {};
    for (const preset of filteredPresets) {
      if (!groups[preset.category]) groups[preset.category] = [];
      groups[preset.category].push(preset);
    }
    return groups;
  }, [filteredPresets]);

  const handleSelectPreset = (preset: PresetList) => { onCreate(preset.name, preset.emoji); handleClose(); };
  const handleCreateCustom = () => { if (!customName.trim()) return; onCreate(customName.trim(), customEmoji); handleClose(); };
  const handleClose = () => { setSearch(''); setMode('browse'); setCustomName(''); setCustomEmoji('📋'); onClose(); };

  const dragY = useMotionValue(0);
  const backdropOpacity = useTransform(dragY, [0, 300], [1, 0]);
  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) { handleClose(); }
    else { dragY.set(0); }
  };

  // Reset drag position when sheet opens
  useEffect(() => { if (open) dragY.set(0); }, [open, dragY]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div style={phoneMode ? { opacity: backdropOpacity } : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center" onClick={handleClose}>
          <motion.div
            initial={phoneMode ? { y: '100%' } : { y: 40, opacity: 0 }}
            animate={phoneMode ? { y: 0 } : { y: 0, opacity: 1 }}
            exit={phoneMode ? { y: '100%' } : { y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag={phoneMode ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            style={phoneMode ? { y: dragY } : undefined}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface overflow-hidden flex flex-col", phoneMode ? "w-full rounded-t-3xl max-h-[90vh]" : "w-full max-w-md rounded-3xl max-h-[75vh] shadow-2xl")}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="font-serif font-bold text-lg">{mode === 'browse' ? 'New List' : 'Create Custom List'}</h2>
              <button onClick={handleClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
            </div>

            {mode === 'browse' ? (
              <>
                <div className="px-5 pb-3">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lists..."
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                  </div>
                </div>
                <div className="px-5 pb-3">
                  <button onClick={() => setMode('custom')} className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/20 text-primary hover:bg-primary/5 transition-all">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Edit3 size={16} /></div>
                    <div className="text-left">
                      <p className="text-sm font-semibold">Create Custom List</p>
                      <p className="text-[11px] text-primary/60">Choose your own name & emoji</p>
                    </div>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-5">
                  {Object.keys(groupedPresets).length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-sm text-on-surface/40">No matching lists found</p>
                      <button onClick={() => { setMode('custom'); setCustomName(search); }} className="mt-3 text-sm font-semibold text-primary">Create "{search}" as custom list</button>
                    </div>
                  ) : (
                    PRESET_CATEGORIES.filter((cat) => groupedPresets[cat]).map((category) => (
                      <div key={category} className="mb-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mb-2 px-1">{category}</p>
                        <div className="space-y-1.5">
                          {groupedPresets[category].map((preset) => {
                            const alreadyExists = existingNamesLower.has(preset.name.toLowerCase());
                            return (
                              <button key={preset.name} onClick={() => !alreadyExists && handleSelectPreset(preset)} disabled={alreadyExists}
                                className={cn("w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left",
                                  alreadyExists ? "bg-on-surface/3 border-on-surface/5 opacity-50 cursor-not-allowed" : "bg-white border-on-surface/8 hover:border-primary/30 hover:bg-primary/3 active:bg-primary/5")}>
                                <span className="text-xl flex-shrink-0">{preset.emoji}</span>
                                <span className="text-sm font-medium flex-1 truncate">{preset.name}</span>
                                {alreadyExists ? <span className="text-[10px] text-on-surface/30 font-medium flex-shrink-0">Added</span> : <Plus size={16} className="text-on-surface/20 flex-shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="px-5 pb-5 space-y-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">Choose an emoji</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CUSTOM_EMOJI_OPTIONS.map((e) => (
                      <button key={e} onClick={() => setCustomEmoji(e)}
                        className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all", customEmoji === e ? "bg-primary/10 ring-2 ring-primary/30 scale-110" : "hover:bg-on-surface/5")}>{e}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">List name</p>
                  <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Enter list name..." autoFocus
                    className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCustom()} />
                </div>
                {customName.trim() && (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl border border-primary/10">
                    <span className="text-2xl">{customEmoji}</span>
                    <span className="text-sm font-semibold">{customName.trim()}</span>
                  </div>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setMode('browse'); setCustomName(''); setCustomEmoji('📋'); }} className="flex-1 py-3 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50">Back</button>
                  <button onClick={handleCreateCustom} disabled={!customName.trim()} className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40 transition-colors">Create List</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

/* ── Add From Rated Bottom Sheet ── */
const AddFromRatedSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  listId: string;
  listRestaurantIds: string[];
}> = ({ open, onClose, listId, listRestaurantIds }) => {
  const { ratings, addToList, removeFromList } = useLists();
  const { phoneMode } = useSettings();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return ratings;
    const q = search.toLowerCase();
    return ratings.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
  }, [ratings, search]);

  const handleToggle = (restaurantId: string) => {
    if (listRestaurantIds.includes(restaurantId)) removeFromList(listId, restaurantId);
    else addToList(listId, restaurantId);
  };

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

  const dragY = useMotionValue(0);
  const backdropOpacity = useTransform(dragY, [0, 300], [1, 0]);
  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) { onClose(); }
    else { dragY.set(0); }
  };

  // Reset drag position when sheet opens
  useEffect(() => { if (open) dragY.set(0); }, [open, dragY]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div style={phoneMode ? { opacity: backdropOpacity } : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center" onClick={onClose}>
          <motion.div
            initial={phoneMode ? { y: '100%' } : { y: 40, opacity: 0 }}
            animate={phoneMode ? { y: 0 } : { y: 0, opacity: 1 }}
            exit={phoneMode ? { y: '100%' } : { y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            drag={phoneMode ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            style={phoneMode ? { y: dragY } : undefined}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface overflow-hidden flex flex-col", phoneMode ? "w-full rounded-t-3xl max-h-[85vh]" : "w-full max-w-md rounded-3xl max-h-[70vh] shadow-2xl")}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="font-serif font-bold text-lg">Add Rated Restaurants</h2>
              <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
            </div>
            <div className="px-5 pb-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, cuisine, or location..."
                  className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
              </div>
            </div>
            <div className="px-5 pb-2">
              <p className="text-[11px] text-on-surface/40 font-medium">{filtered.length} restaurant{filtered.length !== 1 ? 's' : ''}{listRestaurantIds.length > 0 && ` · ${listRestaurantIds.length} in list`}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
              {filtered.length === 0 ? (
                <div className="text-center py-12"><p className="text-sm text-on-surface/40">{ratings.length === 0 ? 'No rated restaurants yet' : 'No matches found'}</p></div>
              ) : filtered.map((r) => {
                const isInList = listRestaurantIds.includes(r.restaurantId);
                return (
                  <button key={r.restaurantId} onClick={() => handleToggle(r.restaurantId)}
                    className={cn("w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left", isInList ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                    <div className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-on-surface/5">
                      {r.image ? <img src={r.image} alt={r.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-on-surface/20 font-serif font-bold text-sm">{r.name.charAt(0)}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <p className="text-[11px] text-on-surface/40 truncate">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                    </div>
                    {r.score > 0 && <span className={cn("text-sm font-serif font-bold flex-shrink-0", scoreColor(r.score))}>{r.score.toFixed(1)}</span>}
                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all flex-shrink-0", isInList ? "bg-primary border-primary text-white" : "border-on-surface/15")}>
                      {isInList && <Check size={14} strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

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

/* ── Grid card for desktop grid view ── */
const RestaurantGridCard: React.FC<{
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  score?: number;
  onEdit?: () => void;
}> = ({ restaurantId, name, image, cuisine, price, score, onEdit }) => {
  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';
  return (
    <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden">
      <Link to={`/restaurant/${restaurantId}`} className="block aspect-[4/3] overflow-hidden">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full bg-on-surface/5 flex items-center justify-center text-on-surface/20 text-3xl font-serif font-bold">
            {name.charAt(0)}
          </div>
        )}
      </Link>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/restaurant/${restaurantId}`} className="min-w-0 flex-1">
            <h3 className="font-serif font-bold text-sm leading-tight truncate">{name}</h3>
          </Link>
          {score !== undefined && score > 0 && (
            <span className={cn("text-base font-serif font-bold flex-shrink-0", scoreColor(score))}>{score.toFixed(1)}</span>
          )}
        </div>
        <p className="text-[10px] text-on-surface/50 font-semibold uppercase tracking-wider mt-0.5">
          {cuisine}{price ? ` · ${price}` : ''}
        </p>
        {onEdit && (
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
            className="mt-2 text-[10px] font-bold text-primary uppercase tracking-wider hover:text-primary/70">Edit</button>
        )}
      </div>
    </div>
  );
};

/* ── View mode toggle (desktop only) ── */
const ViewModeToggle: React.FC<{ mode: 'list' | 'grid'; onChange: (m: 'list' | 'grid') => void }> = ({ mode, onChange }) => {
  const { phoneMode } = useSettings();
  if (phoneMode) return null;
  return (
    <div className="flex items-center gap-1 bg-on-surface/5 rounded-lg p-0.5">
      <button onClick={() => onChange('list')} className={cn("p-1.5 rounded-md transition-all", mode === 'list' ? "bg-white shadow-sm text-primary" : "text-on-surface/30 hover:text-on-surface/50")}>
        <List size={15} />
      </button>
      <button onClick={() => onChange('grid')} className={cn("p-1.5 rounded-md transition-all", mode === 'grid' ? "bg-white shadow-sm text-primary" : "text-on-surface/30 hover:text-on-surface/50")}>
        <LayoutGrid size={15} />
      </button>
    </div>
  );
};

/* ── List Detail View ── */
const ListDetailView: React.FC<{
  list: CustomList;
  viewMode: 'list' | 'grid';
  onViewModeChange: (m: 'list' | 'grid') => void;
  onBack: () => void;
}> = ({ list, viewMode, onViewModeChange, onBack }) => {
  const { ratings, getRestaurantInfo, removeFromList, removeFromWishlistInList, openRatingModal, deleteList, wishlist } = useLists();
  const [addSheetOpen, setAddSheetOpen] = useState(false);

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
          onClick={() => setAddSheetOpen(true)}
          className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors"
          title="Add restaurants"
        >
          <Plus size={20} />
        </button>
        <button
          onClick={() => { deleteList(list.id); onBack(); }}
          className="p-2 text-red-400 hover:text-red-500 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* View mode toggle for desktop */}
      {totalCount > 0 && (
        <div className="flex justify-end mb-3">
          <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />
        </div>
      )}

      {totalCount === 0 ? (
        <div className="text-center py-16">
          <ListPlus size={32} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">This list is empty</p>
          <p className="text-xs text-on-surface/30 mt-1">Add restaurants from your rated collection</p>
          <button onClick={() => setAddSheetOpen(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
            <Plus size={14} />Add Restaurants
          </button>
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
              <div className={viewMode === 'grid' ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "space-y-3"}>
                {ratedRestaurants.map(({ id, info, rating }) => viewMode === 'grid' ? (
                  <RestaurantGridCard
                    key={id}
                    restaurantId={id}
                    name={info?.name ?? id}
                    image={info?.image ?? ''}
                    cuisine={info?.cuisine ?? ''}
                    price={info?.price ?? ''}
                    score={rating?.score}
                    onEdit={info ? () => openRatingModal({ id, name: info.name, image: info.image, cuisine: info.cuisine, price: info.price, address: info.address }) : undefined}
                  />
                ) : (
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
          {/* Add more button */}
          <button onClick={() => setAddSheetOpen(true)}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
            <Plus size={16} /><span className="text-sm font-semibold">Add Restaurants</span>
          </button>
        </div>
      )}

      <AddFromRatedSheet open={addSheetOpen} onClose={() => setAddSheetOpen(false)} listId={list.id} listRestaurantIds={list.restaurantIds} />
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
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const navigate = useNavigate();

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

  const listScrollRef = useRef<HTMLDivElement>(null);

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

      <main className="px-3">
        {currentList ? (
          <ListDetailView list={currentList} viewMode={viewMode} onViewModeChange={setViewMode} onBack={() => setSelectedList(null)} />
        ) : (
          <>
            {/* ── Horizontal list row ── */}
            <div className="mb-4">
              <div
                ref={listScrollRef}
                className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-3 px-3"
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
                <button
                  onClick={() => setCreateSheetOpen(true)}
                  className="flex items-center gap-1 px-3 py-2 rounded-full border-2 border-dashed border-on-surface/12 text-on-surface/35 hover:border-primary hover:text-primary transition-all flex-shrink-0"
                >
                  <Plus size={14} />
                  <span className="text-xs font-semibold whitespace-nowrap">New List</span>
                </button>
              </div>
            </div>

            {/* ── Filter chips ── */}
            <div className="flex gap-2 mb-5 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
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
                <div className="ml-auto">
                  <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                </div>
              </div>
            )}

            {/* ── Restaurant list ── */}
            {ratings.length === 0 && wishlist.length === 0 ? (
              <div className="text-center py-16">
                <Star size={32} className="mx-auto text-on-surface/15 mb-3" />
                <p className="text-sm font-medium text-on-surface/40">No restaurants yet</p>
                <p className="text-xs text-on-surface/30 mt-1">Use the + button to rate or heart to wishlist</p>
                <button onClick={() => navigate('/import')}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-colors">
                  <Upload size={14} />Import Previous Ratings
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Rated section */}
                {filteredRatings.length > 0 ? (
                  <div className={viewMode === 'grid' ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "space-y-3"}>
                    {filteredRatings.map((r) => {
                      const inLists = getListsForRestaurant(r.restaurantId);
                      return viewMode === 'grid' ? (
                        <RestaurantGridCard
                          key={r.restaurantId}
                          restaurantId={r.restaurantId}
                          name={r.name}
                          image={r.image}
                          cuisine={r.cuisine}
                          price={r.price}
                          score={r.score}
                          onEdit={() => openRatingModal({ id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address })}
                        />
                      ) : (
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

      {/* Create list bottom sheet */}
      <CreateListSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreate={(name, emoji) => createList(name, emoji)}
        existingListNames={lists.map((l) => l.name)}
      />
    </div>
  );
};
