import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { RadarChart } from '../components/RadarChart';
import { 
  ArrowLeft, 
  Star, 
  MapPin, 
  Clock, 
  Phone, 
  Globe, 
  Heart, 
  Share2, 
  ChevronRight,
  Quote,
  Calendar
} from 'lucide-react';

const TASTE_DATA = [
  { subject: 'Umami', value: 140, fullMark: 150 },
  { subject: 'Sweet', value: 40, fullMark: 150 },
  { subject: 'Sour', value: 110, fullMark: 150 },
  { subject: 'Bitter', value: 130, fullMark: 150 },
  { subject: 'Salty', value: 90, fullMark: 150 },
  { subject: 'Spicy', value: 30, fullMark: 150 },
];

export const RestaurantDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <div className="pb-32 bg-surface min-h-screen">
      {/* Hero Section */}
      <div className="relative h-[60vh] w-full overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=1920"
          alt="Lumière Gastronomie"
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-black/40" />
        
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between z-10">
          <button
            onClick={() => navigate(-1)}
            className="p-3 glass rounded-full text-on-surface shadow-xl"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex gap-4">
            <button className="p-3 glass rounded-full text-on-surface shadow-xl">
              <Share2 size={24} />
            </button>
            <button className="p-3 glass rounded-full text-on-surface shadow-xl">
              <Heart size={24} />
            </button>
          </div>
        </div>

        <div className="absolute bottom-12 left-8 right-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="glass px-4 py-1.5 rounded-full flex items-center gap-2">
              <Star size={16} className="fill-primary text-primary" />
              <span className="text-xs font-bold uppercase tracking-widest text-primary">Michelin Starred</span>
            </div>
            <div className="glass px-4 py-1.5 rounded-full flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-on-surface">$$$$</span>
            </div>
          </div>
          <h1 className="text-5xl font-serif font-bold text-on-surface mb-4 leading-tight">Lumière Gastronomie</h1>
          <div className="flex items-center gap-6 text-on-surface/60">
            <div className="flex items-center gap-2">
              <MapPin size={18} />
              <span className="text-sm font-medium">Upper East Side, NY</span>
            </div>
            <div className="flex items-center gap-2">
              <Star size={18} className="fill-primary text-primary" />
              <span className="text-sm font-bold text-on-surface">4.9 (1.2k Reviews)</span>
            </div>
          </div>
        </div>
      </div>

      <main className="px-8 -mt-8 relative z-20">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full bg-primary text-white py-6 rounded-[2rem] shadow-2xl flex items-center justify-center gap-3 mb-12"
        >
          <Calendar size={24} />
          <span className="text-lg font-bold uppercase tracking-[0.2em]">Reserve a Table</span>
        </motion.button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <div className="lg:col-span-2 space-y-12">
            <section>
              <h2 className="text-3xl font-serif font-bold mb-6">The Experience</h2>
              <p className="text-lg text-on-surface/70 leading-relaxed font-light">
                Lumière Gastronomie is a sanctuary of modern French culinary art. Led by Chef Elena Vance, the kitchen transforms seasonal ingredients into ethereal compositions that challenge the boundaries of flavor and form.
              </p>
            </section>

            <section>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-serif font-bold">Expert Reviews</h2>
                <button className="text-primary text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                  Read All <ChevronRight size={14} />
                </button>
              </div>
              <div className="space-y-6">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-white rounded-3xl p-8 shadow-sm border border-muted relative">
                    <div className="absolute -top-4 -left-4 w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white shadow-xl">
                      <Quote size={20} />
                    </div>
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                        <img src={`https://ui-avatars.com/api/?name=Expert+${i}&background=random`} alt="Expert" />
                      </div>
                      <div>
                        <h4 className="font-bold">Elena Vance</h4>
                        <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">Senior Critic • 2 days ago</p>
                      </div>
                    </div>
                    <p className="text-on-surface/60 italic leading-relaxed">
                      "The truffle-infused reduction is a masterclass in balance. A definitive must-visit this season. The atmosphere is as curated as the menu."
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-3xl font-serif font-bold mb-8">Seasonal Highlights</h2>
              <div className="grid grid-cols-2 gap-6">
                {[
                  { name: 'Oyster & Pearl', price: '$42', image: 'https://images.unsplash.com/photo-1544070078-a212eda27b49?auto=format&fit=crop&q=80&w=400' },
                  { name: 'Truffle Risotto', price: '$58', image: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?auto=format&fit=crop&q=80&w=400' }
                ].map((item) => (
                  <div key={item.name} className="group cursor-pointer">
                    <div className="aspect-square rounded-3xl overflow-hidden mb-4 shadow-lg">
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                    </div>
                    <h4 className="font-serif font-bold text-xl mb-1">{item.name}</h4>
                    <p className="text-primary font-bold">{item.price}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-12">
            <section className="bg-secondary/10 rounded-[2.5rem] p-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary mb-2">Taste Identity</p>
              <h3 className="text-2xl font-serif font-bold mb-6">Flavor Profile</h3>
              <RadarChart data={TASTE_DATA} color="#5c6144" />
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface/40 uppercase tracking-widest">Dominant</span>
                  <span className="font-bold text-secondary italic">Umami</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-on-surface/40 uppercase tracking-widest">Complexity</span>
                  <span className="font-bold text-secondary italic">High</span>
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <h3 className="text-2xl font-serif font-bold">Location & Contact</h3>
              <div className="aspect-video rounded-3xl bg-muted overflow-hidden shadow-inner relative">
                <div className="absolute inset-0 flex items-center justify-center text-on-surface/20">
                  <MapPin size={48} />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-4 text-on-surface/60">
                  <Clock size={20} className="text-primary" />
                  <span className="text-sm font-medium">Open until 11:00 PM</span>
                </div>
                <div className="flex items-center gap-4 text-on-surface/60">
                  <Phone size={20} className="text-primary" />
                  <span className="text-sm font-medium">+1 (212) 555-0198</span>
                </div>
                <div className="flex items-center gap-4 text-on-surface/60">
                  <Globe size={20} className="text-primary" />
                  <span className="text-sm font-medium">lumiereny.com</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};
