import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Send, Search, X, Users, Check, CheckCheck, MessageCircle, ChevronRight, Star, MapPin, Trash2, Share2, ChefHat, Clock, Film, PlayCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';
import { useChat, type Conversation, type SharedRestaurant, type SharedRecipe, type SharedReel, type SharedPost } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import { getFriends, getProfilesByIds, type UserProfile } from '../lib/supabase-community';

/* ── Restaurant Share Card (iMessage-style rich preview) ── */
const RestaurantShareCard: React.FC<{
  restaurant: SharedRestaurant;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ restaurant, isMe, hasTextAbove, onClick }) => {
  // Color tokens adapt to bubble side
  const scoreClr = isMe ? 'text-white' : scoreColor(restaurant.score ?? 0);
  const titleCls = isMe ? 'text-white' : 'text-on-surface';
  const subCls = isMe ? 'text-white/75' : 'text-on-surface/50';
  const faintCls = isMe ? 'text-white/60' : 'text-on-surface/40';
  const tagCls = isMe ? 'bg-white/18 text-white/95' : 'bg-primary/8 text-primary';

  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full max-w-[280px] overflow-hidden text-left active:scale-[0.985] transition-transform",
        // Match bubble corner shape (flat top if text sits above)
        hasTextAbove ? "rounded-b-2xl" : "rounded-2xl",
        isMe
          ? cn("bg-primary", hasTextAbove ? "" : "rounded-br-md")
          : cn("bg-on-surface/[0.06]", hasTextAbove ? "" : "rounded-bl-md")
      )}
    >
      {restaurant.image && (
        <div className="w-full aspect-[5/3] overflow-hidden bg-black/5">
          <img src={restaurant.image} alt={restaurant.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="px-3.5 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-semibold truncate leading-snug", titleCls)}>{restaurant.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {restaurant.cuisine && <span className={cn("text-[11px]", subCls)}>{restaurant.cuisine}</span>}
              {restaurant.price && <span className={cn("text-[11px]", faintCls)}>{restaurant.price}</span>}
            </div>
          </div>
          {restaurant.isReview && restaurant.score !== undefined && (
            <div className="flex-shrink-0 text-right leading-none pl-1">
              <span className={cn("text-lg font-serif font-bold tabular-nums", scoreClr)}>{restaurant.score.toFixed(1)}</span>
              <p className={cn("text-[9px] font-medium", faintCls)}>/10</p>
            </div>
          )}
        </div>
        {restaurant.address && (
          <div className="flex items-center gap-1 mt-1.5">
            <MapPin size={10} className={cn("flex-shrink-0", faintCls)} />
            <span className={cn("text-[11px] truncate", subCls)}>{restaurant.address}</span>
          </div>
        )}
        {restaurant.isReview && restaurant.notes && (
          <p className={cn("text-[12px] mt-1.5 line-clamp-2 leading-relaxed italic", subCls)}>"{restaurant.notes}"</p>
        )}
        {restaurant.isReview && restaurant.tags && restaurant.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {restaurant.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={cn("px-1.5 py-0.5 text-[10px] font-semibold rounded-full", tagCls)}>{tag}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
};

/* ── Recipe Share Card (iMessage-style rich preview) ── */
const RecipeShareCard: React.FC<{
  recipe: SharedRecipe;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ recipe, isMe, hasTextAbove, onClick }) => {
  const totalLabel = recipe.totalTime && recipe.totalTime > 0
    ? (recipe.totalTime < 60 ? `${recipe.totalTime}m` : `${Math.floor(recipe.totalTime / 60)}h ${recipe.totalTime % 60 ? `${recipe.totalTime % 60}m` : ''}`.trim())
    : '';

  const titleCls = isMe ? 'text-white' : 'text-on-surface';
  const subCls = isMe ? 'text-white/75' : 'text-on-surface/50';
  const faintCls = isMe ? 'text-white/60' : 'text-on-surface/40';
  const accentCls = isMe ? 'text-white/90' : 'text-emerald-700';
  const pillCls = isMe ? 'bg-white/18 text-white/95' : 'bg-emerald-100 text-emerald-700/85';
  const neutralPillCls = isMe ? 'bg-white/12 text-white/80' : 'bg-on-surface/5 text-on-surface/50';

  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full max-w-[280px] overflow-hidden text-left active:scale-[0.985] transition-transform",
        hasTextAbove ? "rounded-b-2xl" : "rounded-2xl",
        isMe
          ? cn("bg-primary", hasTextAbove ? "" : "rounded-br-md")
          : cn("bg-on-surface/[0.06]", hasTextAbove ? "" : "rounded-bl-md")
      )}
    >
      {recipe.image && (
        <div className="w-full aspect-[5/3] overflow-hidden bg-black/5">
          <img src={recipe.image} alt={recipe.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <ChefHat size={12} className={accentCls} />
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", accentCls)}>
            {recipe.authorName}&rsquo;s recipe
          </span>
        </div>
        <p className={cn("text-sm font-serif font-bold truncate leading-snug", titleCls)}>{recipe.name}</p>
        {recipe.description && (
          <p className={cn("text-[12px] mt-0.5 line-clamp-1 leading-snug italic", subCls)}>{recipe.description}</p>
        )}
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {totalLabel && (
            <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full", pillCls)}>
              <Clock size={9} /> {totalLabel}
            </span>
          )}
          {recipe.difficulty && (
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", neutralPillCls)}>{recipe.difficulty}</span>
          )}
          {(recipe.ingredientCount ?? 0) > 0 && (
            <span className={cn("text-[10px]", faintCls)}>{recipe.ingredientCount} ingredients</span>
          )}
        </div>
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {recipe.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={cn("px-1.5 py-0.5 text-[10px] font-semibold rounded-full", neutralPillCls)}>{tag}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
};

/* ── Reel Share Card (iMessage-style rich preview) ── */
const ReelShareCard: React.FC<{
  reel: SharedReel;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ reel, isMe, hasTextAbove, onClick }) => {
  const titleCls = isMe ? 'text-white' : 'text-on-surface';
  const subCls = isMe ? 'text-white/75' : 'text-on-surface/55';
  const faintCls = isMe ? 'text-white/60' : 'text-on-surface/40';
  const accentCls = isMe ? 'text-white' : 'text-on-surface';

  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full max-w-[280px] overflow-hidden text-left active:scale-[0.985] transition-transform',
        hasTextAbove ? 'rounded-b-2xl' : 'rounded-2xl',
        isMe
          ? cn('bg-primary', hasTextAbove ? '' : 'rounded-br-md')
          : cn('bg-on-surface/[0.06]', hasTextAbove ? '' : 'rounded-bl-md'),
      )}
    >
      {/* Video / gradient preview, 9:16 cropped to 5:3 to keep the
          card vertically compact in a chat thread. */}
      <div className={cn('relative w-full aspect-[5/3] overflow-hidden bg-gradient-to-br', reel.bgGradient || 'from-stone-800 to-stone-900')}>
        {reel.videoUrl && (
          <video
            src={reel.videoUrl}
            poster={reel.posterUrl}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-black/55 text-white text-[10px] font-bold">
          <Film size={10} />
          REEL
        </div>
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2">
          <div className={cn('w-7 h-7 rounded-full ring-2 ring-white/40 flex items-center justify-center text-white text-[10px] font-bold', reel.authorAvatarColor)}>
            {reel.authorInitials}
          </div>
          <span className="text-white text-[12px] font-bold truncate drop-shadow">@{reel.authorUsername}</span>
        </div>
        <div className="absolute right-2 bottom-2 w-9 h-9 rounded-full bg-black/55 flex items-center justify-center text-white">
          <PlayCircle size={20} />
        </div>
      </div>
      {/* Body */}
      <div className="px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 mb-0.5">
          {reel.kind === 'restaurant' ? (
            <MapPin size={11} className={accentCls} />
          ) : (
            <ChefHat size={11} className={accentCls} />
          )}
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', accentCls)}>
            {reel.kind === 'restaurant' ? 'Featured place' : 'Featured recipe'}
          </span>
        </div>
        <p className={cn('text-sm font-bold truncate leading-snug', titleCls)}>{reel.attachedTitle}</p>
        {reel.attachedSubtitle && (
          <p className={cn('text-[11px] truncate', subCls)}>{reel.attachedSubtitle}</p>
        )}
        {reel.caption && (
          <p className={cn('text-[12px] mt-1.5 line-clamp-2 leading-relaxed italic', subCls)}>"{reel.caption}"</p>
        )}
        <div className={cn('flex items-center gap-1 mt-2 text-[10px] font-semibold', faintCls)}>
          <span>Open in Reels</span>
          <ChevronRight size={10} />
        </div>
      </div>
    </button>
  );
};

/* ── Post Share Card (iMessage-style rich preview) ── */
const PostShareCard: React.FC<{
  post: SharedPost;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ post, isMe, hasTextAbove, onClick }) => {
  const titleCls = isMe ? 'text-white' : 'text-on-surface';
  const subCls = isMe ? 'text-white/75' : 'text-on-surface/55';
  const faintCls = isMe ? 'text-white/60' : 'text-on-surface/40';
  const accentCls = isMe ? 'text-white' : 'text-on-surface';

  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-full max-w-[280px] overflow-hidden text-left active:scale-[0.985] transition-transform',
        hasTextAbove ? 'rounded-b-2xl' : 'rounded-2xl',
        isMe
          ? cn('bg-primary', hasTextAbove ? '' : 'rounded-br-md')
          : cn('bg-on-surface/[0.06]', hasTextAbove ? '' : 'rounded-bl-md'),
      )}
    >
      <div className={cn('relative w-full aspect-[5/3] overflow-hidden bg-gradient-to-br', post.bgGradient || 'from-stone-800 to-stone-900')}>
        {post.coverUrl && post.coverMediaType === 'video' && (
          <video src={post.coverUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
        )}
        {post.coverUrl && post.coverMediaType === 'photo' && (
          <img src={post.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-black/55 text-white text-[10px] font-bold">
          POST
        </div>
        {post.itemCount > 1 && (
          <div className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-black/55 text-white text-[10px] font-bold">
            {post.itemCount} items
          </div>
        )}
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2">
          <div className={cn('w-7 h-7 rounded-full ring-2 ring-white/40 flex items-center justify-center text-white text-[10px] font-bold', post.authorAvatarColor)}>
            {post.authorInitials}
          </div>
          <span className="text-white text-[12px] font-bold truncate drop-shadow">@{post.authorUsername}</span>
        </div>
      </div>
      <div className="px-3.5 py-2.5">
        {post.locationLabel && (
          <div className={cn('flex items-center gap-1 mb-0.5', accentCls)}>
            <MapPin size={11} />
            <span className="text-[11px] font-bold truncate">{post.locationLabel}</span>
          </div>
        )}
        {post.caption && (
          <p className={cn('text-[13px] leading-snug line-clamp-2 italic', titleCls)}>"{post.caption}"</p>
        )}
        {!post.caption && !post.locationLabel && (
          <p className={cn('text-[12px]', subCls)}>{post.itemCount} {post.itemCount === 1 ? 'photo or video' : 'photos and videos'}</p>
        )}
        <div className={cn('flex items-center gap-1 mt-2 text-[10px] font-semibold', faintCls)}>
          <span>Open in feed</span>
          <ChevronRight size={10} />
        </div>
      </div>
    </button>
  );
};

/* ── Share Restaurant Sheet ── */
const ShareRestaurantSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onShare: (restaurant: SharedRestaurant) => void;
}> = ({ open, onClose, onShare }) => {
  const { ratings } = useLists();
  const { phoneMode } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRatings = useMemo(() => {
    if (!searchQuery.trim()) return ratings;
    const q = searchQuery.toLowerCase();
    return ratings.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q));
  }, [ratings, searchQuery]);

  const handleShareReview = (rating: RestaurantRating) => {
    onShare({
      restaurantId: rating.restaurantId,
      name: rating.name,
      image: rating.image,
      cuisine: rating.cuisine,
      price: rating.price,
      address: rating.address,
      score: rating.score,
      notes: rating.notes,
      wouldReturn: rating.wouldReturn,
      tags: rating.tags,
      isReview: true,
    });
    onClose();
  };

  const handleShareRestaurant = (rating: RestaurantRating) => {
    onShare({
      restaurantId: rating.restaurantId,
      name: rating.name,
      image: rating.image,
      cuisine: rating.cuisine,
      price: rating.price,
      address: rating.address,
      isReview: false,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[80]" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={cn("fixed bottom-0 left-0 right-0 z-[80] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
              phoneMode ? "max-h-[85vh]" : "max-h-[70vh]")}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">Share Restaurant</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            <div className="px-5 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your rated restaurants..."
                  className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {filteredRatings.length === 0 ? (
                <div className="text-center py-12">
                  <Star size={28} className="mx-auto text-on-surface/15 mb-2" />
                  <p className="text-sm text-on-surface/35">{searchQuery ? 'No matches found' : 'No rated restaurants yet'}</p>
                </div>
              ) : (
                <div className="space-y-2 pt-2">
                  {filteredRatings.map((r) => {
                    return (
                      <div key={r.restaurantId} className="flex items-center gap-3 p-2.5 rounded-xl border border-on-surface/8 hover:border-on-surface/15 transition-all">
                        {r.image ? (
                          <img src={r.image} alt={r.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-on-surface/5 flex items-center justify-center flex-shrink-0">
                            <MapPin size={16} className="text-on-surface/25" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-on-surface/80 truncate">{r.name}</p>
                          <p className="text-[11px] text-on-surface/40">{r.cuisine} · {r.price}</p>
                        </div>
                        <span className={cn("text-sm font-serif font-bold tabular-nums mr-1", scoreColor(r.score))}>{r.score.toFixed(1)}</span>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button onClick={() => handleShareReview(r)}
                            className="px-2.5 py-1 bg-primary text-white text-[10px] font-semibold rounded-lg hover:bg-primary/90 transition-colors">
                            Review
                          </button>
                          <button onClick={() => handleShareRestaurant(r)}
                            className="px-2.5 py-1 bg-on-surface/5 text-on-surface/50 text-[10px] font-semibold rounded-lg hover:bg-on-surface/10 transition-colors">
                            Details
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── New Chat Sheet ── */
const NewChatSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreateChat: (participantIds: string[], name?: string) => void;
  friends: { id: string; name: string; username?: string }[];
}> = ({ open, onClose, onCreateChat, friends }) => {
  const { phoneMode } = useSettings();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (open) {
      setMode('direct');
      setSelectedFriends([]);
      setGroupName('');
      setSearchQuery('');
    }
  }, [open]);

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter((f) => f.name.toLowerCase().includes(q) || (f.username?.toLowerCase().includes(q)));
  }, [friends, searchQuery]);

  const toggleFriend = (id: string) => {
    if (mode === 'direct') {
      onCreateChat([id]);
      onClose();
      return;
    }
    setSelectedFriends((prev) => prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]);
  };

  const handleCreateGroup = () => {
    if (selectedFriends.length < 2) return;
    onCreateChat(selectedFriends, groupName.trim() || undefined);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70]" onClick={onClose} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={cn("fixed bottom-0 left-0 right-0 z-[70] bg-surface rounded-t-3xl flex flex-col overflow-hidden",
              phoneMode ? "max-h-[85vh]" : "max-h-[70vh]")}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">New Chat</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-2 px-5 pt-3 pb-2 flex-shrink-0">
              <button onClick={() => { setMode('direct'); setSelectedFriends([]); }}
                className={cn("flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all",
                  mode === 'direct' ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>
                Direct Message
              </button>
              <button onClick={() => setMode('group')}
                className={cn("flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all",
                  mode === 'group' ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>
                <Users size={12} className="inline mr-1" />Group Chat
              </button>
            </div>

            {mode === 'group' && (
              <div className="px-5 pt-2 pb-2 flex-shrink-0">
                <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name (optional)"
                  className="w-full bg-on-surface/5 rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                {selectedFriends.length > 0 && (
                  <p className="text-[11px] text-primary font-semibold mt-1.5">{selectedFriends.length} selected</p>
                )}
              </div>
            )}

            {/* Search */}
            <div className="px-5 pt-1 pb-2 flex-shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search friends..."
                  className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {filteredFriends.length === 0 ? (
                <div className="text-center py-12">
                  <Users size={28} className="mx-auto text-on-surface/15 mb-2" />
                  <p className="text-sm text-on-surface/35">{searchQuery ? 'No matches' : 'No friends yet'}</p>
                  <p className="text-xs text-on-surface/25 mt-1">Add friends from your Circle page</p>
                </div>
              ) : (
                filteredFriends.map((friend) => {
                  const selected = selectedFriends.includes(friend.id);
                  return (
                    <button key={friend.id} onClick={() => toggleFriend(friend.id)}
                      className={cn("w-full flex items-center gap-3 px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                        selected ? "bg-primary/3" : "hover:bg-on-surface/3")}>
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-primary">{friend.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-semibold truncate", selected ? "text-primary" : "text-on-surface/70")}>{friend.name}</p>
                        {friend.username && <p className="text-[11px] text-on-surface/35">@{friend.username}</p>}
                      </div>
                      {mode === 'group' && (
                        <div className={cn("w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0",
                          selected ? "bg-primary border-primary text-white" : "border-on-surface/20")}>
                          {selected && <Check size={12} strokeWidth={3} />}
                        </div>
                      )}
                      {mode === 'direct' && <ChevronRight size={14} className="text-on-surface/20" />}
                    </button>
                  );
                })
              )}
            </div>

            {mode === 'group' && selectedFriends.length >= 2 && (
              <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                <button onClick={handleCreateGroup}
                  className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                  Create Group ({selectedFriends.length} members)
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── Read-receipt helpers ── */
type ReceiptStatus = 'sent' | 'delivered' | 'read';

// TODO(backend): replace with real per-message delivery/read status from Supabase
// realtime message_receipts table or presence. For now every outgoing message is
// reported as "sent" so the progression UI is ready without lying about state.
const getReceiptStatus = (_messageId: string): ReceiptStatus => 'sent';

const MessageReceipt: React.FC<{ status: ReceiptStatus }> = ({ status }) => {
  const label = status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent';
  const tone = status === 'read' ? 'text-primary' : 'text-on-surface/35';
  return (
    <div className={cn("flex items-center gap-1 mt-1 px-1", tone)}>
      {status === 'sent'
        ? <Check size={11} className="stroke-[2.5]" />
        : <CheckCheck size={12} className="stroke-[2.5]" />
      }
      <span className="text-[11px] font-medium">{label}</span>
    </div>
  );
};

/* ── Typing Indicator (animated three-dot bubble) ── */
const TypingIndicator: React.FC = () => (
  <div className="flex justify-start">
    <div className="bg-on-surface/[0.06] rounded-2xl rounded-bl-md px-3.5 py-2.5">
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-on-surface/45 animate-pulse [animation-duration:1.2s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-on-surface/45 animate-pulse [animation-duration:1.2s] [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-on-surface/45 animate-pulse [animation-duration:1.2s] [animation-delay:300ms]" />
      </div>
    </div>
  </div>
);

/* ── Chat View (individual conversation) ── */
const ChatView: React.FC<{
  conversation: Conversation;
  profiles: Record<string, UserProfile>;
  onBack: () => void;
}> = ({ conversation, profiles, onBack }) => {
  const { sendMessage, markRead, deleteConversation, renameConversation } = useChat();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingShare, setPendingShare] = useState<SharedRestaurant | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group-chat rename banner state
  const isUnnamedGroup = conversation.isGroup && (!conversation.name || conversation.name === 'Group Chat');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // TODO(backend): replace with real typing presence from Supabase realtime or pusher.
  // For now we keep the local state wired up so the component is ready.
  const [isOtherTyping] = useState(false);

  useEffect(() => {
    markRead(conversation.id);
  }, [conversation.id, conversation.messages.length, markRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation.messages.length, isOtherTyping]);

  // Index of the last message sent by the current user (for read receipts)
  const lastSentIndex = useMemo(() => {
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      if (conversation.messages[i].senderId === user?.id) return i;
    }
    return -1;
  }, [conversation.messages, user?.id]);

  const handleSaveGroupName = () => {
    const trimmed = groupNameDraft.trim();
    if (!trimmed) { setBannerDismissed(true); return; }
    renameConversation(conversation.id, trimmed);
    setGroupNameDraft('');
  };

  const handleSend = () => {
    if (!text.trim() && !pendingShare) return;
    sendMessage(conversation.id, text.trim(), pendingShare || undefined);
    setText('');
    setPendingShare(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleShareRestaurant = (restaurant: SharedRestaurant) => {
    setPendingShare(restaurant);
    setShareSheetOpen(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleRestaurantClick = (restaurant: SharedRestaurant) => {
    navigate(`/restaurant/${restaurant.restaurantId}`);
  };

  const getConversationTitle = () => {
    if (conversation.name) return conversation.name;
    const otherIds = conversation.participantIds.filter((id) => id !== user?.id);
    return otherIds.map((id) => profiles[id]?.display_name || profiles[id]?.username || 'Unknown').join(', ');
  };

  const getParticipantName = (senderId: string) => {
    if (senderId === user?.id) return 'You';
    return profiles[senderId]?.display_name || profiles[senderId]?.username || 'Unknown';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 bg-surface/70 backdrop-blur-md">
        <button onClick={onBack} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          {conversation.isGroup
            ? <Users size={16} className="text-primary" />
            : <span className="text-sm font-bold text-primary">{getConversationTitle().charAt(0).toUpperCase()}</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif font-bold text-base truncate">{getConversationTitle()}</h2>
          {conversation.isGroup && (
            <p className="text-[10px] text-on-surface/35">{conversation.participantIds.length} members</p>
          )}
        </div>
        <button onClick={() => setConfirmDelete(true)}
          className="p-2 text-on-surface/30 hover:text-red-400 transition-colors">
          <Trash2 size={16} />
        </button>
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden flex-shrink-0">
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-red-600 font-medium">Delete this conversation?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg">Cancel</button>
                <button onClick={() => { deleteConversation(conversation.id); onBack(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg">Delete</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Group-chat naming banner (unnamed group chats only) */}
      <AnimatePresence>
        {isUnnamedGroup && !bannerDismissed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
          >
            <div className="bg-primary/[0.04] border-b border-primary/15 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Users size={13} className="text-primary flex-shrink-0" />
                  <p className="text-[12px] font-semibold text-primary/90 flex-shrink-0">Name this group</p>
                  <input
                    type="text"
                    value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveGroupName(); } }}
                    placeholder="e.g. Weekend brunch crew"
                    maxLength={40}
                    className="flex-1 min-w-0 bg-transparent text-[13px] font-medium text-on-surface placeholder:text-on-surface/30 focus:outline-none"
                  />
                </div>
                {groupNameDraft.trim() ? (
                  <button
                    onClick={handleSaveGroupName}
                    className="px-3 h-7 text-[11px] font-bold text-white bg-primary rounded-full flex-shrink-0 active:scale-95 transition-transform"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    onClick={() => setBannerDismissed(true)}
                    className="p-1 text-primary/50 hover:text-primary/80 transition-colors flex-shrink-0"
                    aria-label="Dismiss"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
        {conversation.messages.length === 0 && (
          <div className="text-center py-16">
            <MessageCircle size={32} className="mx-auto text-on-surface/12 mb-3" />
            <p className="text-sm text-on-surface/30">No messages yet</p>
            <p className="text-xs text-on-surface/20 mt-1">Send a message to start the conversation</p>
          </div>
        )}
        {conversation.messages.map((msg, idx) => {
          const isMe = msg.senderId === user?.id;
          const showSender = conversation.isGroup && !isMe;
          const prevMsg = idx > 0 ? conversation.messages[idx - 1] : null;
          const showTimestamp = !prevMsg || (msg.timestamp - prevMsg.timestamp) > 300000; // 5 min gap
          const hasShared = !!(msg.sharedRestaurant || msg.sharedRecipe || msg.sharedReel || msg.sharedPost);
          const hasText = !!msg.text;
          const isLastSent = idx === lastSentIndex;

          return (
            <React.Fragment key={msg.id}>
              {showTimestamp && (
                <div className="text-center py-2">
                  <span className="text-[10px] text-on-surface/25 font-medium">
                    {new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at{' '}
                    {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              )}
              <div className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] flex flex-col", isMe ? "items-end" : "items-start")}>
                  {showSender && (
                    <p className="text-[10px] font-semibold text-on-surface/40 mb-0.5 px-1">{getParticipantName(msg.senderId)}</p>
                  )}
                  {hasShared ? (
                    <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                      {hasText && (
                        <div className={cn(
                          "px-3.5 py-2 text-sm leading-relaxed rounded-2xl mb-1",
                          isMe
                            ? "bg-primary text-white rounded-br-md"
                            : "bg-on-surface/[0.06] text-on-surface rounded-bl-md"
                        )}>
                          {msg.text}
                        </div>
                      )}
                      {msg.sharedRestaurant && (
                        <RestaurantShareCard
                          restaurant={msg.sharedRestaurant}
                          isMe={isMe}
                          hasTextAbove={false}
                          onClick={() => handleRestaurantClick(msg.sharedRestaurant!)}
                        />
                      )}
                      {msg.sharedRecipe && (
                        <RecipeShareCard
                          recipe={msg.sharedRecipe}
                          isMe={isMe}
                          hasTextAbove={false}
                          onClick={() => navigate(`/meal/${msg.sharedRecipe!.authorId}/${msg.sharedRecipe!.mealId}`)}
                        />
                      )}
                      {msg.sharedReel && (
                        <ReelShareCard
                          reel={msg.sharedReel}
                          isMe={isMe}
                          hasTextAbove={false}
                          onClick={() => navigate(`/reels?kind=${msg.sharedReel!.kind}`)}
                        />
                      )}
                      {msg.sharedPost && (
                        <PostShareCard
                          post={msg.sharedPost}
                          isMe={isMe}
                          hasTextAbove={false}
                          onClick={() => navigate('/reels')}
                        />
                      )}
                    </div>
                  ) : (
                    <div className={cn("px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                      isMe
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-on-surface/[0.06] text-on-surface rounded-bl-md"
                    )}>
                      {msg.text}
                    </div>
                  )}
                  {/* Read receipt under the last sent message */}
                  {isMe && isLastSent && (
                    <MessageReceipt status={getReceiptStatus(msg.id)} />
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {/* Typing indicator (other participant) */}
        {isOtherTyping && <TypingIndicator />}
      </div>

      {/* Pending share preview */}
      <AnimatePresence>
        {pendingShare && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden flex-shrink-0 border-t border-on-surface/6 bg-on-surface/[0.02]"
          >
            <div className="px-4 pt-3 pb-2 flex items-start gap-3">
              <div className="flex-1 min-w-0 flex items-start gap-2.5 bg-white rounded-xl border border-on-surface/10 p-2.5 shadow-sm">
                {pendingShare.image && (
                  <img src={pendingShare.image} alt={pendingShare.name} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-on-surface/80 truncate">{pendingShare.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {pendingShare.cuisine && <span className="text-[10px] text-on-surface/40">{pendingShare.cuisine}</span>}
                    {pendingShare.price && <span className="text-[10px] text-on-surface/30">{pendingShare.price}</span>}
                    {pendingShare.isReview && pendingShare.score !== undefined && (
                      <span className={cn("text-[10px] font-bold", scoreColor(pendingShare.score))}>
                        {pendingShare.score.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-semibold text-primary mt-0.5 inline-block">
                    {pendingShare.isReview ? 'Review' : 'Details'}
                  </span>
                </div>
              </div>
              <button onClick={() => setPendingShare(null)}
                className="p-1.5 text-on-surface/30 hover:text-on-surface/60 hover:bg-on-surface/5 rounded-full transition-colors flex-shrink-0 mt-1">
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-on-surface/6 bg-surface flex-shrink-0">
        <button onClick={() => setShareSheetOpen(true)}
          className="p-2.5 text-on-surface/35 hover:text-primary hover:bg-primary/5 rounded-full transition-all flex-shrink-0"
          title="Share restaurant">
          <Share2 size={18} />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={pendingShare ? "Add a message..." : "Type a message..."}
          className="flex-1 bg-on-surface/5 rounded-2xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button onClick={handleSend} disabled={!text.trim() && !pendingShare}
          className="p-2.5 bg-primary text-white rounded-full disabled:opacity-30 transition-opacity flex-shrink-0 active:scale-95">
          <Send size={16} />
        </button>
      </div>

      <ShareRestaurantSheet open={shareSheetOpen} onClose={() => setShareSheetOpen(false)} onShare={handleShareRestaurant} />
    </div>
  );
};

/* ── Main Messages Page ── */
export const Messages: React.FC = () => {
  const { conversations, createConversation, findDirectConversation, getUnreadForConversation } = useChat();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const navigate = useNavigate();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [friends, setFriends] = useState<{ id: string; name: string; username?: string }[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});

  // Load friends
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const fl = await getFriends(user.id);
      if (fl.length > 0) {
        const profs = await getProfilesByIds(fl.map((f) => f.friend_id));
        setProfiles(profs);
        setFriends(fl.map((f) => ({
          id: f.friend_id,
          name: profs[f.friend_id]?.display_name || profs[f.friend_id]?.username || f.friend_id.slice(0, 8),
          username: profs[f.friend_id]?.username,
        })));
      }
    })();
  }, [user?.id]);

  // Also load profiles for all conversation participants
  useEffect(() => {
    const allIds = new Set<string>();
    conversations.forEach((c) => c.participantIds.forEach((id) => allIds.add(id)));
    const missing = Array.from(allIds).filter((id) => !profiles[id]);
    if (missing.length > 0) {
      getProfilesByIds(missing).then((profs) => {
        setProfiles((prev) => ({ ...prev, ...profs }));
      });
    }
  }, [conversations]);

  const handleCreateChat = (participantIds: string[], name?: string) => {
    // For direct messages, reuse existing conversation if it exists
    if (!name && participantIds.length === 1) {
      const existing = findDirectConversation(participantIds[0]);
      if (existing) {
        setActiveConversationId(existing.id);
        return;
      }
    }
    const conv = createConversation(participantIds, name);
    setActiveConversationId(conv.id);
  };

  const sortedConversations = useMemo(() =>
    [...conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [conversations]
  );

  const activeConversation = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;

  const getConversationTitle = (conv: Conversation) => {
    if (conv.name) return conv.name;
    const otherIds = conv.participantIds.filter((id) => id !== user?.id);
    return otherIds.map((id) => profiles[id]?.display_name || profiles[id]?.username || 'Unknown').join(', ');
  };

  const getConversationAvatar = (conv: Conversation) => {
    if (conv.isGroup) return <Users size={16} className="text-primary" />;
    const title = getConversationTitle(conv);
    return <span className="text-sm font-bold text-primary">{title.charAt(0).toUpperCase()}</span>;
  };

  const getLastMessage = (conv: Conversation): string => {
    if (conv.messages.length === 0) return 'No messages yet';
    const last = conv.messages[conv.messages.length - 1];
    if (last.sharedRestaurant) {
      const prefix = last.senderId === user?.id ? 'You' : (profiles[last.senderId]?.display_name || 'Someone');
      return `${prefix} shared ${last.sharedRestaurant.name}`;
    }
    if (last.sharedRecipe) {
      const prefix = last.senderId === user?.id ? 'You' : (profiles[last.senderId]?.display_name || 'Someone');
      return `${prefix} shared a recipe: ${last.sharedRecipe.name}`;
    }
    if (last.sharedReel) {
      const prefix = last.senderId === user?.id ? 'You' : (profiles[last.senderId]?.display_name || 'Someone');
      return `${prefix} shared a reel${last.sharedReel.attachedTitle ? `: ${last.sharedReel.attachedTitle}` : ''}`;
    }
    if (last.sharedPost) {
      const prefix = last.senderId === user?.id ? 'You' : (profiles[last.senderId]?.display_name || 'Someone');
      return `${prefix} shared a post by @${last.sharedPost.authorUsername}`;
    }
    const prefix = last.senderId === user?.id ? 'You: ' : '';
    return prefix + last.text;
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // If viewing a conversation, show the chat view
  if (activeConversation) {
    return (
      <div className="h-screen flex flex-col bg-surface">
        <ChatView
          conversation={activeConversation}
          profiles={profiles}
          onBack={() => setActiveConversationId(null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface pb-32">
      {/* Header */}
      <header className="sticky top-0 w-full px-5 py-4 flex items-center justify-between bg-surface/80 backdrop-blur-md z-40">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-serif font-bold tracking-tight">Messages</h1>
        </div>
        <button onClick={() => setNewChatOpen(true)}
          className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors">
          <Plus size={22} />
        </button>
      </header>

      {/* Conversation list */}
      <div className="px-3">
        {sortedConversations.length === 0 ? (
          <div className="text-center py-20">
            <MessageCircle size={40} className="mx-auto text-on-surface/12 mb-4" />
            <p className="text-base font-semibold text-on-surface/35">No conversations yet</p>
            <p className="text-xs text-on-surface/25 mt-1">Start chatting with your friends</p>
            <button onClick={() => setNewChatOpen(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary/90 transition-colors">
              <Plus size={16} />New Chat
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedConversations.map((conv) => {
              const unread = getUnreadForConversation(conv.id);
              return (
                <button key={conv.id} onClick={() => setActiveConversationId(conv.id)}
                  className="w-full flex items-center gap-3 px-3 py-3.5 rounded-2xl hover:bg-on-surface/3 transition-colors text-left">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {getConversationAvatar(conv)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("text-[15px] font-semibold truncate", unread > 0 ? "text-on-surface" : "text-on-surface/75")}>{getConversationTitle(conv)}</p>
                      <span className={cn("text-[11px] flex-shrink-0", unread > 0 ? "text-primary font-semibold" : "text-on-surface/35")}>{formatTime(conv.lastMessageAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className={cn("text-[13px] truncate leading-snug", unread > 0 ? "text-on-surface/70 font-medium" : "text-on-surface/40")}>{getLastMessage(conv)}</p>
                      {unread > 0 && (
                        <span className="min-w-[20px] h-[20px] px-1.5 bg-primary text-white text-[11px] font-bold rounded-full flex items-center justify-center flex-shrink-0 shadow-sm shadow-primary/25">
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} onCreateChat={handleCreateChat} friends={friends} />
    </div>
  );
};
