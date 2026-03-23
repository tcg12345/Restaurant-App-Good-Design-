import React from 'react';
import { TopBar } from '../components/TopBar';
import { RadarChart } from '../components/RadarChart';
import { Settings, Edit2, Share2, Heart, Star, Bookmark, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';

const TASTE_DATA = [
  { subject: 'Umami', value: 120, fullMark: 150 },
  { subject: 'Sweet', value: 98, fullMark: 150 },
  { subject: 'Sour', value: 86, fullMark: 150 },
  { subject: 'Bitter', value: 99, fullMark: 150 },
  { subject: 'Salty', value: 85, fullMark: 150 },
  { subject: 'Spicy', value: 65, fullMark: 150 },
];

const WISHLIST = [
  { id: '1', name: 'Lumière', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=400' },
  { id: '2', name: 'Alchemist', image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=400' },
  { id: '3', name: 'Sakura Zen', image: 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&q=80&w=400' },
  { id: '4', name: 'Terra & Mare', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=400' },
];

export const Profile: React.FC = () => {
  return (
    <div className="pb-32">
      <TopBar title="My Profile" />
      
      <main className="px-6">
        <section className="flex flex-col items-center mb-12">
          <div className="relative mb-6">
            <div className="w-32 h-32 rounded-full border-4 border-primary p-1">
              <img
                src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=400"
                alt="User"
                className="w-full h-full rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <button className="absolute bottom-0 right-0 p-2 bg-primary text-white rounded-full shadow-xl border-4 border-surface">
              <Edit2 size={16} />
            </button>
          </div>
          
          <h2 className="text-3xl font-serif font-bold mb-2">Julian Thorne</h2>
          <p className="text-sm text-on-surface/40 font-medium uppercase tracking-widest mb-6">Culinary Explorer • Level 12</p>
          
          <div className="flex gap-4">
            <button className="px-6 py-2 rounded-full bg-primary text-white text-xs font-bold uppercase tracking-widest shadow-lg">
              Followers (1.2k)
            </button>
            <button className="px-6 py-2 rounded-full bg-muted text-on-surface/60 text-xs font-bold uppercase tracking-widest">
              Following (450)
            </button>
          </div>
        </section>

        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-muted mb-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">Taste Identity</p>
              <h3 className="text-2xl font-serif font-bold">Your Palate</h3>
            </div>
            <button className="p-3 rounded-full bg-muted text-on-surface/40">
              <Share2 size={18} />
            </button>
          </div>
          
          <RadarChart data={TASTE_DATA} />
          
          <div className="mt-8 grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-serif font-bold text-primary">84</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Ratings</p>
            </div>
            <div className="text-center border-x border-muted">
              <p className="text-2xl font-serif font-bold text-primary">12</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Lists</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-serif font-bold text-primary">45</p>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Badges</p>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold">The Wishlist</h2>
            <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              View All <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {WISHLIST.map((item) => (
              <motion.div
                key={item.id}
                whileHover={{ scale: 1.02 }}
                className="relative aspect-square rounded-3xl overflow-hidden group cursor-pointer"
              >
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  <h4 className="font-serif font-bold text-lg">{item.name}</h4>
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
                    <Bookmark size={10} />
                    <span>Saved</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-serif font-bold mb-6">The Vault</h2>
          <div className="space-y-4">
            {['Date Nights', 'Hidden Gems', 'Best Cocktails'].map((list) => (
              <button
                key={list}
                className="w-full flex items-center justify-between p-6 rounded-3xl bg-muted/50 hover:bg-muted transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-primary shadow-sm">
                    <Star size={20} />
                  </div>
                  <div className="text-left">
                    <h4 className="font-bold text-sm">{list}</h4>
                    <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">12 items • Curated by you</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-on-surface/20 group-hover:text-primary group-hover:translate-x-1 transition-all" />
              </button>
            ))}
          </div>
        </section>
      </main>

      <div className="fixed top-6 right-6 z-50">
        <button className="p-3 glass rounded-full text-on-surface/60 hover:text-primary transition-colors shadow-xl">
          <Settings size={24} />
        </button>
      </div>
    </div>
  );
};
