import React, { useState } from 'react';
import { TopBar } from '../components/TopBar';
import { RestaurantCard } from '../components/RestaurantCard';
import { RadarChart } from '../components/RadarChart';
import { Search, Filter, Map as MapIcon, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';

const MOCK_RESTAURANTS = [
  {
    id: '1',
    name: 'Lumière Gastronomie',
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=800',
    rating: 4.9,
    price: '$$$$',
    cuisine: 'Modern French',
    distance: '0.8 mi',
    isMichelin: true,
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
  {
    id: '3',
    name: 'Sakura Zen',
    image: 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&q=80&w=800',
    rating: 4.8,
    price: '$$$$',
    cuisine: 'Omakase',
    distance: '2.1 mi',
    isMichelin: true,
  },
  {
    id: '4',
    name: 'Terra & Mare',
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=800',
    rating: 4.6,
    price: '$$',
    cuisine: 'Mediterranean',
    distance: '0.5 mi',
  },
];

const TASTE_DATA = [
  { subject: 'Umami', value: 120, fullMark: 150 },
  { subject: 'Sweet', value: 98, fullMark: 150 },
  { subject: 'Sour', value: 86, fullMark: 150 },
  { subject: 'Bitter', value: 99, fullMark: 150 },
  { subject: 'Salty', value: 85, fullMark: 150 },
  { subject: 'Spicy', value: 65, fullMark: 150 },
];

export const Home: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'general' | 'circle'>('general');

  return (
    <div className="pb-32">
      <TopBar />
      
      <main className="px-6">
        <div className="flex items-center gap-6 mb-8 border-b border-muted">
          <button
            onClick={() => setActiveTab('general')}
            className={`pb-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
              activeTab === 'general' ? 'text-primary' : 'text-on-surface/40'
            }`}
          >
            General Search
            {activeTab === 'general' && (
              <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('circle')}
            className={`pb-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
              activeTab === 'circle' ? 'text-primary' : 'text-on-surface/40'
            }`}
          >
            Circle Activity
            {activeTab === 'circle' && (
              <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>

        <div className="relative mb-8">
          <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
            <Search size={20} />
          </div>
          <input
            type="text"
            placeholder="Search for a flavor, mood, or spot..."
            className="w-full bg-white rounded-2xl py-4 pl-12 pr-12 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
          <button className="absolute inset-y-0 right-4 flex items-center text-primary">
            <Filter size={20} />
          </button>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar mb-8">
          {['Near Me', 'Italian', 'Fine Dining', 'Hidden Gems', 'Outdoor'].map((filter) => (
            <button
              key={filter}
              className="whitespace-nowrap px-6 py-2 rounded-full bg-white text-xs font-bold uppercase tracking-widest border border-muted hover:border-primary hover:text-primary transition-all"
            >
              {filter}
            </button>
          ))}
        </div>

        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold">Curated for You</h2>
            <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              See All <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="stagger-grid">
            {MOCK_RESTAURANTS.map((restaurant, index) => (
              <RestaurantCard
                key={restaurant.id}
                {...restaurant}
                className="stagger-item"
              />
            ))}
          </div>
        </section>

        <section className="bg-secondary/10 rounded-[2rem] p-8 mb-12 overflow-hidden relative">
          <div className="relative z-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary mb-2">Your Circle's Palate</p>
            <h2 className="text-2xl font-serif font-bold mb-6">The Collective Taste</h2>
            <RadarChart data={TASTE_DATA} color="#5c6144" />
            <p className="text-xs text-on-surface/60 mt-6 leading-relaxed">
              Your circle is currently leaning towards <span className="text-secondary font-bold italic">Umami</span> and <span className="text-secondary font-bold italic">Bitter</span> profiles. Explore spots that match this trend.
            </p>
          </div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
        </section>
      </main>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-24 right-6 bg-primary text-white px-6 py-4 rounded-full shadow-2xl flex items-center gap-3 z-40"
      >
        <MapIcon size={20} />
        <span className="text-sm font-bold uppercase tracking-widest">Explore Map</span>
      </motion.button>
    </div>
  );
};
