import React from 'react';
import { TopBar } from '../components/TopBar';
import { RestaurantCard } from '../components/RestaurantCard';
import { motion } from 'motion/react';
import { Heart, Star, Bookmark, ChevronRight, Grid, List } from 'lucide-react';

const PANTRY_ITEMS = [
  {
    id: '1',
    name: 'Lumière Gastronomie',
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=800',
    rating: 4.9,
    price: '$$$$',
    cuisine: 'Modern French',
    distance: '0.8 mi',
  },
  {
    id: '2',
    name: 'The Alchemist Table',
    image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=800',
    rating: 4.7,
    price: '$$$',
    cuisine: 'Molecular',
    distance: '1.2 mi',
  },
];

export const Pantry: React.FC = () => {
  return (
    <div className="pb-32">
      <TopBar title="Personal Pantry" />
      
      <main className="px-6">
        <section className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-serif font-bold">Collections</h2>
            <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              New Collection <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
            {['Date Nights', 'Hidden Gems', 'Best Cocktails', 'Quick Bites'].map((list) => (
              <motion.button
                key={list}
                whileHover={{ y: -5 }}
                className="flex-shrink-0 w-40 h-48 rounded-3xl bg-secondary/10 p-6 flex flex-col justify-between group hover:bg-secondary hover:text-white transition-all duration-500"
              >
                <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-secondary shadow-sm group-hover:text-primary transition-colors">
                  <Bookmark size={20} />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-lg mb-1">{list}</h4>
                  <p className="text-[10px] uppercase tracking-widest opacity-60">12 items</p>
                </div>
              </motion.button>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-serif font-bold">Rated Spots</h2>
            <div className="flex items-center gap-4 text-on-surface/40">
              <button className="p-2 hover:text-primary transition-colors">
                <Grid size={18} />
              </button>
              <button className="p-2 hover:text-primary transition-colors">
                <List size={18} />
              </button>
            </div>
          </div>
          
          <div className="space-y-8">
            {PANTRY_ITEMS.map((item) => (
              <div key={item.id} className="flex gap-6 group cursor-pointer">
                <div className="w-32 h-32 rounded-3xl overflow-hidden flex-shrink-0 shadow-lg">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 py-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-serif font-bold text-xl">{item.name}</h3>
                      <div className="flex items-center gap-1 text-primary">
                        <Star size={14} className="fill-primary" />
                        <span className="text-sm font-bold">{item.rating}</span>
                      </div>
                    </div>
                    <p className="text-xs text-on-surface/40 font-medium uppercase tracking-wider mb-2">{item.cuisine} • {item.price}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary font-bold uppercase tracking-wider">Top Rated</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-on-surface/40">
                    <button className="text-[10px] font-bold uppercase tracking-widest hover:text-primary transition-colors">Edit Review</button>
                    <button className="text-[10px] font-bold uppercase tracking-widest hover:text-primary transition-colors">Share</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-24 right-6 bg-primary text-white p-5 rounded-full shadow-2xl z-40"
      >
        <Heart size={24} />
      </motion.button>
    </div>
  );
};
