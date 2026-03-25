import React from 'react';
import { TopBar } from '../components/TopBar';
import { motion } from 'motion/react';
import { Users, UserPlus, Search, ChevronRight, MessageSquare, Heart, Star } from 'lucide-react';

const FRIENDS = [
  { id: '1', name: 'Alex Rivera', image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200', activity: 'Rated Lumière Gastronomie 5.0' },
  { id: '2', name: 'Sarah Jenkins', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200', activity: 'Added Sakura Zen to Wishlist' },
  { id: '3', name: 'David Chen', image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200', activity: 'Visited The Alchemist Table' },
];

export const Circle: React.FC = () => {
  return (
    <div className="pb-32">
      <TopBar title="The Social Circle" />
      
      <main className="px-3">
        <section className="mb-12">
          <div className="relative mb-8">
            <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
              <Search size={20} />
            </div>
            <input
              type="text"
              placeholder="Find friends or curators..."
              className="w-full bg-white rounded-2xl py-4 pl-12 pr-4 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold">Pending Requests</h2>
            <span className="w-6 h-6 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">2</span>
          </div>
          
          <div className="space-y-4 mb-12">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white shadow-sm border border-muted">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted overflow-hidden">
                    <img
                      src={`https://ui-avatars.com/api/?name=User+${i}&background=random`}
                      alt="User"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">Marcus Thorne</h4>
                    <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Wants to join your circle</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="px-4 py-1.5 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-widest">Accept</button>
                  <button className="px-4 py-1.5 rounded-full bg-muted text-on-surface/40 text-[10px] font-bold uppercase tracking-widest">Decline</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-serif font-bold">Circle Activity</h2>
            <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              See All <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="space-y-8">
            {FRIENDS.map((friend) => (
              <motion.div
                key={friend.id}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="flex gap-4"
              >
                <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 shadow-lg">
                  <img
                    src={friend.image}
                    alt={friend.name}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-bold text-sm">{friend.name}</h4>
                    <span className="text-[10px] text-on-surface/40 uppercase tracking-widest">2h ago</span>
                  </div>
                  <p className="text-sm text-on-surface/60 mb-4">{friend.activity}</p>
                  
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-muted flex gap-4">
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                      <img
                        src="https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=200"
                        alt="Restaurant"
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="flex-1 flex flex-col justify-center">
                      <h5 className="font-serif font-bold text-sm">Lumière Gastronomie</h5>
                      <div className="flex items-center gap-1 text-primary mt-1">
                        <Star size={10} className="fill-primary" />
                        <span className="text-[10px] font-bold">4.9</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-6 text-on-surface/40">
                    <button className="flex items-center gap-2 hover:text-primary transition-colors">
                      <Heart size={16} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Like</span>
                    </button>
                    <button className="flex items-center gap-2 hover:text-primary transition-colors">
                      <MessageSquare size={16} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Comment</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      </main>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-24 right-6 bg-secondary text-white p-5 rounded-full shadow-2xl z-40"
      >
        <UserPlus size={24} />
      </motion.button>
    </div>
  );
};
