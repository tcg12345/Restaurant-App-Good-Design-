import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, X, Star, Heart, MessageCircle, ChevronRight, Bookmark } from 'lucide-react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';

/* ── Mock Data ── */

interface PendingRequest {
  id: string;
  name: string;
  role: string;
  image: string;
}

interface Curator {
  id: string;
  name: string;
  badge: string;
  badgeColor: string;
  specialty: string;
  image: string;
  followed: boolean;
}

interface FeedItem {
  id: string;
  type: 'list_add' | 'review';
  userName: string;
  userImage: string;
  restaurantId: string;
  restaurantName: string;
  restaurantImage: string;
  restaurantCuisine: string;
  restaurantPrice: string;
  restaurantDescription?: string;
  // For list_add
  listName?: string;
  // For review
  rating?: number;
  reviewText?: string;
  reviewPhotos?: string[];
  // Engagement
  likes: number;
  comments: number;
  timeAgo: string;
}

const PENDING_REQUESTS: PendingRequest[] = [
  { id: 'req-1', name: 'Marco V.', role: 'Pastry Chef in Milan', image: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=200' },
  { id: 'req-2', name: 'Priya S.', role: 'Food Blogger in NYC', image: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&q=80&w=200' },
];

const CURATORS: Curator[] = [
  {
    id: 'cur-1', name: 'Elena S.', badge: 'Michelin Guide Veteran', badgeColor: 'text-green-600',
    specialty: 'Specializes in Nordic Cuisine',
    image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200',
    followed: false,
  },
  {
    id: 'cur-2', name: 'Julian Thorne', badge: 'Rising Star', badgeColor: 'text-green-600',
    specialty: 'Street Food specialist',
    image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=200',
    followed: false,
  },
  {
    id: 'cur-3', name: 'Amara Obi', badge: 'Local Expert', badgeColor: 'text-green-600',
    specialty: 'West African & Fusion',
    image: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=200',
    followed: false,
  },
];

const FEED_ITEMS: FeedItem[] = [
  {
    id: 'feed-1', type: 'list_add',
    userName: 'Leo', userImage: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
    restaurantId: 'feed-r1', restaurantName: 'Chez Panisse', restaurantImage: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=600',
    restaurantCuisine: 'French', restaurantPrice: '$$$',
    restaurantDescription: "Berkeley's legendary farm-to-table destination where seasonal ingredients shine...",
    listName: 'wishlist',
    likes: 12, comments: 3, timeAgo: '2h ago',
  },
  {
    id: 'feed-2', type: 'review',
    userName: 'Sophie', userImage: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=200',
    restaurantId: 'feed-r2', restaurantName: 'Atoboy', restaurantImage: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=600',
    restaurantCuisine: 'Korean', restaurantPrice: '$$$',
    rating: 5,
    reviewText: 'The fried chicken with spicy peanut sauce is transcendental. Every banchan was a symphony of flavors I didn\'t know could exist together.',
    reviewPhotos: [
      'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=300',
      'https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?auto=format&fit=crop&q=80&w=300',
      'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&q=80&w=300',
    ],
    likes: 45, comments: 11, timeAgo: '5h ago',
  },
  {
    id: 'feed-3', type: 'list_add',
    userName: 'Marcus', userImage: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    restaurantId: 'feed-r3', restaurantName: 'Via Carota', restaurantImage: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=600',
    restaurantCuisine: 'Italian', restaurantPrice: '$$$',
    restaurantDescription: 'A charming West Village gem serving rustic Italian dishes with impeccable seasonal ingredients.',
    listName: 'Date Nights',
    likes: 8, comments: 1, timeAgo: '8h ago',
  },
  {
    id: 'feed-4', type: 'review',
    userName: 'Emily', userImage: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&q=80&w=200',
    restaurantId: 'feed-r4', restaurantName: 'Tatiana by Kwame', restaurantImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=600',
    restaurantCuisine: 'Caribbean', restaurantPrice: '$$$',
    rating: 4.5,
    reviewText: 'An absolute showstopper. The jollof rice and suya-spiced lamb are unlike anything else in the city right now.',
    reviewPhotos: [
      'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=300',
      'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&q=80&w=300',
    ],
    likes: 32, comments: 7, timeAgo: '1d ago',
  },
];

/* ── Pending Requests ── */
const PendingRequests: React.FC = () => {
  const [requests, setRequests] = useState(PENDING_REQUESTS);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (requests.length === 0) return null;

  const handleAccept = (id: string) => setDismissed((prev) => new Set(prev).add(id));
  const handleDecline = (id: string) => setRequests((prev) => prev.filter((r) => r.id !== id));

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-serif font-bold">Pending Requests</h2>
        <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
          {requests.filter((r) => !dismissed.has(r.id)).length}
        </span>
      </div>
      <div className="space-y-3">
        {requests.map((req) => (
          <div key={req.id} className="flex items-center gap-3 bg-white rounded-2xl p-3 border border-on-surface/8 shadow-sm">
            <img src={req.image} alt={req.name} className="w-12 h-12 rounded-full object-cover" referrerPolicy="no-referrer" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{req.name}</p>
              <p className="text-[11px] text-on-surface/40">{req.role}</p>
            </div>
            {dismissed.has(req.id) ? (
              <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Accepted</span>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAccept(req.id)}
                  className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center"
                >
                  <Check size={14} strokeWidth={3} />
                </button>
                <button
                  onClick={() => handleDecline(req.id)}
                  className="w-8 h-8 rounded-full bg-on-surface/5 text-on-surface/40 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

/* ── Discover Curators ── */
const DiscoverCurators: React.FC = () => {
  const [curators, setCurators] = useState(CURATORS);

  const toggleFollow = (id: string) => {
    setCurators((prev) => prev.map((c) => c.id === id ? { ...c, followed: !c.followed } : c));
  };

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-serif font-bold">Discover Curators</h2>
      </div>
      <div className="space-y-3">
        {curators.map((curator) => (
          <div key={curator.id} className="bg-white rounded-2xl p-4 border border-on-surface/8 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <img src={curator.image} alt={curator.name} className="w-12 h-12 rounded-full object-cover" referrerPolicy="no-referrer" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">{curator.name}</p>
                <p className={cn("text-[11px] font-semibold flex items-center gap-1", curator.badgeColor)}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                  {curator.badge}
                </p>
                <p className="text-xs text-on-surface/40 mt-0.5">{curator.specialty}</p>
              </div>
            </div>
            <button
              onClick={() => toggleFollow(curator.id)}
              className={cn(
                "w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border-2 transition-all",
                curator.followed
                  ? "bg-primary/5 border-primary/20 text-primary"
                  : "bg-white border-on-surface/10 text-on-surface/60 hover:border-primary hover:text-primary"
              )}
            >
              {curator.followed ? 'Following' : 'Follow Curator'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

/* ── Feed Item: List Add ── */
const ListAddCard: React.FC<{ item: FeedItem }> = ({ item }) => (
  <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden">
    {/* Attribution header */}
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <img src={item.userImage} alt={item.userName} className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
      <p className="text-sm text-on-surface/70">
        <span className="font-bold text-on-surface">{item.userName}</span>
        {' added '}
        <span className="font-serif font-bold italic text-primary">{item.restaurantName}</span>
        {' to '}
        {item.listName === 'wishlist' ? 'his wishlist' : (
          <span className="font-semibold">{item.listName}</span>
        )}
      </p>
    </div>

    {/* Restaurant card */}
    <div className="px-4 pb-3">
      <Link to={`/restaurant/${item.restaurantId}`} className="block">
        <div className="rounded-xl overflow-hidden border border-on-surface/8">
          <img src={item.restaurantImage} alt={item.restaurantName} className="w-full h-40 object-cover" referrerPolicy="no-referrer" />
          <div className="p-3">
            <div className="flex items-center justify-between">
              <h4 className="font-serif font-bold text-base">{item.restaurantName}</h4>
              <div className="flex items-center gap-0.5 text-primary">
                <Star size={12} className="fill-primary" />
                <Star size={12} className="fill-primary" />
                <Star size={12} className="fill-primary" />
              </div>
            </div>
            {item.restaurantDescription && (
              <p className="text-xs text-on-surface/50 mt-1 line-clamp-2">{item.restaurantDescription}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-on-surface/40 font-semibold uppercase tracking-wider">
                {item.restaurantCuisine} · {item.restaurantPrice}
              </span>
              <span className="text-xs font-bold text-primary flex items-center gap-0.5">
                View Details <ChevronRight size={12} />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>

    {/* Engagement */}
    <div className="flex items-center gap-5 px-4 pb-3">
      <button className="flex items-center gap-1.5 text-on-surface/40 hover:text-primary transition-colors">
        <Heart size={16} />
        <span className="text-xs font-semibold">{item.likes}</span>
      </button>
      <button className="flex items-center gap-1.5 text-on-surface/40 hover:text-primary transition-colors">
        <MessageCircle size={16} />
        <span className="text-xs font-semibold">{item.comments}</span>
      </button>
      <span className="text-[10px] text-on-surface/25 ml-auto">{item.timeAgo}</span>
    </div>
  </div>
);

/* ── Feed Item: Review ── */
const ReviewCard: React.FC<{ item: FeedItem }> = ({ item }) => (
  <div className="bg-white rounded-2xl border border-on-surface/8 shadow-sm overflow-hidden">
    {/* Attribution header */}
    <div className="flex items-center gap-2 px-4 pt-4 pb-2">
      <img src={item.userImage} alt={item.userName} className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
      <p className="text-sm text-on-surface/70">
        <span className="font-bold text-on-surface">{item.userName}</span>
        {' posted a new review for '}
        <span className="font-serif font-bold italic text-primary">{item.restaurantName}</span>
      </p>
    </div>

    {/* Review body */}
    <div className="mx-4 mb-3 rounded-xl border-l-4 border-primary/30 bg-primary/[0.03] p-4">
      {/* Stars */}
      {item.rating && (
        <div className="flex items-center gap-0.5 mb-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={14}
              className={i < Math.floor(item.rating!) ? 'fill-primary text-primary' : 'text-on-surface/15'}
            />
          ))}
        </div>
      )}
      <p className="text-sm text-on-surface/70 italic leading-relaxed">
        "{item.reviewText}"
      </p>

      {/* Review photos */}
      {item.reviewPhotos && item.reviewPhotos.length > 0 && (
        <div className="flex gap-2 mt-3">
          {item.reviewPhotos.map((photo, i) => (
            <img
              key={i}
              src={photo}
              alt={`Review photo ${i + 1}`}
              className="w-16 h-16 rounded-lg object-cover"
              referrerPolicy="no-referrer"
            />
          ))}
        </div>
      )}
    </div>

    {/* Engagement */}
    <div className="flex items-center gap-5 px-4 pb-3">
      <button className="flex items-center gap-1.5 text-on-surface/40 hover:text-primary transition-colors">
        <Heart size={16} />
        <span className="text-xs font-semibold">{item.likes}</span>
      </button>
      <button className="flex items-center gap-1.5 text-on-surface/40 hover:text-primary transition-colors">
        <MessageCircle size={16} />
        <span className="text-xs font-semibold">{item.comments}</span>
      </button>
      <span className="text-[10px] text-on-surface/25 ml-auto">{item.timeAgo}</span>
    </div>
  </div>
);

/* ── Main Feed Component ── */
export const SocialFeed: React.FC = () => {
  const [activityFilter, setActivityFilter] = useState<'all' | 'recent'>('recent');

  return (
    <div className="mt-4">
      {/* Pending Requests */}
      <PendingRequests />

      {/* Discover Curators */}
      <DiscoverCurators />

      {/* Friend Activity */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-serif font-bold">Friend<br/>Activity</h2>
          <div className="flex gap-2">
            {(['all', 'recent'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setActivityFilter(f)}
                className={cn(
                  "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border transition-all",
                  activityFilter === f
                    ? "bg-on-surface text-white border-on-surface"
                    : "bg-white border-on-surface/15 text-on-surface/40"
                )}
              >
                {f === 'all' ? 'All' : 'Recent'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {FEED_ITEMS.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.3 }}
            >
              {item.type === 'list_add' ? (
                <ListAddCard item={item} />
              ) : (
                <ReviewCard item={item} />
              )}
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
};
