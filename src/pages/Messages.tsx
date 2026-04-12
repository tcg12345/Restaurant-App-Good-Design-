import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Send, Search, X, Users, Check, MessageCircle, ChevronRight, Star, MapPin, Trash2, Share2, ChefHat, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { useChat, type Conversation, type SharedRestaurant, type SharedRecipe } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type RestaurantRating, type RestaurantMeta } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import { getFriends, getProfilesByIds, type UserProfile } from '../lib/supabase-community';

/* ── Restaurant Share Card ── */
const RestaurantShareCard: React.FC<{
  restaurant: SharedRestaurant;
  onClick?: () => void;
}> = ({ restaurant, onClick }) => {
  const scoreColor = (restaurant.score ?? 0) >= 8 ? 'text-green-500' : (restaurant.score ?? 0) >= 5 ? 'text-yellow-500' : 'text-red-400';

  return (
    <button onClick={onClick} className="w-full max-w-[280px] bg-white border border-on-surface/10 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all text-left">
      {restaurant.image && (
        <div className="w-full h-28 overflow-hidden">
          <img src={restaurant.image} alt={restaurant.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface/80 truncate">{restaurant.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {restaurant.cuisine && <span className="text-[11px] text-on-surface/40">{restaurant.cuisine}</span>}
              {restaurant.price && <span className="text-[11px] text-on-surface/30">{restaurant.price}</span>}
            </div>
          </div>
          {restaurant.isReview && restaurant.score !== undefined && (
            <div className="flex-shrink-0 text-right">
              <span className={cn("text-lg font-serif font-bold tabular-nums", scoreColor)}>{restaurant.score.toFixed(1)}</span>
              <p className="text-[8px] text-on-surface/30 font-medium">/10</p>
            </div>
          )}
        </div>
        {restaurant.address && (
          <div className="flex items-center gap-1 mt-1.5">
            <MapPin size={10} className="text-on-surface/25 flex-shrink-0" />
            <span className="text-[10px] text-on-surface/35 truncate">{restaurant.address}</span>
          </div>
        )}
        {restaurant.isReview && restaurant.notes && (
          <p className="text-[11px] text-on-surface/40 mt-1.5 line-clamp-2 leading-relaxed">"{restaurant.notes}"</p>
        )}
        {restaurant.isReview && restaurant.tags && restaurant.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {restaurant.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 bg-primary/5 text-primary text-[9px] font-semibold rounded-full">{tag}</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 mt-2 text-primary">
          <span className="text-[10px] font-semibold">{restaurant.isReview ? 'View Review' : 'View Details'}</span>
          <ChevronRight size={10} />
        </div>
      </div>
    </button>
  );
};

/* ── Recipe Share Card ── */
const RecipeShareCard: React.FC<{
  recipe: SharedRecipe;
  onClick?: () => void;
}> = ({ recipe, onClick }) => {
  const totalLabel = recipe.totalTime && recipe.totalTime > 0
    ? (recipe.totalTime < 60 ? `${recipe.totalTime}m` : `${Math.floor(recipe.totalTime / 60)}h ${recipe.totalTime % 60 ? `${recipe.totalTime % 60}m` : ''}`.trim())
    : '';
  return (
    <button onClick={onClick} className="w-full max-w-[280px] bg-gradient-to-br from-emerald-50/60 to-white border border-emerald-200/50 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all text-left">
      {recipe.image && (
        <div className="w-full h-28 overflow-hidden">
          <img src={recipe.image} alt={recipe.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <ChefHat size={12} className="text-emerald-600" />
          <span className="text-[10px] font-semibold text-emerald-700/70 uppercase tracking-wider">{recipe.authorName}&rsquo;s recipe</span>
        </div>
        <p className="text-sm font-serif font-bold text-on-surface/85 truncate">{recipe.name}</p>
        {recipe.description && (
          <p className="text-[11px] text-on-surface/45 mt-0.5 line-clamp-1 leading-snug italic">{recipe.description}</p>
        )}
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {totalLabel && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700/80 bg-emerald-100 px-1.5 py-0.5 rounded-full">
              <Clock size={9} /> {totalLabel}
            </span>
          )}
          {recipe.difficulty && (
            <span className="text-[9px] font-semibold text-on-surface/40 bg-on-surface/5 px-1.5 py-0.5 rounded-full">{recipe.difficulty}</span>
          )}
          {(recipe.ingredientCount ?? 0) > 0 && (
            <span className="text-[9px] text-on-surface/40">{recipe.ingredientCount} ingredients</span>
          )}
        </div>
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {recipe.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[9px] font-semibold rounded-full">{tag}</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 mt-2 text-emerald-600">
          <span className="text-[10px] font-semibold">View Recipe</span>
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
                    const scoreColor = r.score >= 8 ? 'text-green-500' : r.score >= 5 ? 'text-yellow-500' : 'text-red-400';
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
                        <span className={cn("text-sm font-serif font-bold tabular-nums mr-1", scoreColor)}>{r.score.toFixed(1)}</span>
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

/* ── Chat View (individual conversation) ── */
const ChatView: React.FC<{
  conversation: Conversation;
  profiles: Record<string, UserProfile>;
  onBack: () => void;
}> = ({ conversation, profiles, onBack }) => {
  const { sendMessage, markRead, deleteConversation } = useChat();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingShare, setPendingShare] = useState<SharedRestaurant | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    markRead(conversation.id);
  }, [conversation.id, conversation.messages.length, markRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation.messages.length]);

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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-on-surface/6 flex-shrink-0 bg-surface/80 backdrop-blur-md">
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
                <div className={cn("max-w-[80%]", isMe ? "items-end" : "items-start")}>
                  {showSender && (
                    <p className="text-[10px] font-semibold text-on-surface/40 mb-0.5 px-1">{getParticipantName(msg.senderId)}</p>
                  )}
                  {(msg.sharedRestaurant || msg.sharedRecipe) ? (
                    <div className={cn("rounded-2xl overflow-hidden", isMe ? "rounded-br-md" : "rounded-bl-md")}>
                      {msg.text && (
                        <div className={cn("px-3.5 py-2 text-sm", isMe ? "bg-primary text-white" : "bg-on-surface/[0.06] text-on-surface/80")}>
                          {msg.text}
                        </div>
                      )}
                      {msg.sharedRestaurant && (
                        <RestaurantShareCard
                          restaurant={msg.sharedRestaurant}
                          onClick={() => handleRestaurantClick(msg.sharedRestaurant!)}
                        />
                      )}
                      {msg.sharedRecipe && (
                        <RecipeShareCard
                          recipe={msg.sharedRecipe}
                          onClick={() => navigate(`/meal/${msg.sharedRecipe!.authorId}/${msg.sharedRecipe!.mealId}`)}
                        />
                      )}
                    </div>
                  ) : (
                    <div className={cn("px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                      isMe
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-on-surface/[0.06] text-on-surface/80 rounded-bl-md"
                    )}>
                      {msg.text}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
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
                      <span className={cn("text-[10px] font-bold", pendingShare.score >= 8 ? 'text-green-500' : pendingShare.score >= 5 ? 'text-yellow-500' : 'text-red-400')}>
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
                      <p className={cn("text-sm font-semibold truncate", unread > 0 ? "text-on-surface" : "text-on-surface/70")}>{getConversationTitle(conv)}</p>
                      <span className="text-[10px] text-on-surface/30 flex-shrink-0">{formatTime(conv.lastMessageAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className={cn("text-xs truncate", unread > 0 ? "text-on-surface/60 font-medium" : "text-on-surface/35")}>{getLastMessage(conv)}</p>
                      {unread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 bg-primary text-white text-[9px] font-bold rounded-full flex items-center justify-center flex-shrink-0">
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
