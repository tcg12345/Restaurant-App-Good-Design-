import { usePageBack } from '../lib/usePageBack';
import { RoomInviteMessage } from '../components/chat/RoomInviteMessage';
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { ArrowLeft, Plus, Send, Search, X, Users, Check, CheckCheck, MessageCircle, ChevronRight, MapPin, Trash2, ChefHat, Clock, Film, Images, PlayCircle, Info, Store, AlertCircle, MoreVertical, SquarePen, ArrowUp, BookOpen } from 'lucide-react';
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
import { readViewCache, writeViewCache } from '../lib/view-cache';
import { useSocialDialog } from '../components/social/useSocialDialog';
import { Avatar } from '../components/Avatar';
import { avatarHue } from '../lib/avatar';
import { conversationHasShares, conversationMatchesText, isRoomInvite, isSharedMessage } from '../lib/message-discovery';
import { homeHaptic } from '../lib/haptics';
import '../components/social/SocialDesign.css';
import { SKELETON_PULSE } from '../components/LoadingSkeleton';

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
  if (isRoomInvite(last.text)) return `${who} invited you to Decide together`;
  return (last.senderId === selfId ? 'You: ' : '') + last.text;
}

function lastMessageIsShare(conv: Conversation): boolean {
  const last = conv.messages[conv.messages.length - 1];
  return !!last && isSharedMessage(last);
}

/** Small round avatar — solid color + initials, with an optional verified badge. */
const PersonAvatar: React.FC<{ name: string; userId: string; src?: string | null; size?: number; expert?: boolean }> = ({ name, userId, src, size = 48, expert }) => (
  <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
    <Avatar src={src} name={name} size={size} fallbackStyle={{ backgroundColor: `hsl(${avatarHue(userId)} 30% 90%)`, color: `hsl(${avatarHue(userId)} 28% 34%)` }} />
    {expert && <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface ring-2 ring-surface"><VerifiedBadge size={15} /></span>}
  </div>
);

/* ── Share cards ───────────────────────────────────────────────────────
   Four cards, one shell. They are deliberately NOT tinted by who sent
   them: a shared post looks the same in either direction (Instagram's
   rule), and tinting them was also what made them unreadable — the card
   painted itself `bg-primary` and wrote in white, and `--color-primary`
   is now bone in dark mode. The bubble's tail corner still tells you
   which side sent it. ── */

/** The card's own surface + the tail-corner shaping. */
const shareCardShell = (isMe: boolean, hasTextAbove: boolean) => cn(
  'block overflow-hidden text-left align-top transition-transform active:scale-[0.985]',
  'bg-on-surface/[0.06] ring-1 ring-on-surface/[0.08] rounded-[20px]',
  hasTextAbove && (isMe ? 'rounded-tr-md' : 'rounded-tl-md'),
  isMe ? 'rounded-br-md' : 'rounded-bl-md',
);

/** Author line above shared media — small avatar, @username. */
const ShareAuthor: React.FC<{ color: string; initials: string; username: string }> = ({ color, initials, username }) => (
  <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
    <span className={cn('grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-[9px] font-bold text-white', color)}>
      {initials}
    </span>
    <span className="truncate text-[12.5px] font-bold text-on-surface">@{username}</span>
  </div>
);

/* ── Restaurant ──
   A cover thumbnail, the name, one meta line, and the score worn as a
   disc. The hairline "View restaurant" strip is gone: the card IS the
   link, and a row of chrome under every share was the noisiest thing in
   the thread. ── */
const RestaurantShareCard: React.FC<{
  restaurant: SharedRestaurant;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ restaurant, isMe, hasTextAbove, onClick }) => {
  const meta = [restaurant.cuisine, restaurant.price, restaurant.address?.split(',')[0]].filter(Boolean).join(' · ');
  const scored = restaurant.isReview && restaurant.score !== undefined && restaurant.score > 0;
  return (
    <button onClick={onClick} className={cn(shareCardShell(isMe, hasTextAbove), 'w-[264px]')}>
      <div className="flex items-center gap-3 p-2.5">
        <span className="grid h-[52px] w-[52px] flex-none place-items-center overflow-hidden rounded-[14px] bg-on-surface/[0.07]">
          {restaurant.image
            ? <img src={restaurant.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <Store size={19} className="text-on-surface/35" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-sans text-[15px] font-bold leading-[1.15] tracking-[-0.02em] text-on-surface">
            {restaurant.name}
          </span>
          {meta && <span className="mt-1 block truncate text-[12px] leading-[1.25] text-on-surface/50">{meta}</span>}
        </span>
        {scored && (
          <span
            className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full font-sans text-[13px] font-bold tabular-nums"
            style={(() => {
              const t = scoreTintStyle(restaurant.score as number);
              return { background: t.background, color: t.color, boxShadow: `inset 0 0 0 1.5px ${t.ring}` };
            })()}
          >
            {(restaurant.score as number) >= 10 ? '10' : (restaurant.score as number).toFixed(1)}
          </span>
        )}
      </div>
      {restaurant.isReview && restaurant.notes && (
        <p className="line-clamp-2 px-3 pb-3 text-[12.5px] italic leading-[1.45] text-on-surface/60">
          &ldquo;{restaurant.notes}&rdquo;
        </p>
      )}
    </button>
  );
};

/* ── Recipe — the same anatomy, with the cook time as the disc. ── */
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
    <button onClick={onClick} className={cn(shareCardShell(isMe, hasTextAbove), 'w-[264px]')}>
      <div className="flex items-center gap-3 p-2.5">
        <span className="grid h-[52px] w-[52px] flex-none place-items-center overflow-hidden rounded-[14px] bg-on-surface/[0.07]">
          {recipe.image
            ? <img src={recipe.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <ChefHat size={19} className="text-on-surface/35" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-sans text-[15px] font-bold leading-[1.15] tracking-[-0.02em] text-on-surface">
            {recipe.name}
          </span>
          {meta && <span className="mt-1 block truncate text-[12px] leading-[1.25] text-on-surface/50">{meta}</span>}
        </span>
        {totalLabel && (
          <span className="grid h-[38px] min-w-[38px] flex-none place-items-center rounded-full bg-recipes-tint px-1.5 font-sans text-[12px] font-bold text-recipes-ink">
            {totalLabel}
          </span>
        )}
      </div>
      {recipe.description && (
        <p className="line-clamp-2 px-3 pb-3 text-[12.5px] leading-[1.45] text-on-surface/60">{recipe.description}</p>
      )}
    </button>
  );
};

/* ── Reel — a tall poster, the way a shared reel arrives in a DM: the
      video itself at 9:16 with the author over a scrim, and nothing
      else competing with it. ── */
const ReelShareCard: React.FC<{
  reel: SharedReel;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ reel, isMe, hasTextAbove, onClick }) => (
  <button onClick={onClick} className={cn(shareCardShell(isMe, hasTextAbove), 'w-[188px]')}>
    <div className={cn('relative aspect-[9/16] w-full overflow-hidden bg-gradient-to-br', reel.bgGradient || 'from-stone-800 to-stone-900')}>
      {reel.videoUrl && (
        <video
          src={reel.videoUrl}
          poster={reel.posterUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* Only where the text sits — a full-height wash greys the video. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 to-transparent" />
      <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
        <Film size={13} />
      </span>
      <div className="absolute inset-x-2.5 bottom-2.5">
        <div className="flex items-center gap-1.5">
          <span className={cn('grid h-5 w-5 flex-none place-items-center rounded-full text-[8px] font-bold text-white ring-1 ring-white/50', reel.authorAvatarColor)}>
            {reel.authorInitials}
          </span>
          <span className="truncate text-[11.5px] font-bold text-white drop-shadow">@{reel.authorUsername}</span>
        </div>
        {reel.attachedTitle && (
          <p className="mt-1 truncate text-[11px] text-white/80 drop-shadow">{reel.attachedTitle}</p>
        )}
      </div>
    </div>
    {reel.caption && (
      <p className="line-clamp-2 px-3 py-2.5 text-[12.5px] leading-[1.4] text-on-surface/65">{reel.caption}</p>
    )}
  </button>
);

/* ── Post — Instagram's shared-post anatomy: who posted it, the picture
      at square crop, then the caption. The picture is the message. ── */
const PostShareCard: React.FC<{
  post: SharedPost;
  isMe: boolean;
  hasTextAbove: boolean;
  onClick?: () => void;
}> = ({ post, isMe, hasTextAbove, onClick }) => (
  <button onClick={onClick} className={cn(shareCardShell(isMe, hasTextAbove), 'w-[250px]')}>
    <ShareAuthor color={post.authorAvatarColor} initials={post.authorInitials} username={post.authorUsername} />
    <div className={cn('relative aspect-square w-full overflow-hidden bg-gradient-to-br', post.bgGradient || 'from-stone-800 to-stone-900')}>
      {post.coverUrl && post.coverMediaType === 'video' && (
        <video src={firstFrameSrc(post.coverUrl)} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {post.coverUrl && post.coverMediaType === 'photo' && (
        <img src={post.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      )}
      {/* A carousel says so with the stacked-squares glyph, like the feed. */}
      {post.itemCount > 1 && (
        <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <Images size={13} />
        </span>
      )}
      {post.coverMediaType === 'video' && post.itemCount <= 1 && (
        <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <PlayCircle size={14} />
        </span>
      )}
    </div>
    {(post.caption || post.locationLabel) ? (
      <div className="px-3 py-2.5">
        {post.locationLabel && (
          <p className="mb-0.5 flex items-center gap-1 truncate text-[11.5px] font-bold text-on-surface/70">
            <MapPin size={11} className="flex-none" />
            <span className="truncate">{post.locationLabel}</span>
          </p>
        )}
        {post.caption && (
          <p className="line-clamp-2 text-[12.5px] leading-[1.4] text-on-surface/65">{post.caption}</p>
        )}
      </div>
    ) : (
      <p className="px-3 py-2.5 text-[12px] text-on-surface/45">
        {post.itemCount} {post.itemCount === 1 ? 'photo or video' : 'photos and videos'}
      </p>
    )}
  </button>
);


/* ── New Chat Sheet ── */
const NewChatSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreateChat: (participantIds: string[], name?: string) => void;
  friends: FriendLite[];
}> = ({ open, onClose, onCreateChat, friends }) => {
  const { phoneMode } = useSettings();
  const dialogRef = useSocialDialog(open, onClose);
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
            ref={dialogRef} role="dialog" aria-modal="true" aria-label="New message"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'social-design social-compose-sheet bg-surface flex flex-col overflow-hidden',
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
                <h3 className={cn('font-sans font-bold', phoneMode ? 'text-[22px]' : 'text-[20px]')}>New message</h3>
                {phoneMode && <p className="text-[13px] text-on-surface/55 mt-0.5">Pick a friend to start a thread.</p>}
              </div>
              <button aria-label="Close new message" onClick={onClose} className="w-9 h-9 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors flex-shrink-0">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>
            {!phoneMode && <div className="border-t border-on-surface/[0.06]" />}

            {/* Mode toggle */}
            <div className="social-segments social-compose-modes mx-5 mt-3 mb-2 flex-shrink-0">
              <button aria-pressed={mode === 'direct'} onClick={() => { setMode('direct'); setSelectedFriends([]); }}
                className={cn("flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all",
                  mode === 'direct' ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>
                One to one
              </button>
              <button aria-pressed={mode === 'group'} onClick={() => setMode('group')}
                className={cn("flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all",
                  mode === 'group' ? "border-primary bg-primary/10 text-primary" : "border-on-surface/10 text-on-surface/50")}>
                <Users size={12} className="inline mr-1" />Group
              </button>
            </div>

            {mode === 'group' && (
              <div className="px-5 pt-2 pb-2 flex-shrink-0">
                <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)}
                  aria-label="Group name" maxLength={80} placeholder="Group name (optional)"
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
                  aria-label="Search recipients" placeholder="Search friends"
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
                      <PersonAvatar src={friend.avatar} name={friend.name} userId={friend.id} size={44} />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-[15px] font-semibold truncate", selected ? "text-primary" : "text-on-surface")}>{friend.name}</p>
                        {friend.username && <p className="text-[12px] text-on-surface/45">@{friend.username}</p>}
                      </div>
                      {mode === 'group' && (
                        <div className={cn("w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0",
                          selected ? "bg-primary border-primary text-on-primary" : "border-on-surface/20")}>
                          {selected && <Check size={12} strokeWidth={3} />}
                        </div>
                      )}
                      {mode === 'direct' && <ChevronRight size={14} className="text-on-surface/20" />}
                    </button>
                  );
                })
              )}
            </div>

            {mode === 'group' && (
              <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                <button disabled={selectedFriends.length < 2} onClick={handleCreateGroup}
                  className="w-full py-3 bg-primary text-on-primary rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                  {selectedFriends.length < 2 ? "Choose at least 2 friends" : `Create group · ${selectedFriends.length + 1} people`}
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useSocialDialog(detailsOpen, () => setDetailsOpen(false));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const nearBottom = useRef(true);
  useEffect(() => {
    if (scrollRef.current && (nearBottom.current || messages.at(-1)?.senderId === user?.id)) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, isOtherTyping, user?.id]);
  useLayoutEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
  }, [text]);

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
    homeHaptic();
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
    <div className="social-design social-chat flex flex-col h-full">
      {/* Header */}
      <div className={cn(
        'social-chat-header flex items-center gap-3 flex-shrink-0 border-b border-on-surface/[0.06] bg-surface/80 backdrop-blur-md',
        // pt-safe-3 keeps the back arrow / name clear of the status bar &
        // Dynamic Island — the thread view is full-screen on phones.
        phoneMode ? 'px-4 pt-safe-3 pb-3' : 'px-6 py-3.5',
      )}>
        {phoneMode && (
          <GlassButton
            id="chat-back"
            suspended={shareOpen || detailsOpen}
            symbol="chevron.left"
            label="Back"
            onClick={onBack}
            className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} />
          </GlassButton>
        )}
        {isGroup ? (
          <div className={cn('rounded-full bg-primary/10 grid place-items-center flex-shrink-0', phoneMode ? 'w-9 h-9' : 'w-11 h-11')}>
            <Users size={phoneMode ? 16 : 18} className="text-primary" />
          </div>
        ) : (
          <PersonAvatar src={otherProfile?.avatar_url} name={title} userId={otherId || 'unknown'} size={phoneMode ? 36 : 44} expert={expert} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className={cn('font-sans font-bold truncate', phoneMode ? 'text-[17px]' : 'text-[19px]')}>{title}</h2>
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
                {isGroup && <button className="w-full flex items-center gap-2.5 px-4 py-3 text-left text-[13.5px] font-semibold" onClick={() => { setMenuOpen(false); setGroupNameDraft(conversation?.name || ''); setDetailsOpen(true); }}><Users size={15} />Group details</button>}
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
                    className="px-3 h-7 text-[11px] font-bold text-on-primary bg-primary rounded-full flex-shrink-0 active:scale-95 transition-transform"
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
          const hasShared = !!(msg.sharedRestaurant || msg.sharedRecipe || msg.sharedReel || msg.sharedPost || msg.sharedGuide);
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
              <div className={cn("social-message flex", isMe ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] flex flex-col", isMe ? "items-end" : "items-start")}>
                  {showSender && (
                    <p className="text-[10px] font-semibold text-on-surface/40 mb-0.5 px-1">{getParticipantName(msg.senderId)}</p>
                  )}
                  {hasShared ? (
                    <div className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                      {hasText && (
                        <div className={cn(
                          "social-bubble selectable px-3.5 py-2 text-sm leading-relaxed rounded-2xl mb-1",
                          isMe
                            ? "bg-primary text-on-primary rounded-br-md"
                            : "bg-on-surface/[0.06] text-on-surface rounded-bl-md"
                        )}>
                          <RoomInviteMessage text={msg.text} />
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
                      {msg.sharedGuide && <button className={cn(shareCardShell(isMe, false), 'w-[264px]')} onClick={() => navigate(`/guides/${msg.sharedGuide!.guideId}`)}>
                        {msg.sharedGuide.coverPhoto && <img className="w-full h-32 object-cover" src={msg.sharedGuide.coverPhoto} alt="" />}
                        <span className="flex items-center gap-3 p-3.5"><BookOpen size={20} /><span className="min-w-0"><strong className="block text-sm">{msg.sharedGuide.title}</strong><span className="block mt-1 text-xs text-on-surface/55">{msg.sharedGuide.entryCount} {msg.sharedGuide.type === 'recipes' ? 'recipes' : 'places'} · {msg.sharedGuide.authorName}</span></span></span>
                      </button>}
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
                    <div className={cn("social-bubble selectable px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                      isMe
                        ? "bg-primary text-on-primary rounded-br-md"
                        : "bg-on-surface/[0.06] text-on-surface rounded-bl-md"
                    )}>
                      <RoomInviteMessage text={msg.text} />
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
        'social-composer flex items-end gap-2 flex-shrink-0 border-t border-on-surface/[0.08] bg-surface',
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
          <textarea
            ref={inputRef}
            rows={1}
            aria-label="Message"
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
            text.trim() ? 'bg-primary text-on-primary' : 'bg-on-surface/[0.07] text-on-surface/30',
          )}
        >
          <ArrowUp size={20} strokeWidth={2.5} />
        </button>
      </div>

      <AnimatePresence>
        {detailsOpen && <motion.div className="social-details-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDetailsOpen(false)}>
          <motion.div ref={detailsRef} className="social-group-details" role="dialog" aria-modal="true" aria-label="Group details" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: .22 }} onClick={e => e.stopPropagation()}>
            <header><h2>Group details</h2><button aria-label="Close group details" onClick={() => setDetailsOpen(false)}><X size={20} /></button></header>
            <label htmlFor="chat-group-name">Group name</label>
            <form onSubmit={e => { e.preventDefault(); if (convId && groupNameDraft.trim()) { renameConversation(convId, groupNameDraft.trim()); homeHaptic(); setDetailsOpen(false); } }}>
              <input id="chat-group-name" value={groupNameDraft} maxLength={80} placeholder="Name your group" onChange={e => setGroupNameDraft(e.target.value)} />
              <button disabled={!groupNameDraft.trim() || groupNameDraft.trim() === conversation?.name}>Save</button>
            </form>
            <h3>{conversation?.participantIds.length} people</h3>
            <div className="social-group-members">{conversation?.participantIds.map(id => <button key={id} disabled={!profiles[id]?.username} onClick={() => navigate(`/user/${profiles[id]?.username}`)}>
              <PersonAvatar src={profiles[id]?.avatar_url} name={getParticipantName(id)} userId={id} size={44} /><span><strong>{getParticipantName(id)}</strong><small>{profiles[id]?.username ? `@${profiles[id]?.username}` : ''}</small></span><ChevronRight size={15} />
            </button>)}</div>
          </motion.div>
        </motion.div>}
      </AnimatePresence>
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
type FriendLite = { id: string; name: string; username?: string; avatar?: string | null };

/* ── First-paint snapshot ──
   ChatContext already caches conversations, but names and avatars live in
   `profiles` — without them a cached thread list paints as a column of
   "Unknown". Caching the people alongside the threads is what makes the
   warm load actually instant. */
const MESSAGES_CACHE = 'messages';

interface MessagesSnapshot {
  friends: FriendLite[];
  profiles: Record<string, UserProfile>;
}

/* One conversation row in pulse. `size` is the avatar diameter, matching
   MobileConvRow (52) and the desktop ConvRow (48) so neither list shifts
   when the real rows arrive. */
const ConvRowSkeleton: React.FC<{ size: number; className?: string; titleWidth: string }> = ({ size, className, titleWidth }) => (
  <div className={cn('w-full flex items-center gap-3 px-4 py-3', className)} aria-hidden="true">
    <div className={cn(SKELETON_PULSE, 'rounded-full flex-shrink-0')} style={{ width: size, height: size }} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className={cn(SKELETON_PULSE, 'h-3.5 rounded-full')} style={{ width: titleWidth }} />
        <div className={cn(SKELETON_PULSE, 'h-2.5 w-7 rounded-full flex-shrink-0')} />
      </div>
      <div className={cn(SKELETON_PULSE, 'mt-2 h-3 rounded-full')} style={{ width: `calc(${titleWidth} + 22%)` }} />
    </div>
  </div>
);

/* A short run of them. Widths step so the column reads as a list of
   different people rather than a stack of identical bars. */
const ConvListSkeleton: React.FC<{ count?: number; size?: number; rowClassName?: string }> = ({ count = 7, size = 52, rowClassName }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <ConvRowSkeleton key={i} size={size} className={rowClassName} titleWidth={`${28 + ((i * 11) % 26)}%`} />
    ))}
  </>
);

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
  const display = fullTitle;
  const expert = !conv.isGroup && otherId ? !!profiles[otherId]?.is_verified : false;
  return (
    <button
      onClick={onClick}
      className={cn(
        'social-conversation-row relative w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors',
        active ? 'bg-primary/[0.07]' : 'hover:bg-on-surface/[0.04]',
      )}
    >
      {active && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-primary" />}
      {conv.isGroup ? (
        <div className="w-12 h-12 rounded-full bg-primary/10 grid place-items-center flex-shrink-0"><Users size={18} className="text-primary" /></div>
      ) : (
        <PersonAvatar src={otherId ? profiles[otherId]?.avatar_url : undefined} name={fullTitle} userId={otherId || conv.id} size={48} expert={expert} />
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
            <span className="min-w-[20px] h-[20px] px-1.5 bg-primary text-on-primary text-[11px] font-bold rounded-full grid place-items-center flex-shrink-0 shadow-sm shadow-primary/25">{unread}</span>
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
      <PersonAvatar src={friend.avatar} name={friend.name} userId={friend.id} size={44} expert={expert} />
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
  loading: boolean;
}> = ({ conversations, friends, profiles, selfId, activeId, draftFriendId, getUnread, hasThread, onSelectConversation, onSelectFriend, onCompose, loading }) => {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'unread' | 'shares'>('all');

  const q = query.trim().toLowerCase();
  const matchesConv = (c: Conversation) => {
    if (!q) return true;
    const title = conversationTitle(c, profiles, selfId).toLowerCase();
    const handle = (otherParticipantId(c, selfId) && profiles[otherParticipantId(c, selfId)!]?.username || '').toLowerCase();
    return title.includes(q) || handle.includes(q) || conversationMatchesText(c, q);
  };

  const filteredConvs = useMemo(() => conversations.filter((c) => {
    if (tab === 'unread' && getUnread(c.id) === 0) return false;
    if (tab === 'shares' && !conversationHasShares(c)) return false;
    return matchesConv(c);
  }), [conversations, tab, q, profiles, selfId, getUnread]);

  // Friends with no existing thread — the "you don't need a chat to message them" list.
  const friendsWithoutThread = useMemo(() => {
    if (tab !== 'all') return [];
    return friends.filter((f) => !hasThread(f.id) && (!q || f.name.toLowerCase().includes(q) || (f.username || '').toLowerCase().includes(q)));
  }, [friends, tab, q, hasThread]);

  const unreadCount = conversations.filter((c) => getUnread(c.id) > 0).length;
  const sharesCount = conversations.filter(conversationHasShares).length;

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
          <h1 className="font-sans font-bold text-[28px] tracking-tight">Messages</h1>
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
          <button key={t.key} onClick={() => { homeHaptic(); setTab(t.key); }}
            className={cn('relative flex-1 py-2.5 text-[13px] transition-colors', tab === t.key ? 'text-on-surface font-semibold' : 'text-on-surface/50 hover:text-on-surface/75 font-medium')}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/12 text-primary align-[1px]">{t.count}</span>}
            {tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2 min-h-0">
        {loading && (
          <ConvListSkeleton count={6} size={48} rowClassName="rounded-2xl" />
        )}

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
            {friendsWithoutThread.length > 0 && <p className="social-section-label">Start a conversation</p>}
          {friendsWithoutThread.map((f) => (
              <FriendRow key={f.id} friend={f} profiles={profiles} onClick={() => onSelectFriend(f.id)} />
            ))}
          </>
        )}

        {!loading && filteredConvs.length === 0 && friendsWithoutThread.length === 0 && (
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
      <h2 className="font-sans font-bold text-[30px] tracking-tight">Your messages</h2>
      <p className="text-[14.5px] text-on-surface/55 leading-relaxed">Pick a conversation, or message any friend to start a thread. Share a restaurant or recipe in a single tap.</p>
      <button onClick={onCompose} className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-full hover:bg-primary/90 transition-colors">
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
  const display = fullTitle;
  const expert = !conv.isGroup && otherId ? !!profiles[otherId]?.is_verified : false;
  const share = lastMessageIsShare(conv);
  return (
    <button onClick={onClick} className="social-conversation-row w-full flex items-center gap-3 px-4 py-3 text-left active:bg-on-surface/[0.05] transition-colors">
      {conv.isGroup
        ? <div className="w-[52px] h-[52px] rounded-full bg-primary/10 grid place-items-center flex-shrink-0"><Users size={18} className="text-primary" /></div>
        : <PersonAvatar src={otherId ? profiles[otherId]?.avatar_url : undefined} name={fullTitle} userId={otherId || conv.id} size={52} expert={expert} />}
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
          {unread > 0 && <span className="min-w-[20px] h-[20px] px-1.5 bg-primary text-on-primary text-[11px] font-bold rounded-full grid place-items-center flex-shrink-0">{unread}</span>}
        </div>
      </div>
    </button>
  );
};

/* A friend with no thread yet — the same row as a conversation, with a
   muted "Say hi" where the last message would be. One list, no separate
   friends section, no Message pill. */
const MobileFriendRow: React.FC<{ friend: FriendLite; expert: boolean; onClick: () => void }> = ({ friend, expert, onClick }) => (
  <button onClick={onClick} className="social-conversation-row w-full flex items-center gap-3 px-4 py-3 text-left active:bg-on-surface/[0.05] transition-colors">
    <PersonAvatar src={friend.avatar} name={friend.name} userId={friend.id} size={52} expert={expert} />
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
  loading: boolean;
  // The New Message sheet is a separate `fixed inset-0` layer that covers
  // this whole header, but native glass draws in its own layer ABOVE the
  // WebView — an opaque CSS sheet on top does nothing to hide a still-
  // registered native control underneath it. Suspend this header's glass
  // while that sheet is open, or its back chevron and search bar bleed
  // through on top of "New message".
  composeOpen: boolean;
}> = ({ conversations, friends, profiles, selfId, getUnread, hasThread, onOpenConversation, onOpenFriend, onCompose, onBack, loading, composeOpen }) => {
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
    return title.includes(q) || handle.includes(q) || conversationMatchesText(c, q);
  };
  const filteredConvs = useMemo(() => conversations.filter((c) => {
    if (tab === 'unread' && getUnread(c.id) === 0) return false;
    if (tab === 'shares' && !conversationHasShares(c)) return false;
    return matchesConv(c);
  }), [conversations, tab, q, profiles, selfId, getUnread]);

  const friendsWithoutThread = useMemo(() => {
    if (tab !== 'all') return [];
    return friends.filter((f) => !hasThread(f.id) && (!q || f.name.toLowerCase().includes(q) || (f.username || '').toLowerCase().includes(q)));
  }, [friends, tab, q, hasThread]);

  const unreadCount = conversations.filter((c) => getUnread(c.id) > 0).length;
  const sharesCount = conversations.filter(conversationHasShares).length;
  const tabs: { key: 'all' | 'unread' | 'shares'; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'shares', label: 'Shares', count: sharesCount },
  ];

  return (
    <div className="social-design social-inbox h-[100dvh] flex flex-col bg-surface relative">
      {/* Floating header — absolute so the list scrolls beneath it while it
          fades; the list's paddingTop clears its measured height. */}
      <motion.header
        ref={headerFade.headerRef}
        style={headerFade.headerStyle}
        className="social-inbox-header absolute top-0 inset-x-0 z-30 px-4 pt-safe-4 pb-2.5 bg-surface/90 backdrop-blur-md border-b border-on-surface/[0.06]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GlassButton
              id="messages-back"
              symbol="chevron.left"
              label="Back"
              onClick={onBack}
              suspended={composeOpen}
              className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
            >
              <ArrowLeft size={18} />
            </GlassButton>
            <h1 className="font-sans font-bold text-[26px] tracking-tight">Messages</h1>
          </div>
          <button onClick={onCompose} className="social-compose-button" aria-label="New message"><SquarePen size={21} strokeWidth={1.7} /></button>
        </div>
        <div className="mt-2.5">
          <SearchField
            glassId={composeOpen ? undefined : 'messages-search'}
            value={query}
            onChange={setQuery}
            placeholder="Search messages and friends"
          />
        </div>
        <div className="social-segments mt-3">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => { homeHaptic(); setTab(t.key); }} aria-pressed={tab === t.key} className={cn('h-9 px-4 rounded-full text-[12.5px] font-bold transition-colors inline-flex items-center gap-1.5', tab === t.key ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface active:bg-on-surface/[0.1]')}>
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
          {loading && <ConvListSkeleton />}
          {filteredConvs.map((c) => (
            <MobileConvRow key={c.id} conv={c} profiles={profiles} selfId={selfId} unread={getUnread(c.id)} onClick={() => onOpenConversation(c.id)} />
          ))}
          {friendsWithoutThread.length > 0 && <p className="social-section-label">Start a conversation</p>}
          {friendsWithoutThread.map((f) => (
            <MobileFriendRow key={f.id} friend={f} expert={!!profiles[f.id]?.is_verified} onClick={() => onOpenFriend(f.id)} />
          ))}
        </div>

        {!loading && filteredConvs.length === 0 && friendsWithoutThread.length === 0 && (
          <div className="px-6 py-20 text-center">
            <MessageCircle size={36} className="mx-auto text-on-surface/12 mb-3" />
            <p className="text-[14px] font-semibold text-on-surface/45">{q ? 'No matching conversations' : tab === 'unread' ? 'No unread messages' : tab === 'shares' ? 'No shared cards yet' : 'No conversations yet'}</p>
            {q && <p className="mt-1.5 text-[12.5px] text-on-surface/35 leading-relaxed max-w-[260px] mx-auto">Try a name, a place, or a word from a conversation.</p>}
            {!q && tab === 'all' && (
              <button onClick={onCompose} className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-full active:scale-95 transition-transform"><Plus size={16} /> New message</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Main Messages Page ── */
const MessagesPage: React.FC = () => {
  const { conversations, loading: chatLoading, createConversation, findDirectConversation, getUnreadForConversation } = useChat();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const navigate = useNavigate();
  const goBack = usePageBack('/');

  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const activeConversationId = query.get('conversation');
  const draftFriendId = query.get('to');
  const backToInbox = usePageBack('/messages');
  const openThread = (id: string, draft = false, replace = false) => {
    const search = new URLSearchParams({ [draft ? 'to' : 'conversation']: id });
    navigate(`/messages?${search}`, { replace, state: replace ? { navigationTransition: 'instant' } : null });
  };
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [friends, setFriends] = useState<FriendLite[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});

  // Paint last visit's people before the first frame. ChatContext already
  // restores the threads from its own cache; without the profiles beside
  // them that list renders as a column of "Unknown" until two round trips
  // land. useLayoutEffect rather than useEffect so there's no frame of
  // placeholder for someone whose data is already on disk.
  const hydratedForRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const uid = user?.id;
    if (!uid) { hydratedForRef.current = null; return; }
    if (hydratedForRef.current === uid) return;
    hydratedForRef.current = uid;
    const snap = readViewCache<MessagesSnapshot>(MESSAGES_CACHE, uid);
    if (!snap) return;
    if (snap.profiles) setProfiles((prev) => ({ ...snap.profiles, ...prev }));
    if (snap.friends?.length) setFriends(snap.friends);
  }, [user?.id]);

  // Load friends (and their profiles).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const fl = await getFriends(user.id);
      if (cancelled || fl.length === 0) return;
      const profs = await getProfilesByIds(fl.map((f) => f.friend_id));
      if (cancelled) return;
      setProfiles((prev) => ({ ...prev, ...profs }));
      setFriends(fl.map((f) => ({
        id: f.friend_id,
        name: profs[f.friend_id]?.display_name || profs[f.friend_id]?.username || f.friend_id.slice(0, 8),
        username: profs[f.friend_id]?.username,
        avatar: profs[f.friend_id]?.avatar_url,
      })));
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Load profiles for all conversation participants (and self, for the byline).
  useEffect(() => {
    const allIds = new Set<string>();
    if (user?.id) allIds.add(user.id);
    if (draftFriendId) allIds.add(draftFriendId);
    conversations.forEach((c) => c.participantIds.forEach((id) => allIds.add(id)));
    const missing = Array.from(allIds).filter((id) => !profiles[id]);
    if (missing.length > 0) {
      getProfilesByIds(missing).then((profs) => setProfiles((prev) => ({ ...prev, ...profs })));
    }
  }, [conversations, user?.id, draftFriendId]);

  // Persist the snapshot for the next visit. Debounced past the burst of
  // profile merges the two effects above produce on a cold load.
  useEffect(() => {
    const uid = user?.id;
    if (!uid || hydratedForRef.current !== uid) return;
    if (Object.keys(profiles).length === 0 && friends.length === 0) return;
    const t = setTimeout(() => {
      writeViewCache(MESSAGES_CACHE, uid, { friends, profiles } satisfies MessagesSnapshot);
    }, 600);
    return () => clearTimeout(t);
  }, [friends, profiles, user?.id]);

  // A skeleton is only right when there is genuinely nothing to show. A
  // warm load already has cached threads (or at least the cached friends
  // this list falls back to) on screen, and is only refreshing them.
  const listLoading = chatLoading && conversations.length === 0 && friends.length === 0;

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
      openThread(sortedConversations[0].id, false, true);
    }
  }, [phoneMode, sortedConversations, activeConversationId, draftFriendId]);

  const selectConversation = (id: string) => openThread(id);
  const selectFriend = (friendId: string) => {
    const existing = findDirectConversation(friendId);
    if (existing) openThread(existing.id);
    else openThread(friendId, true);
  };

  // Deep link from a profile's "Message" button: navigate('/messages',
  // { state: { openUserId } }) lands directly in that person's thread
  // (drafting one if it doesn't exist) instead of dumping the user on the
  // list to re-find them. State is consumed once and cleared so back/
  // refresh doesn't re-trigger the jump.
  const openUserId = (location.state as { openUserId?: string } | null)?.openUserId;
  useEffect(() => {
    if (!openUserId) return;
    autoSelectedRef.current = true; // beat the open-most-recent auto-select
    const existing = findDirectConversation(openUserId);
    openThread(existing?.id || openUserId, !existing, true);
    // The target may not be a friend/participant yet — make sure the chat
    // header can show their name instead of "New message".
    getProfilesByIds([openUserId]).then((profs) => setProfiles((prev) => ({ ...prev, ...profs })));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUserId]);
  const clearSelection = () => phoneMode ? backToInbox() : navigate('/messages', { replace: true });
  const onConversationCreated = (id: string) => openThread(id, false, true);

  // Compose sheet: 1:1 → open (draft if new); group → create immediately.
  const handleCreateChat = (participantIds: string[], name?: string) => {
    if (!name && participantIds.length === 1) { selectFriend(participantIds[0]); return; }
    const conv = createConversation(participantIds, name);
    selectConversation(conv.id);
  };

  /* ═══ Desktop: persistent two-pane ═══ */
  if (!phoneMode) {
    return (
      <div className="social-design h-screen flex bg-surface overflow-hidden">
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
          loading={listLoading}
        />
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {activeConversation ? (
            <ChatView key={activeConversation.id} conversation={activeConversation} profiles={profiles} onBack={clearSelection} />
          ) : draftFriendId ? (
            <ChatView key={draftFriendId} draftFriendId={draftFriendId} profiles={profiles} onBack={clearSelection} onConversationCreated={onConversationCreated} />
          ) : (
            <DesktopEmptyChat onCompose={() => setNewChatOpen(true)} />
          )}
        </div>
        <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} onCreateChat={handleCreateChat} friends={friends} />
      </div>
    );
  }

  /* ═══ Mobile: single-pane list ↔ thread ═══ */
  if (activeConversationId && !activeConversation) {
    return <div className="social-design min-h-screen bg-surface px-5 pt-safe-4">
      <GlassButton id="conversation-back" symbol="chevron.left" label="Back" onClick={backToInbox}
        className="w-11 h-11 rounded-full grid place-items-center"><ArrowLeft size={21} /></GlassButton>
      <div className="py-16 text-center text-on-surface/60" role="status">
        {chatLoading ? <span className="inline-block h-6 w-6 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" aria-label="Loading conversation" /> : 'This conversation is unavailable.'}
      </div>
    </div>;
  }

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
        className="social-design social-thread-page flex flex-col bg-surface"
        style={{ height: 'var(--app-vh, 100dvh)', transition: 'height 0.25s cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        {activeConversation ? (
          <ChatView key={activeConversation.id} conversation={activeConversation} profiles={profiles} onBack={clearSelection} />
        ) : (
          <ChatView key={draftFriendId} draftFriendId={draftFriendId!} profiles={profiles} onBack={clearSelection} onConversationCreated={onConversationCreated} />
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
        onBack={() => goBack()}
        loading={listLoading}
        composeOpen={newChatOpen}
      />
      <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} onCreateChat={handleCreateChat} friends={friends} />
    </>
  );
};

export const Messages: React.FC = () => <MotionConfig reducedMotion="user"><MessagesPage /></MotionConfig>;
