import React from 'react';
import { TopBar } from '../components/TopBar';
import { ExpertCard } from '../components/ExpertCard';
import { motion } from 'motion/react';
import { Edit3, ChevronRight, Star, Quote } from 'lucide-react';

const EXPERTS = [
  {
    name: 'Elena Vance',
    role: 'Senior Critic',
    image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400',
    stats: '1.2k Reviews • 45k Followers',
  },
  {
    name: 'Marcus Thorne',
    role: 'Sommelier',
    image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400',
    stats: '850 Reviews • 12k Followers',
  },
  {
    name: 'Sofia Rossi',
    role: 'Chef de Cuisine',
    image: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=400',
    stats: '2.1k Reviews • 88k Followers',
  },
  {
    name: 'Julian Chen',
    role: 'Food Photographer',
    image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=400',
    stats: '500 Reviews • 150k Followers',
  },
];

const RECENT_REVIEWS = [
  {
    id: '1',
    expert: 'Elena Vance',
    restaurant: 'Lumière Gastronomie',
    rating: 4.9,
    comment: 'The truffle-infused reduction is a masterclass in balance. A definitive must-visit this season.',
    date: '2 days ago',
  },
  {
    id: '2',
    expert: 'Marcus Thorne',
    restaurant: 'The Alchemist Table',
    rating: 4.5,
    comment: 'The wine pairing for the third course was unexpected but brilliant. A bold choice that paid off.',
    date: '5 days ago',
  },
];

export const Experts: React.FC = () => {
  return (
    <div className="pb-32">
      <TopBar title="Tastemakers" />
      
      <main className="px-6">
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold">Meet the Experts</h2>
            <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
              See All <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            {EXPERTS.map((expert, index) => (
              <ExpertCard key={expert.name} {...expert} />
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-serif font-bold mb-8">Latest Expert Reviews</h2>
          <div className="space-y-8">
            {RECENT_REVIEWS.map((review) => (
              <motion.div
                key={review.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="relative bg-white rounded-3xl p-8 shadow-sm border border-muted"
              >
                <div className="absolute -top-4 -left-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white shadow-xl">
                  <Quote size={20} />
                </div>
                
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted overflow-hidden">
                      <img
                        src={`https://ui-avatars.com/api/?name=${review.expert}&background=random`}
                        alt={review.expert}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{review.expert}</h4>
                      <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">{review.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-primary">
                    <Star size={14} className="fill-primary" />
                    <span className="text-sm font-bold">{review.rating}</span>
                  </div>
                </div>

                <h3 className="font-serif text-xl font-bold mb-3">{review.restaurant}</h3>
                <p className="text-sm text-on-surface/60 leading-relaxed italic">
                  "{review.comment}"
                </p>
                
                <button className="mt-6 w-full py-3 rounded-xl bg-muted text-on-surface/60 text-xs font-bold uppercase tracking-widest hover:bg-primary hover:text-white transition-all">
                  Read Full Review
                </button>
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
        <Edit3 size={24} />
      </motion.button>
    </div>
  );
};
