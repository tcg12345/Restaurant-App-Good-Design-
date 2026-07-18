import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Send, Search, X, Users, Check, CheckCheck, MessageCircle, ChevronRight, Star, MapPin, Trash2, ChefHat, Clock, Film, PlayCircle, Info, Store, AlertCircle } from 'lucide-react';
import { cn, firstFrameSrc } from '../lib/utils';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { scoreColor } from '../lib/score';
import { ScoreBadge } from '../components/ScoreBadge';
import { useChat, type Conversation, type SharedRestaurant, type SharedRecipe, type SharedReel, type SharedPost } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import { getFriends, getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { useBottomSheet } from '../lib/useBottomSheet';
import { pickAvatarColor, initialsFor } from '../lib/avatar';
import { ShareRestaurantPicker } from '../components/messages/ShareRestaurantPicker';
import { ShareRecipePicker } from '../components/messages/ShareRecipePicker';

/* ── Shared display helpers (used by both panes) ── */

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function otherParticipantId(conv: Conversation, selfId?: string): string | undefined {
  return conv.participantIds.find((id) => id !== selfId);
}

function conversationTitle(conv: Conversation, profiles: Record<string, UserProfile>, selfId?: string): string {
  if (conv.name) return conv.name;
  const others = conv.participantIds.filter((id) => id !== selfId);
  return others.map((id) => profiles[id]?.display_name || profiles[id]?.username || 'Unknown').join(', ');
}

function lastMessagePreview(conv: Conversation, profiles: Record<string, UserProfile>, selfId?: string): string {
  if (conv.messages.length === 0) return 'No messages yet';
  const last = conv.messages[conv.messages.length - 1];
  const who = last.senderId === selfId ? 'You' : (profiles[last.senderId]?.display_name?.split(' ')[0] || 'Someone');
  if (last.sharedRestaurant) return `${who} shared ${last.sharedRestaurant.name}`;
  if (last.sharedRecipe) return `${who} shared a recipe: ${last.sharedRecipe.name}`;
  if (last.sharedReel) return `${who} shared a reel${last.sharedReel.attachedTitle ? `: ${last.sharedReel.attachedTitle}` : ''}`;
  if (last.sharedPost) return `${who} shared a post`;
  if (last.sharedGuide) return `${who} shared a guide: ${last.sharedGuide.title}`;
  return (last.senderId === selfId ? 'You: ' : '') + last.text;
}

function lastMessageIsShare(conv: Conversation): boolean {
  const last = conv.messages[conv.messages.length - 1];
  return !!last && !!(last.sharedRestaurant || last.sharedRecipe || last.sharedReel || last.sharedPost || last.sharedGuide);
}

/** Small round avatar — solid color + initials, with an optional verified badge. */
const PersonAvatar: React.FC<{ name: string; userId: string; size?: number; expert?: boolean }> = ({ name, userId, size = 48, expert }) => (
  <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
    <div
      className={cn('w-full h-full rounded-full grid place-items-center text-white font-bold', pickAvatarColor(userId))}
      style={{ fontSize: Math.round(size * 0.36) }}
    >
      {initialsFor(name)}
    </div>
    {expert && (
      <span className="absolute -top-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-surface grid place-items-center ring-1 ring-surface" title="Verified">
        <VerifiedBadge size={15} />
      </span>
    )}
  </div>
);

/* ── Restaurant Share Card (iMessage-style rich preview) ── */
const RestaurantShareCard: React.FC<{
  restaurant: SharedRestaurant;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ restaurant, isMe, hasTextAbove, onClick }) => {
  // Color tokens adapt to bubble side
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
          {restaurant.isReview && restaurant.score !== undefined && restaurant.score > 0 && (
            isMe ? (
              <span className="flex-shrink-0 w-9 h-9 rounded-full border border-white/30 bg-white/15 text-white flex items-center justify-center font-bold text-sm tabular-nums">
                {restaurant.score.toFixed(1)}
              </span>
            ) : (
              <ScoreBadge rating={restaurant.score} size="sm" />
            )
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
          <video src={firstFrameSrc(post.coverUrl)} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
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
  const { dragProps } = useBottomSheet(open, onClose);

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
            {...dragProps}
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

            <div className="flex-1 overflow-y-auto px-5 pb-safe-5">
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
                        <span className="mr-1"><ScoreBadge rating={r.score} size="xs" /></span>
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
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-[70]',
            phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                  transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                }
              : {
                  initial: { opacity: 0, scale: 0.94, y: -12 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.96, y: -8 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'bg-surface flex flex-col overflow-hidden',
              phoneMode
                ? 'fixed inset-0'
                : 'w-full max-w-2xl rounded-[28px] max-h-[70vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            <div className={cn(
              'flex items-start justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-safe-4 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4',
            )}>
              <div>
                <h3 className={cn('font-serif font-bold', phoneMode ? 'text-[22px]' : 'text-[20px]')}>New message</h3>
                {phoneMode && <p className="text-[13px] text-on-surface/55 mt-0.5">Pick a friend to start a thread.</p>}
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors flex-shrink-0">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}

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

            <div className="flex-1 overflow-y-auto px-5 pb-safe-5">
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
                        selected ? "bg-primary/3" : "hover:bg-on-surface/3 active:bg-on-surface/[0.05]")}>
                      <PersonAvatar name={friend.name} userId={friend.id} size={44} />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-[15px] font-semibold truncate", selected ? "text-primary" : "text-on-surface")}>{friend.name}</p>
                        {friend.username && <p className="text-[12px] text-on-surface/45">@{friend.username}</p>}
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
              <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                <button onClick={handleCreateGroup}
                  className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                  Create Group ({selectedFriends.length} members)
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Read-receipt helpers ── */
type ReceiptStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// Delivery status comes from the message itself now: ChatContext awaits
// each insert and marks 'sent'/'failed' (older messages loaded from the
// server carry no status — they're delivered by definition).
// TODO(backend): 'delivered'/'read' still need a receipts table/presence.
const getReceiptStatus = (msg: { status?: 'sending' | 'sent' | 'failed' }): ReceiptStatus => msg.status ?? 'sent';

const MessageReceipt: React.FC<{ status: ReceiptStatus; onRetry?: () => void }> = ({ status, onRetry }) => {
  if (status === 'failed') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 mt-1 px-1 text-red-500 text-[11px] font-semibold"
      >
        <AlertCircle size={11} className="stroke-[2.5]" />
        Not sent — tap to retry
      </button>
    );
  }
  if (status === 'sending') {
    return (
      <div className="flex items-center gap-1 mt-1 px-1 text-on-surface/35">
        <Clock size={11} className="stroke-[2.5]" />
        <span className="text-[10px] font-medium">Sending…</span>
      </div>
    );
  }
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
  conversation?: Conversation | null;
  /** When set (and no `conversation`), a not-yet-created 1:1 draft with this
   *  friend; the thread is persisted on the first send/share. */
  draftFriendId?: string;
  profiles: Record<string, UserProfile>;
  onBack: () => void;
  onConversationCreated?: (id: string) => void;
}> = ({ conversation, draftFriendId, profiles, onBack, onConversationCreated }) => {
  const { sendMessage, markRead, retryMessage, deleteConversation, renameConversation, getOrCreateDirectConversation } = useChat();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [restPickerOpen, setRestPickerOpen] = useState(false);     // share-a-restaurant picker
  const [recipePickerOpen, setRecipePickerOpen] = useState(false); // share-a-recipe picker
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingShare, setPendingShare] = useState<SharedRestaurant | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Normalized view of either a real conversation or a draft friend.
  const convId = conversation?.id ?? null;
  const isGroup = conversation?.isGroup ?? false;
  const messages = conversation?.messages ?? [];
  const otherId = conversation ? otherParticipantId(conversation, user?.id) : draftFriendId;
  const otherProfile = otherId ? profiles[otherId] : undefined;
  const title = conversation
    ? conversationTitle(conversation, profiles, user?.id)
    : (otherProfile?.display_name || otherProfile?.username || 'New message');
  const handle = otherProfile?.username ? `@${otherProfile.username}` : '';
  const expert = !!otherProfile?.is_verified;
  const selfName = (user?.id && profiles[user.id]?.display_name) || user?.email?.split('@')[0] || 'You';

  // Group-chat rename banner state
  const isUnnamedGroup = isGroup && (!conversation?.name || conversation?.name === 'Group Chat');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // TODO(backend): typing presence isn't tracked yet.
  const [isOtherTyping] = useState(false);

  useEffect(() => {
    if (!convId) return;
    // Only mark read while the tab is actually VISIBLE — messages arriving
    // while the thread sits open in a backgrounded tab aren't read, and
    // eagerly stamping them cleared unread badges on other devices too.
    const mark = () => { if (document.visibilityState === 'visible') markRead(convId); };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [convId, messages.length, markRead]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, isOtherTyping]);

  // Index of the last message sent by the current user (for read receipts)
  const lastSentIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].senderId === user?.id) return i;
    }
    return -1;
  }, [messages, user?.id]);

  // Resolve the target conversation id, creating the draft thread on demand.
  const ensureConversationId = (): string | null => {
    if (convId) return convId;
    if (!draftFriendId) return null;
    const conv = getOrCreateDirectConversation(draftFriendId);
    onConversationCreated?.(conv.id);
    return conv.id;
  };

  const handleSaveGroupName = () => {
    const trimmed = groupNameDraft.trim();
    if (!trimmed) { setBannerDismissed(true); return; }
    if (convId) renameConversation(convId, trimmed);
    setGroupNameDraft('');
  };

  const handleSend = () => {
    if (!text.trim() && !pendingShare) return;
    const id = ensureConversationId();
    if (!id) return;
    sendMessage(id, text.trim(), pendingShare || undefined);
    setText('');
    setPendingShare(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Desktop pickers: send straight into the (possibly draft) thread.
  const handleShareRestaurantNow = (restaurant: SharedRestaurant) => {
    const id = ensureConversationId();
    if (id) sendMessage(id, '', restaurant);
  };
  const handleShareRecipeNow = (recipe: SharedRecipe) => {
    const id = ensureConversationId();
    if (id) sendMessage(id, '', undefined, recipe);
  };

  const handleRestaurantClick = (restaurant: SharedRestaurant) => {
    navigate(`/restaurant/${restaurant.restaurantId}`);
  };

  const getParticipantName = (senderId: string) => {
    if (senderId === user?.id) return 'You';
    return profiles[senderId]?.display_name || profiles[senderId]?.username || 'Unknown';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={cn(
        'flex items-center gap-3 flex-shrink-0 border-b border-on-surface/[0.06] bg-surface/80 backdrop-blur-md',
        // pt-safe-3 keeps the back arrow / name clear of the status bar &
        // Dynamic Island — the thread view is full-screen on phones.
        phoneMode ? 'px-4 pt-safe-3 pb-3' : 'px-6 py-3.5',
      )}>
        {phoneMode && (
          <button onClick={onBack} className="p-2 -ml-2 text-on-surface/40 hover:text-on-surface transition-colors">
            <ArrowLeft size={20} />
          </button>
        )}
        {isGroup ? (
          <div className={cn('rounded-full bg-primary/10 grid place-items-center flex-shrink-0', phoneMode ? 'w-9 h-9' : 'w-11 h-11')}>
            <Users size={phoneMode ? 16 : 18} className="text-primary" />
          </div>
        ) : (
          <PersonAvatar name={title} userId={otherId || 'unknown'} size={phoneMode ? 36 : 44} expert={expert} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className={cn('font-serif font-bold truncate', phoneMode ? 'text-[17px]' : 'text-[19px]')}>{title}</h2>
            {expert && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/[0.08] text-primary text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
                <VerifiedBadge size={11} /> Verified
              </span>
            )}
          </div>
          {isGroup ? (
            <p className="text-[11px] text-on-surface/40">{conversation?.participantIds.length ?? 0} members</p>
          ) : handle ? (
            <p className="text-[12.5px] text-on-surface/45 truncate">{handle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {!phoneMode && !isGroup && otherProfile?.username && (
            <button onClick={() => navigate(`/user/${otherProfile.username}`)}
              className="w-9 h-9 rounded-full grid place-items-center text-on-surface/45 hover:text-on-surface hover:bg-on-surface/[0.06] transition-colors" title="View profile">
              <Info size={18} />
            </button>
          )}
          {convId && (
            <button onClick={() => setConfirmDelete(true)}
              className="w-9 h-9 rounded-full grid place-items-center text-on-surface/35 hover:text-red-500 hover:bg-red-500/5 transition-colors" title="Delete conversation">
              <Trash2 size={phoneMode ? 16 : 17} />
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden flex-shrink-0">
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-red-600 font-medium">Delete this conversation?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg">Cancel</button>
                <button onClick={() => { if (convId) deleteConversation(convId); onBack(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg">Delete</button>
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
        {messages.length === 0 && (
          <div className="text-center py-16">
            <MessageCircle size={32} className="mx-auto text-on-surface/12 mb-3" />
            <p className="text-sm text-on-surface/30">No messages yet</p>
            <p className="text-xs text-on-surface/20 mt-1">Send a message to start the conversation</p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const isMe = msg.senderId === user?.id;
          const showSender = isGroup && !isMe;
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
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
                          "selectable px-3.5 py-2 text-sm leading-relaxed rounded-2xl mb-1",
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
                          onClick={() => navigate(`/r/reel-${msg.sharedReel!.reelId}`)}
                        />
                      )}
                      {msg.sharedPost && (
                        <PostShareCard
                          post={msg.sharedPost}
                          isMe={isMe}
                          hasTextAbove={false}
                          onClick={() => navigate(`/r/post-${msg.sharedPost!.postId}`)}
                        />
                      )}
                    </div>
                  ) : (
                    <div className={cn("selectable px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                      isMe
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-on-surface/[0.06] text-on-surface rounded-bl-md"
                    )}>
                      {msg.text}
                    </div>
                  )}
                  {/* Receipt under the last sent message; failed/sending
                      messages always show theirs (a buried failure with no
                      affordance would look delivered). */}
                  {isMe && (isLastSent || msg.status === 'failed' || msg.status === 'sending') && (
                    <MessageReceipt
                      status={getReceiptStatus(msg)}
                      onRetry={msg.status === 'failed' && convId ? () => retryMessage(convId, msg.id) : undefined}
                    />
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

      {/* Composer */}
      {phoneMode ? (
        <div className="msg-composer-bar flex flex-col gap-2 px-3 pt-2.5 pb-safe-4 border-t border-on-surface/[0.06] bg-surface flex-shrink-0">
          {/* Share buttons */}
          <div className="flex items-center gap-2">
            <button onClick={() => setRestPickerOpen(true)}
              className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-paper border border-on-surface/10 active:bg-primary/[0.05] active:border-primary/40 transition-colors text-left">
              <span className="w-7 h-7 rounded-lg bg-primary/10 grid place-items-center text-primary flex-shrink-0"><Store size={15} /></span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-on-surface leading-tight">Share restaurant</span>
                <span className="block text-[10.5px] text-on-surface/45 truncate">Yours · full DB</span>
              </span>
            </button>
            <button onClick={() => setRecipePickerOpen(true)}
              className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-paper border border-on-surface/10 active:bg-primary/[0.05] active:border-primary/40 transition-colors text-left">
              <span className="w-7 h-7 rounded-lg bg-primary/10 grid place-items-center text-primary flex-shrink-0"><ChefHat size={15} /></span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-on-surface leading-tight">Share recipe</span>
                <span className="block text-[10.5px] text-on-surface/45 truncate">Yours · 1,200+ recipes</span>
              </span>
            </button>
          </div>
          {/* Input row */}
          <div className="flex items-center gap-1 rounded-full bg-paper border border-on-surface/10 focus-within:border-primary/40 pl-4 pr-1.5 py-1.5">
            <input ref={inputRef} type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={`Message ${(title || '').split(' ')[0] || ''}…`}
              className="flex-1 bg-transparent text-[15px] text-on-surface placeholder:text-on-surface/35 focus:outline-none py-1.5 min-w-0" />
            <button onClick={handleSend} disabled={!text.trim() && !pendingShare}
              className="w-10 h-10 rounded-full bg-primary text-white grid place-items-center disabled:opacity-30 transition-opacity flex-shrink-0 active:scale-95"><Send size={16} /></button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 px-6 pt-3 pb-4 border-t border-on-surface/[0.06] bg-surface flex-shrink-0">
          {/* Share buttons */}
          <div className="flex items-center gap-2.5">
            <button onClick={() => setRestPickerOpen(true)}
              className="flex-1 flex items-center gap-3 h-[52px] px-4 rounded-2xl bg-paper border border-on-surface/10 hover:border-primary/40 hover:bg-primary/[0.03] transition-all text-left group">
              <span className="w-8 h-8 rounded-xl bg-primary/10 grid place-items-center text-primary flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors"><Store size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-on-surface leading-tight">Share a restaurant</span>
                <span className="block text-[11.5px] text-on-surface/45 truncate">Your reviews · the full database</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-on-surface/30 flex-shrink-0" />
            </button>
            <button onClick={() => setRecipePickerOpen(true)}
              className="flex-1 flex items-center gap-3 h-[52px] px-4 rounded-2xl bg-paper border border-on-surface/10 hover:border-primary/40 hover:bg-primary/[0.03] transition-all text-left group">
              <span className="w-8 h-8 rounded-xl bg-primary/10 grid place-items-center text-primary flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors"><ChefHat size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-on-surface leading-tight">Share a recipe</span>
                <span className="block text-[11.5px] text-on-surface/45 truncate">Your cookbook · community recipes</span>
              </span>
              <ChevronRight size={16} className="ml-auto text-on-surface/30 flex-shrink-0" />
            </button>
          </div>
          {/* Input row */}
          <div className="flex items-center gap-1.5 rounded-full bg-paper border border-on-surface/10 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition-all pl-4 pr-1.5 py-1.5">
            <input ref={inputRef} type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={`Message ${(title || '').split(' ')[0] || ''}…`}
              className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface/35 focus:outline-none py-1.5 min-w-0" />
            <button onClick={handleSend} disabled={!text.trim() && !pendingShare}
              className="w-10 h-10 rounded-full bg-primary text-white grid place-items-center disabled:opacity-30 hover:bg-primary/90 transition-all flex-shrink-0 active:scale-95"><Send size={16} /></button>
          </div>
        </div>
      )}

      {/* Share pickers — responsive (centered modal on desktop, full-screen sheet on mobile) */}
      <ShareRestaurantPicker
        open={restPickerOpen}
        recipientName={isGroup ? title : (title || '').split(' ')[0]}
        onClose={() => setRestPickerOpen(false)}
        onShare={handleShareRestaurantNow}
      />
      <ShareRecipePicker
        open={recipePickerOpen}
        recipientName={isGroup ? title : (title || '').split(' ')[0]}
        selfName={selfName}
        onClose={() => setRecipePickerOpen(false)}
        onShare={handleShareRecipeNow}
      />
    </div>
  );
};

/* ── Desktop: conversations + all-friends panel (left pane) ── */
type FriendLite = { id: string; name: string; username?: string };

const ConvRow: React.FC<{
  conv: Conversation;
  profiles: Record<string, UserProfile>;
  selfId?: string;
  active: boolean;
  unread: number;
  onClick: () => void;
}> = ({ conv, profiles, selfId, active, unread, onClick }) => {
  const otherId = otherParticipantId(conv, selfId);
  const fullTitle = conversationTitle(conv, profiles, selfId);
  const display = conv.isGroup ? fullTitle : (fullTitle.split(' ')[0] || fullTitle);
  const expert = !conv.isGroup && otherId ? !!profiles[otherId]?.is_verified : false;
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors',
        active ? 'bg-primary/[0.07]' : 'hover:bg-on-surface/[0.04]',
      )}
    >
      {active && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-primary" />}
      {conv.isGroup ? (
        <div className="w-12 h-12 rounded-full bg-primary/10 grid place-items-center flex-shrink-0"><Users size={18} className="text-primary" /></div>
      ) : (
        <PersonAvatar name={fullTitle} userId={otherId || conv.id} size={48} expert={expert} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-[15px] truncate', unread > 0 ? 'font-bold text-on-surface' : 'font-semibold text-on-surface/85')}>{display}</p>
          <span className={cn('text-[11px] flex-shrink-0', unread > 0 ? 'text-primary font-semibold' : 'text-on-surface/35')}>{formatTime(conv.lastMessageAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn('text-[12.5px] truncate leading-snug flex items-center gap-1', lastMessageIsShare(conv) ? 'text-primary/80 font-medium' : unread > 0 ? 'text-on-surface/70 font-medium' : 'text-on-surface/45')}>
            {lastMessageIsShare(conv) && <Store size={12} className="flex-shrink-0" />}
            <span className="truncate">{lastMessagePreview(conv, profiles, selfId)}</span>
          </p>
          {unread > 0 && (
            <span className="min-w-[20px] h-[20px] px-1.5 bg-primary text-white text-[11px] font-bold rounded-full grid place-items-center flex-shrink-0 shadow-sm shadow-primary/25">{unread}</span>
          )}
        </div>
      </div>
    </button>
  );
};

const FriendRow: React.FC<{ friend: FriendLite; profiles: Record<string, UserProfile>; onClick: () => void }> = ({ friend, profiles, onClick }) => {
  const p = profiles[friend.id];
  const expert = !!p?.is_verified;
  return (
    <button onClick={onClick} className="group w-full flex items-center gap-3 px-4 py-2.5 rounded-2xl text-left hover:bg-on-surface/[0.04] transition-colors">
      <PersonAvatar name={friend.name} userId={friend.id} size={44} expert={expert} />
      <div className="flex-1 min-w-0">
        <p className="text-[14.5px] font-semibold text-on-surface/85 truncate">{friend.name.split(' ')[0] || friend.name}</p>
        <p className="text-[12px] text-on-surface/45 truncate">{friend.username ? `@${friend.username}` : 'Tap to message'}</p>
      </div>
      <span className="flex-shrink-0 text-[11px] font-bold tracking-wide text-primary bg-primary/[0.08] px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">Message</span>
    </button>
  );
};

const ConversationsPanel: React.FC<{
  conversations: Conversation[];
  friends: FriendLite[];
  profiles: Record<string, UserProfile>;
  selfId?: string;
  activeId: string | null;
  draftFriendId: string | null;
  getUnread: (id: string) => number;
  hasThread: (friendId: string) => boolean;
  onSelectConversation: (id: string) => void;
  onSelectFriend: (friendId: string) => void;
  onCompose: () => void;
}> = ({ conversations, friends, profiles, selfId, activeId, draftFriendId, getUnread, hasThread, onSelectConversation, onSelectFriend, onCompose }) => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'unread' | 'shares'>('all');

  const q = query.trim().toLowerCase();
  const matchesConv = (c: Conversation) => {
    if (!q) return true;
    const title = conversationTitle(c, profiles, selfId).toLowerCase();
    const handle = (otherParticipantId(c, selfId) && profiles[otherParticipantId(c, selfId)!]?.username || '').toLowerCase();
    return title.includes(q) || handle.includes(q) || lastMessagePreview(c, profiles, selfId).toLowerCase().includes(q);
  };

  const filteredConvs = useMemo(() => conversations.filter((c) => {
    if (tab === 'unread' && getUnread(c.id) === 0) return false;
    if (tab === 'shares' && !lastMessageIsShare(c)) return false;
    return matchesConv(c);
  }), [conversations, tab, q, profiles, selfId, getUnread]);

  // Friends with no existing thread — the "you don't need a chat to message them" list.
  const friendsWithoutThread = useMemo(() => {
    if (tab !== 'all') return [];
    return friends.filter((f) => !hasThread(f.id) && (!q || f.name.toLowerCase().includes(q) || (f.username || '').toLowerCase().includes(q)));
  }, [friends, tab, q, hasThread]);

  const unreadCount = conversations.filter((c) => getUnread(c.id) > 0).length;
  const sharesCount = conversations.filter(lastMessageIsShare).length;

  const tabs: { key: 'all' | 'unread' | 'shares'; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'shares', label: 'Shares', count: sharesCount },
  ];

  return (
    <aside className="w-[360px] flex-shrink-0 h-screen flex flex-col border-r border-on-surface/[0.07] bg-surface">
      {/* Header */}
      <div className="px-5 pt-6 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="font-serif font-bold text-[28px] tracking-tight">Messages</h1>
          <button onClick={onCompose} className="w-9 h-9 rounded-full grid place-items-center text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.06] transition-colors" title="New message">
            <Plus size={20} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2.5 h-10 px-3.5 rounded-full bg-on-surface/[0.05] border border-on-surface/8 focus-within:border-primary/40 focus-within:bg-paper transition-colors">
          <Search size={15} className="text-on-surface/40 flex-shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search messages and friends"
            className="flex-1 bg-transparent text-[13.5px] text-on-surface placeholder:text-on-surface/40 focus:outline-none min-w-0" />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 flex gap-1 border-b border-on-surface/[0.07] flex-shrink-0">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('relative flex-1 py-2.5 text-[13px] transition-colors', tab === t.key ? 'text-on-surface font-semibold' : 'text-on-surface/50 hover:text-on-surface/75 font-medium')}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/12 text-primary align-[1px]">{t.count}</span>}
            {tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2 min-h-0">
        {filteredConvs.length > 0 && (
          <>
            <SectionHeader label="Conversations" count={filteredConvs.length} />
            {filteredConvs.map((c) => (
              <ConvRow key={c.id} conv={c} profiles={profiles} selfId={selfId} active={c.id === activeId} unread={getUnread(c.id)} onClick={() => onSelectConversation(c.id)} />
            ))}
          </>
        )}

        {friendsWithoutThread.length > 0 && (
          <>
            <SectionHeader label="All friends" count={friendsWithoutThread.length} />
            {friendsWithoutThread.map((f) => (
              <FriendRow key={f.id} friend={f} profiles={profiles} onClick={() => onSelectFriend(f.id)} />
            ))}
          </>
        )}

        {filteredConvs.length === 0 && friendsWithoutThread.length === 0 && (
          <div className="px-4 py-16 text-center">
            <MessageCircle size={32} className="mx-auto text-on-surface/12 mb-3" />
            <p className="text-[14px] font-semibold text-on-surface/40">{q ? `No matches for “${query}”` : tab === 'unread' ? 'No unread messages' : tab === 'shares' ? 'No shared cards yet' : 'No conversations yet'}</p>
          </div>
        )}
      </div>
    </aside>
  );
};

const SectionHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div className="flex items-center justify-between px-3 pt-4 pb-1.5">
    <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-on-surface/40">{label}</span>
    <span className="text-[10.5px] font-semibold text-on-surface/30">{count}</span>
  </div>
);

const DesktopEmptyChat: React.FC<{ onCompose: () => void }> = ({ onCompose }) => (
  <div className="h-full grid place-items-center px-8 text-center">
    <div className="max-w-md flex flex-col items-center gap-4">
      <div className="w-24 h-24 rounded-full border-2 border-dashed border-on-surface/15 bg-on-surface/[0.03] grid place-items-center text-primary">
        <MessageCircle size={38} />
      </div>
      <h2 className="font-serif font-bold text-[30px] tracking-tight">Your messages</h2>
      <p className="text-[14.5px] text-on-surface/55 leading-relaxed">Pick a conversation, or message any friend to start a thread. Share a restaurant or recipe in a single tap.</p>
      <button onClick={onCompose} className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-full hover:bg-primary/90 transition-colors">
        <Plus size={16} /> New message
      </button>
    </div>
  </div>
);

/* ── Mobile list screen (rail + tabs + sections) ── */
const MobileSection: React.FC<{ label: string; count: number }> = ({ label, count }) => (
  <div className="flex items-center justify-between px-5 pt-4 pb-1.5">
    <span className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-on-surface/40">{label}</span>
    <span className="text-[10.5px] font-semibold text-on-surface/30">{count}</span>
  </div>
);

const MobileConvRow: React.FC<{
  conv: Conversation;
  profiles: Record<string, UserProfile>;
  selfId?: string;
  unread: number;
  onClick: () => void;
}> = ({ conv, profiles, selfId, unread, onClick }) => {
  const otherId = otherParticipantId(conv, selfId);
  const fullTitle = conversationTitle(conv, profiles, selfId);
  const display = conv.isGroup ? fullTitle : (fullTitle.split(' ')[0] || fullTitle);
  const expert = !conv.isGroup && otherId ? !!profiles[otherId]?.is_verified : false;
  const share = lastMessageIsShare(conv);
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-on-surface/[0.05] transition-colors">
      {conv.isGroup
        ? <div className="w-[52px] h-[52px] rounded-full bg-primary/10 grid place-items-center flex-shrink-0"><Users size={18} className="text-primary" /></div>
        : <PersonAvatar name={fullTitle} userId={otherId || conv.id} size={52} expert={expert} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-[15.5px] truncate', unread > 0 ? 'font-bold text-on-surface' : 'font-semibold text-on-surface/85')}>{display}</p>
          <span className={cn('text-[11.5px] flex-shrink-0', unread > 0 ? 'text-primary font-semibold' : 'text-on-surface/35')}>{formatTime(conv.lastMessageAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn('text-[13px] truncate leading-snug flex items-center gap-1', share ? 'text-primary/80 font-medium' : unread > 0 ? 'text-on-surface/70 font-medium' : 'text-on-surface/45')}>
            {share && <Store size={12} className="flex-shrink-0" />}
            <span className="truncate">{lastMessagePreview(conv, profiles, selfId)}</span>
          </p>
          {unread > 0 && <span className="min-w-[20px] h-[20px] px-1.5 bg-primary text-white text-[11px] font-bold rounded-full grid place-items-center flex-shrink-0">{unread}</span>}
        </div>
      </div>
    </button>
  );
};

const MobileFriendRow: React.FC<{ friend: FriendLite; expert: boolean; onClick: () => void }> = ({ friend, expert, onClick }) => (
  <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-on-surface/[0.05] transition-colors">
    <PersonAvatar name={friend.name} userId={friend.id} size={48} expert={expert} />
    <div className="flex-1 min-w-0">
      <p className="text-[15px] font-semibold text-on-surface/85 truncate">{friend.name.split(' ')[0]}</p>
      <p className="text-[12.5px] text-on-surface/45 truncate">{friend.username ? `@${friend.username}` : 'Tap to message'}</p>
    </div>
    <span className="flex-shrink-0 text-[11px] font-bold tracking-wide text-primary bg-primary/[0.08] px-3 py-1.5 rounded-full">Message</span>
  </button>
);

const MobileMessageList: React.FC<{
  conversations: Conversation[];
  friends: FriendLite[];
  profiles: Record<string, UserProfile>;
  selfId?: string;
  getUnread: (id: string) => number;
  hasThread: (friendId: string) => boolean;
  onOpenConversation: (id: string) => void;
  onOpenFriend: (friendId: string) => void;
  onCompose: () => void;
  onBack: () => void;
}> = ({ conversations, friends, profiles, selfId, getUnread, hasThread, onOpenConversation, onOpenFriend, onCompose, onBack }) => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'unread' | 'shares'>('all');
  const q = query.trim().toLowerCase();

  const matchesConv = (c: Conversation) => {
    if (!q) return true;
    const title = conversationTitle(c, profiles, selfId).toLowerCase();
    const oid = otherParticipantId(c, selfId);
    const handle = ((oid && profiles[oid]?.username) || '').toLowerCase();
    return title.includes(q) || handle.includes(q) || lastMessagePreview(c, profiles, selfId).toLowerCase().includes(q);
  };
  const filteredConvs = useMemo(() => conversations.filter((c) => {
    if (tab === 'unread' && getUnread(c.id) === 0) return false;
    if (tab === 'shares' && !lastMessageIsShare(c)) return false;
    return matchesConv(c);
  }), [conversations, tab, q, profiles, selfId, getUnread]);

  const friendsWithoutThread = useMemo(() => {
    if (tab !== 'all') return [];
    return friends.filter((f) => !hasThread(f.id) && (!q || f.name.toLowerCase().includes(q) || (f.username || '').toLowerCase().includes(q)));
  }, [friends, tab, q, hasThread]);

  // Rail: friends with a thread first, then the rest.
  const rail = useMemo(() => [...friends.filter((f) => hasThread(f.id)), ...friends.filter((f) => !hasThread(f.id))], [friends, hasThread]);

  const unreadCount = conversations.filter((c) => getUnread(c.id) > 0).length;
  const sharesCount = conversations.filter(lastMessageIsShare).length;
  const tabs: { key: 'all' | 'unread' | 'shares'; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'shares', label: 'Shares', count: sharesCount },
  ];

  return (
    <div className="h-screen flex flex-col bg-surface">
      <header className="flex-shrink-0 px-4 pt-safe-4 pb-2.5 bg-surface/90 backdrop-blur-md border-b border-on-surface/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button onClick={onBack} className="p-1.5 -ml-1.5 text-on-surface/45 active:text-on-surface"><ArrowLeft size={22} /></button>
            <h1 className="font-serif font-bold text-[26px] tracking-tight">Messages</h1>
          </div>
          <button onClick={onCompose} className="w-9 h-9 rounded-full grid place-items-center text-primary active:bg-primary/10" title="New message"><Plus size={22} /></button>
        </div>
        <div className="mt-2.5 flex items-center gap-2.5 h-10 px-3.5 rounded-full bg-on-surface/[0.05] border border-on-surface/8">
          <Search size={15} className="text-on-surface/40 flex-shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search messages and friends" className="flex-1 bg-transparent text-[14px] text-on-surface placeholder:text-on-surface/40 focus:outline-none min-w-0" />
        </div>
        <div className="mt-2.5 flex gap-2">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cn('flex-1 py-2 rounded-full text-[12.5px] font-semibold border transition-colors inline-flex items-center justify-center gap-1.5', tab === t.key ? 'bg-on-surface text-surface border-on-surface' : 'bg-surface text-on-surface/60 border-on-surface/10')}>
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', tab === t.key ? 'bg-surface/25 text-surface' : 'bg-primary/12 text-primary')}>{t.count}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-safe-5">
        {tab === 'all' && !q && rail.length > 0 && (
          <div className="flex gap-3.5 px-4 pt-3.5 pb-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button onClick={onCompose} className="flex flex-col items-center gap-1.5 w-16 flex-shrink-0">
              <span className="w-[58px] h-[58px] rounded-full grid place-items-center bg-surface border-2 border-dashed border-primary text-primary"><Plus size={22} /></span>
              <span className="text-[11.5px] text-on-surface/60 w-16 text-center truncate">New</span>
            </button>
            {rail.map((f) => (
              <button key={f.id} onClick={() => onOpenFriend(f.id)} className="flex flex-col items-center gap-1.5 w-16 flex-shrink-0">
                <PersonAvatar name={f.name} userId={f.id} size={58} expert={!!profiles[f.id]?.is_verified} />
                <span className="text-[11.5px] text-on-surface/70 w-16 text-center truncate">{f.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        )}

        {filteredConvs.length > 0 && (
          <>
            <MobileSection label="Conversations" count={filteredConvs.length} />
            {filteredConvs.map((c) => (
              <MobileConvRow key={c.id} conv={c} profiles={profiles} selfId={selfId} unread={getUnread(c.id)} onClick={() => onOpenConversation(c.id)} />
            ))}
          </>
        )}

        {friendsWithoutThread.length > 0 && (
          <>
            <MobileSection label="All friends" count={friendsWithoutThread.length} />
            {friendsWithoutThread.map((f) => (
              <MobileFriendRow key={f.id} friend={f} expert={!!profiles[f.id]?.is_verified} onClick={() => onOpenFriend(f.id)} />
            ))}
          </>
        )}

        {filteredConvs.length === 0 && friendsWithoutThread.length === 0 && (
          <div className="px-6 py-20 text-center">
            <MessageCircle size={36} className="mx-auto text-on-surface/12 mb-3" />
            <p className="text-[14px] font-semibold text-on-surface/40">{q ? `No matches for “${query}”` : tab === 'unread' ? 'No unread messages' : tab === 'shares' ? 'No shared cards yet' : 'No conversations yet'}</p>
            {!q && tab === 'all' && (
              <button onClick={onCompose} className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-full active:scale-95 transition-transform"><Plus size={16} /> New message</button>
            )}
          </div>
        )}
      </div>
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
  const [draftFriendId, setDraftFriendId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [friends, setFriends] = useState<FriendLite[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});

  // Load friends (and their profiles).
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const fl = await getFriends(user.id);
      if (fl.length > 0) {
        const profs = await getProfilesByIds(fl.map((f) => f.friend_id));
        setProfiles((prev) => ({ ...prev, ...profs }));
        setFriends(fl.map((f) => ({
          id: f.friend_id,
          name: profs[f.friend_id]?.display_name || profs[f.friend_id]?.username || f.friend_id.slice(0, 8),
          username: profs[f.friend_id]?.username,
        })));
      }
    })();
  }, [user?.id]);

  // Load profiles for all conversation participants (and self, for the byline).
  useEffect(() => {
    const allIds = new Set<string>();
    if (user?.id) allIds.add(user.id);
    conversations.forEach((c) => c.participantIds.forEach((id) => allIds.add(id)));
    const missing = Array.from(allIds).filter((id) => !profiles[id]);
    if (missing.length > 0) {
      getProfilesByIds(missing).then((profs) => setProfiles((prev) => ({ ...prev, ...profs })));
    }
  }, [conversations, user?.id]);

  const sortedConversations = useMemo(() =>
    [...conversations].sort((a, b) => b.lastMessageAt - a.lastMessageAt), [conversations]);

  const activeConversation = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;

  // On desktop, open the most recent conversation once on load so the chat
  // pane isn't empty (mobile keeps the list-first behavior).
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (phoneMode || autoSelectedRef.current) return;
    if (!activeConversationId && !draftFriendId && sortedConversations.length > 0) {
      autoSelectedRef.current = true;
      setActiveConversationId(sortedConversations[0].id);
    }
  }, [phoneMode, sortedConversations, activeConversationId, draftFriendId]);

  const selectConversation = (id: string) => { setActiveConversationId(id); setDraftFriendId(null); };
  const selectFriend = (friendId: string) => {
    const existing = findDirectConversation(friendId);
    if (existing) { setActiveConversationId(existing.id); setDraftFriendId(null); }
    else { setActiveConversationId(null); setDraftFriendId(friendId); }
  };
  const clearSelection = () => { setActiveConversationId(null); setDraftFriendId(null); };
  const onConversationCreated = (id: string) => { setDraftFriendId(null); setActiveConversationId(id); };

  // Compose sheet: 1:1 → open (draft if new); group → create immediately.
  const handleCreateChat = (participantIds: string[], name?: string) => {
    if (!name && participantIds.length === 1) { selectFriend(participantIds[0]); return; }
    const conv = createConversation(participantIds, name);
    selectConversation(conv.id);
  };

  /* ═══ Desktop: persistent two-pane ═══ */
  if (!phoneMode) {
    return (
      <div className="h-screen flex bg-surface overflow-hidden">
        <ConversationsPanel
          conversations={sortedConversations}
          friends={friends}
          profiles={profiles}
          selfId={user?.id}
          activeId={activeConversationId}
          draftFriendId={draftFriendId}
          getUnread={getUnreadForConversation}
          hasThread={(fid) => !!findDirectConversation(fid)}
          onSelectConversation={selectConversation}
          onSelectFriend={selectFriend}
          onCompose={() => setNewChatOpen(true)}
        />
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {activeConversation ? (
            <ChatView conversation={activeConversation} profiles={profiles} onBack={clearSelection} />
          ) : draftFriendId ? (
            <ChatView draftFriendId={draftFriendId} profiles={profiles} onBack={clearSelection} onConversationCreated={onConversationCreated} />
          ) : (
            <DesktopEmptyChat onCompose={() => setNewChatOpen(true)} />
          )}
        </div>
        <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} onCreateChat={handleCreateChat} friends={friends} />
      </div>
    );
  }

  /* ═══ Mobile: single-pane list ↔ thread ═══ */
  if (activeConversation || draftFriendId) {
    return (
      // Height is driven by --app-vh (the above-keyboard height published
      // by native-keyboard.ts) rather than h-screen/100vh, because under
      // Keyboard.resize:"none" the WKWebView never shrinks for the
      // keyboard — so a 100vh column would keep the composer pinned to the
      // bottom of the full screen, behind the keyboard. Sizing to --app-vh
      // means the flex column shrinks when the keyboard opens and the
      // composer rides up with it. The eased height matches the keyboard's
      // own animation so it glides rather than jumps.
      <div
        className="flex flex-col bg-surface"
        style={{ height: 'var(--app-vh, 100dvh)', transition: 'height 0.25s cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        {activeConversation ? (
          <ChatView conversation={activeConversation} profiles={profiles} onBack={clearSelection} />
        ) : (
          <ChatView draftFriendId={draftFriendId!} profiles={profiles} onBack={clearSelection} onConversationCreated={onConversationCreated} />
        )}
      </div>
    );
  }

  return (
    <>
      <MobileMessageList
        conversations={sortedConversations}
        friends={friends}
        profiles={profiles}
        selfId={user?.id}
        getUnread={getUnreadForConversation}
        hasThread={(fid) => !!findDirectConversation(fid)}
        onOpenConversation={selectConversation}
        onOpenFriend={selectFriend}
        onCompose={() => setNewChatOpen(true)}
        onBack={() => navigate(-1)}
      />
      <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} onCreateChat={handleCreateChat} friends={friends} />
    </>
  );
};
