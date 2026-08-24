import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Send, Search, X, Users, Check, CheckCheck, MessageCircle, ChevronRight, MapPin, Trash2, ChefHat, Clock, Film, PlayCircle, Info, Store, AlertCircle, MoreVertical } from 'lucide-react';
import { cn, firstFrameSrc } from '../lib/utils';
import { SearchField } from '../components/SearchField';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { scoreTintStyle } from '../lib/score';
import { useChat, type Conversation, type SharedRestaurant, type SharedRecipe, type SharedReel, type SharedPost } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { useNavigate, useLocation } from 'react-router-dom';
import { getFriends, getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { supabase, supabaseConfigured } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { pickAvatarColor, initialsFor } from '../lib/avatar';
import { ShareSheet } from '../components/messages/ShareSheet';
import { Collapse } from '../components/Collapse';
import { GlassButton } from '../lib/glass-buttons';

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

/* ── Restaurant Share Card — the reference's card: serif title over one
      meta line, the score worn as a 38pt disc, a hairline action strip.
      No photo; the card is a pointer to the restaurant page, not a
      preview of it. ── */
const RestaurantShareCard: React.FC<{
  restaurant: SharedRestaurant;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ restaurant, isMe, hasTextAbove, onClick }) => {
  const meta = [restaurant.cuisine, restaurant.price, restaurant.address?.split(',')[0]].filter(Boolean).join(' · ');
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-[250px] overflow-hidden text-left active:scale-[0.985] transition-transform rounded-[20px] border',
        hasTextAbove && 'rounded-t-2xl',
        isMe ? 'bg-primary border-white/[0.18]' : 'bg-on-surface/[0.05] border-on-surface/[0.09]',
      )}
    >
      <div className="px-3.5 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className={cn('font-serif font-bold text-[15px] leading-[1.2] tracking-[-0.02em] truncate', isMe ? 'text-white' : 'text-on-surface')}>{restaurant.name}</p>
          {meta && <p className={cn('mt-1.5 text-[12px] leading-[1.3] truncate', isMe ? 'text-white/70' : 'text-on-surface/50')}>{meta}</p>}
          {restaurant.isReview && restaurant.notes && (
            <p className={cn('text-[12px] mt-1.5 line-clamp-2 leading-relaxed italic', isMe ? 'text-white/75' : 'text-on-surface/55')}>&ldquo;{restaurant.notes}&rdquo;</p>
          )}
        </div>
        {restaurant.isReview && restaurant.score !== undefined && restaurant.score > 0 && (
          <span
            className="flex-none w-[38px] h-[38px] rounded-full grid place-items-center font-serif font-bold text-[13px] tabular-nums"
            style={isMe
              ? { background: 'rgba(255,255,255,0.16)', color: '#fff' }
              : (() => { const t = scoreTintStyle(restaurant.score); return { background: t.background, color: t.color, boxShadow: `inset 0 0 0 1.5px ${t.ring}` }; })()}
          >
            {restaurant.score >= 10 ? '10' : restaurant.score.toFixed(1)}
          </span>
        )}
      </div>
      <div className={cn(
        'px-3.5 py-2.5 border-t text-[12px] font-semibold',
        isMe ? 'border-white/[0.14] text-white/75' : 'border-on-surface/[0.08] text-on-surface/55',
      )}>
        View restaurant
      </div>
    </button>
  );
};

/* ── Recipe Share Card — same anatomy as the restaurant card, with the
      cook time worn as the disc. ── */
const RecipeShareCard: React.FC<{
  recipe: SharedRecipe;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ recipe, isMe, hasTextAbove, onClick }) => {
  const totalLabel = recipe.totalTime && recipe.totalTime > 0
    ? (recipe.totalTime < 60 ? `${recipe.totalTime}m` : `${Math.floor(recipe.totalTime / 60)}h${recipe.totalTime % 60 ? ` ${recipe.totalTime % 60}m` : ''}`)
    : '';
  const meta = [`by ${recipe.authorName}`, recipe.difficulty, recipe.ingredientCount ? `${recipe.ingredientCount} ingredients` : ''].filter(Boolean).join(' · ');
  return (
    <button
      onClick={onClick}
      className={cn(
        'block w-[250px] overflow-hidden text-left active:scale-[0.985] transition-transform rounded-[20px] border',
        hasTextAbove && 'rounded-t-2xl',
        isMe ? 'bg-primary border-white/[0.18]' : 'bg-on-surface/[0.05] border-on-surface/[0.09]',
      )}
    >
      <div className="px-3.5 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className={cn('font-serif font-bold text-[15px] leading-[1.2] tracking-[-0.02em] truncate', isMe ? 'text-white' : 'text-on-surface')}>{recipe.name}</p>
          {meta && <p className={cn('mt-1.5 text-[12px] leading-[1.3] truncate', isMe ? 'text-white/70' : 'text-on-surface/50')}>{meta}</p>}
          {recipe.description && (
            <p className={cn('text-[12px] mt-1.5 line-clamp-1 leading-relaxed italic', isMe ? 'text-white/75' : 'text-on-surface/55')}>{recipe.description}</p>
          )}
        </div>
        {totalLabel && (
          <span className={cn(
            'flex-none min-w-[38px] h-[38px] px-1.5 rounded-full grid place-items-center font-serif font-bold text-[12px]',
            isMe ? 'bg-white/[0.16] text-white' : 'bg-recipes-tint text-recipes-ink',
          )}>
            {totalLabel}
          </span>
        )}
      </div>
      <div className={cn(
        'px-3.5 py-2.5 border-t text-[12px] font-semibold',
        isMe ? 'border-white/[0.14] text-white/75' : 'border-on-surface/[0.08] text-on-surface/55',
      )}>
        View recipe
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
                        selected ? "bg-primary/5" : "hover:bg-on-surface/3 active:bg-on-surface/[0.05]")}>
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

// Delivery status comes from the message itself (ChatContext awaits each
// insert and marks 'sent'/'failed'); 'read' comes from the other
// participants' conversation_reads marks. `othersReadFloor` is the OLDEST
// other-participant last-read for the conversation — in a 1:1 that's simply
// the other person; in a group "Read" means everyone has seen it.
const getReceiptStatus = (
  msg: { status?: 'sending' | 'sent' | 'failed'; timestamp: number },
  othersReadFloor: number,
): ReceiptStatus => {
  if (msg.status === 'sending' || msg.status === 'failed') return msg.status;
  return othersReadFloor >= msg.timestamp ? 'read' : 'sent';
};

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

/**
 * Typing presence over a Supabase broadcast channel (no table). One channel
 * per conversation; senders emit throttled `typing` events while composing
 * and the receiving side lights the indicator, decaying 3s after the last
 * event so an abandoned draft goes quiet on its own.
 */
function useTypingPresence(convId: string | null, userId: string | null | undefined) {
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);
  const decayRef = useRef<number | null>(null);

  useEffect(() => {
    setOtherTyping(false);
    if (!convId || !userId || !supabaseConfigured) return;
    const ch = supabase.channel(`typing-${convId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, (payload) => {
      const sender = (payload.payload as { userId?: string } | undefined)?.userId;
      if (!sender || sender === userId) return;
      setOtherTyping(true);
      if (decayRef.current != null) window.clearTimeout(decayRef.current);
      decayRef.current = window.setTimeout(() => setOtherTyping(false), 3000);
    }).subscribe();
    channelRef.current = ch;
    return () => {
      if (decayRef.current != null) window.clearTimeout(decayRef.current);
      channelRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [convId, userId]);

  // Call on every keystroke; throttled so a fast typist sends ~1 event per
  // 1.5s (well under the decay window, so the indicator stays lit).
  const notifyTyping = React.useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !userId) return;
    const now = Date.now();
    if (now - lastSentRef.current < 1500) return;
    lastSentRef.current = now;
    void ch.send({ type: 'broadcast', event: 'typing', payload: { userId } });
  }, [userId]);

  return { otherTyping, notifyTyping };
}

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
  const { sendMessage, markRead, retryMessage, deleteConversation, renameConversation, getOrCreateDirectConversation, otherReads } = useChat();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  // The ONE share surface — the composer's + opens it.
  const [shareOpen, setShareOpen] = useState(false);
  // Header overflow: view profile / delete live behind the ⋯.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  const { otherTyping: isOtherTyping, notifyTyping } = useTypingPresence(convId, user?.id);

  // Read receipts: the OLDEST other-participant read mark. A message at or
  // before this floor has been seen by everyone else in the thread (in a
  // 1:1 that's just the other person). 0 until reads load — receipts show
  // 'Sent' rather than guessing.
  const othersReadFloor = useMemo(() => {
    if (!conversation) return 0;
    const others = conversation.participantIds.filter((id) => id !== user?.id);
    if (others.length === 0) return 0;
    const reads = otherReads[conversation.id] || {};
    return Math.min(...others.map((id) => reads[id] || 0));
  }, [conversation, otherReads, user?.id]);

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
    if (!text.trim()) return;
    const id = ensureConversationId();
    if (!id) return;
    sendMessage(id, text.trim());
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // A CJK IME's confirm-Enter must commit the composition, not send.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // The share sheet sends straight into the (possibly draft) thread.
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
          <GlassButton
            id="chat-back"
            symbol="chevron.left"
            label="Back"
            onClick={onBack}
            className="hit-44 flex-none w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
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
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Conversation options"
            aria-expanded={menuOpen}
            className="w-9 h-9 rounded-full grid place-items-center text-on-surface/50 active:bg-on-surface/[0.08] transition-colors"
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute right-0 top-full mt-1.5 z-40 min-w-[190px] rounded-2xl bg-paper border border-on-surface/[0.09] shadow-[0_16px_44px_-10px_rgba(0,0,0,0.35)] overflow-hidden py-1">
                {!isGroup && otherProfile?.username && (
                  <button
                    onClick={() => { setMenuOpen(false); navigate(`/user/${otherProfile.username}`); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] font-semibold text-on-surface active:bg-on-surface/[0.05]"
                  >
                    <Info size={15} className="text-on-surface/50" /> View profile
                  </button>
                )}
                {convId && (
                  <button
                    onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] font-semibold text-red-500 active:bg-red-500/[0.06]"
                  >
                    <Trash2 size={15} /> Delete conversation
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <Collapse open={confirmDelete} className="flex-shrink-0">
            <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-red-600 font-medium">Delete this conversation?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg">Cancel</button>
                <button onClick={() => { if (convId) deleteConversation(convId); onBack(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg">Delete</button>
              </div>
            </div>
      </Collapse>

      {/* Group-chat naming banner (unnamed group chats only) */}
      <Collapse open={!!(isUnnamedGroup && !bannerDismissed)}>
            <div className="bg-primary/[0.04] border-b border-primary/15 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Users size={13} className="text-primary flex-shrink-0" />
                  <p className="text-[12px] font-semibold text-primary/90 flex-shrink-0">Name this group</p>
                  <input
                    type="text"
                    value={groupNameDraft}
                    onChange={(e) => setGroupNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleSaveGroupName(); } }}
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
      </Collapse>

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
                      status={getReceiptStatus(msg, othersReadFloor)}
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

      {/* Composer — the reference's: one + that opens the share sheet
          (the permanent two-button shelf is gone), the field, one send
          that dims until there's a draft. */}
      <div className={cn(
        'flex items-end gap-2 flex-shrink-0 border-t border-on-surface/[0.08] bg-surface',
        phoneMode ? 'px-3 pt-2.5 pb-safe-4' : 'px-5 pt-3 pb-4',
      )}>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label="Share a restaurant or recipe"
          className={cn(
            'flex-none w-10 h-10 rounded-full grid place-items-center bg-on-surface/[0.07] text-on-surface active:bg-on-surface/[0.12] transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            shareOpen && 'rotate-45',
          )}
        >
          <Plus size={19} strokeWidth={2.2} />
        </button>
        <div className="flex-1 min-w-0 flex items-center rounded-[22px] bg-on-surface/[0.06] px-4">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) notifyTyping(); }}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${(title || '').split(' ')[0] || ''}`}
            className="flex-1 bg-transparent text-[15px] text-on-surface placeholder:text-on-surface/35 focus:outline-none py-[11px] min-w-0"
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim()}
          aria-label="Send"
          className={cn(
            'flex-none w-10 h-10 rounded-full grid place-items-center transition-all active:scale-95',
            text.trim() ? 'bg-primary text-white' : 'bg-on-surface/[0.07] text-on-surface/30',
          )}
        >
          <Send size={16} />
        </button>
      </div>

      <ShareSheet
        open={shareOpen}
        recipientName={title}
        selfName={selfName}
        onClose={() => setShareOpen(false)}
        onShareRestaurant={handleShareRestaurantNow}
        onShareRecipe={handleShareRecipeNow}
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
      {/* Hover-reveal only where hover exists — on touch (iPad in the
          desktop layout) the pill stays visible at reduced emphasis, else
          the affordance is undiscoverable. */}
      <span className="flex-shrink-0 text-[11px] font-bold tracking-wide text-primary bg-primary/[0.08] px-3 py-1 rounded-full opacity-70 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity">Message</span>
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

/* ── Mobile list screen — one list, one composer ── */
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
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-on-surface/[0.05] transition-colors">
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

/* A friend with no thread yet — the same row as a conversation, with a
   muted "Say hi" where the last message would be. One list, no separate
   friends section, no Message pill. */
const MobileFriendRow: React.FC<{ friend: FriendLite; expert: boolean; onClick: () => void }> = ({ friend, expert, onClick }) => (
  <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-on-surface/[0.05] transition-colors">
    <PersonAvatar name={friend.name} userId={friend.id} size={52} expert={expert} />
    <div className="flex-1 min-w-0">
      <p className="text-[15.5px] font-semibold text-on-surface/85 truncate">{friend.name}</p>
      <p className="text-[13px] text-on-surface/40 truncate mt-0.5">Say hi</p>
    </div>
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
  // Header (title + search + tabs) floats over the list and dissolves
  // with scroll, Discover-style. This view only renders on phones.
  const headerFade = useHeaderFade();

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

  const unreadCount = conversations.filter((c) => getUnread(c.id) > 0).length;
  const sharesCount = conversations.filter(lastMessageIsShare).length;
  const tabs: { key: 'all' | 'unread' | 'shares'; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'shares', label: 'Shares', count: sharesCount },
  ];

  return (
    <div className="h-screen flex flex-col bg-surface relative">
      {/* Floating header — absolute so the list scrolls beneath it while it
          fades; the list's paddingTop clears its measured height. */}
      <motion.header
        ref={headerFade.headerRef}
        style={headerFade.headerStyle}
        className="absolute top-0 inset-x-0 z-30 px-4 pt-safe-4 pb-2.5 bg-surface/90 backdrop-blur-md border-b border-on-surface/[0.06]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GlassButton
              id="messages-back"
              symbol="chevron.left"
              label="Back"
              onClick={onBack}
              className="hit-44 flex-none w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
            >
              <ArrowLeft size={18} />
            </GlassButton>
            <h1 className="font-serif font-bold text-[26px] tracking-tight">Messages</h1>
          </div>
          <button onClick={onCompose} className="w-9 h-9 rounded-full grid place-items-center text-primary active:bg-primary/10" title="New message"><Plus size={22} /></button>
        </div>
        <div className="mt-2.5">
          <SearchField
            glassId="messages-search"
            value={query}
            onChange={setQuery}
            placeholder="Search messages and friends"
          />
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key} className={cn('h-9 px-4 rounded-full text-[12.5px] font-bold transition-colors inline-flex items-center gap-1.5', tab === t.key ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface active:bg-on-surface/[0.1]')}>
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className={cn('text-[11px] font-bold', tab === t.key ? 'text-surface/60' : 'text-on-surface/40')}>{t.count}</span>}
            </button>
          ))}
        </div>
      </motion.header>

      <div
        ref={headerFade.scrollRef}
        onScroll={headerFade.onScroll}
        className="flex-1 overflow-y-auto pb-safe-5"
        style={{ paddingTop: headerFade.headerH }}
      >
        {/* One list. People you've talked to sit at the top (recency
            order arrives sorted); everyone else you follow reads "Say hi"
            beneath them. The avatar rail and the separate All-friends
            section with its Message pills said the same names three
            times — this says them once. */}
        <div className="divide-y divide-on-surface/[0.06]">
          {filteredConvs.map((c) => (
            <MobileConvRow key={c.id} conv={c} profiles={profiles} selfId={selfId} unread={getUnread(c.id)} onClick={() => onOpenConversation(c.id)} />
          ))}
          {friendsWithoutThread.map((f) => (
            <MobileFriendRow key={f.id} friend={f} expert={!!profiles[f.id]?.is_verified} onClick={() => onOpenFriend(f.id)} />
          ))}
        </div>

        {filteredConvs.length === 0 && friendsWithoutThread.length === 0 && (
          <div className="px-6 py-20 text-center">
            <MessageCircle size={36} className="mx-auto text-on-surface/12 mb-3" />
            <p className="text-[14px] font-semibold text-on-surface/45">{q ? 'No one by that name' : tab === 'unread' ? 'No unread messages' : tab === 'shares' ? 'No shared cards yet' : 'No conversations yet'}</p>
            {q && <p className="mt-1.5 text-[12.5px] text-on-surface/35 leading-relaxed max-w-[260px] mx-auto">Search only covers people you follow and the threads you already have.</p>}
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

  // Deep link from a profile's "Message" button: navigate('/messages',
  // { state: { openUserId } }) lands directly in that person's thread
  // (drafting one if it doesn't exist) instead of dumping the user on the
  // list to re-find them. State is consumed once and cleared so back/
  // refresh doesn't re-trigger the jump.
  const location = useLocation();
  const openUserId = (location.state as { openUserId?: string } | null)?.openUserId;
  useEffect(() => {
    if (!openUserId) return;
    autoSelectedRef.current = true; // beat the open-most-recent auto-select
    const existing = findDirectConversation(openUserId);
    if (existing) { setActiveConversationId(existing.id); setDraftFriendId(null); }
    else { setActiveConversationId(null); setDraftFriendId(openUserId); }
    // The target may not be a friend/participant yet — make sure the chat
    // header can show their name instead of "New message".
    getProfilesByIds([openUserId]).then((profs) => setProfiles((prev) => ({ ...prev, ...profs })));
    navigate('/messages', { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUserId]);
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
