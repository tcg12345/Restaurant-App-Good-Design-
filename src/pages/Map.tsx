import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, MapPin, ChevronUp, Star, Heart, Navigation } from 'lucide-react';
import { cn } from '../lib/utils';

const MOCK_MARKERS = [
  { id: '1', name: 'Lumière', lat: 40.7128, lng: -74.0060, rating: 4.9, price: '$$$$' },
  { id: '2', name: 'Alchemist', lat: 40.7282, lng: -73.9942, rating: 4.7, price: '$$$' },
  { id: '3', name: 'Sakura Zen', lat: 40.7589, lng: -73.9851, rating: 4.8, price: '$$$$' },
];

export const Map: React.FC = () => {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-muted">
      {/* Mock Map Background */}
      <div className="absolute inset-0 bg-[#e5e1e0] overflow-hidden">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#1e1b1a" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        
        {/* Mock Markers */}
        {MOCK_MARKERS.map((marker) => (
          <motion.button
            key={marker.id}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.2 }}
            onClick={() => setSelectedMarker(marker.id)}
            className={cn(
              "absolute p-3 rounded-full shadow-xl transition-all duration-300",
              selectedMarker === marker.id ? "bg-primary text-white z-20" : "bg-white text-on-surface z-10"
            )}
            style={{
              top: `${20 + Math.random() * 60}%`,
              left: `${20 + Math.random() * 60}%`,
            }}
          >
            <MapPin size={24} fill={selectedMarker === marker.id ? "white" : "transparent"} />
            {selectedMarker === marker.id && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 glass px-4 py-2 rounded-2xl whitespace-nowrap shadow-2xl"
              >
                <p className="text-sm font-serif font-bold text-on-surface">{marker.name}</p>
                <div className="flex items-center gap-2 text-[10px] font-bold text-primary mt-1">
                  <Star size={10} className="fill-primary" />
                  <span>{marker.rating}</span>
                  <span className="text-on-surface/40">•</span>
                  <span>{marker.price}</span>
                </div>
              </motion.div>
            )}
          </motion.button>
        ))}
      </div>

      {/* Top Search Overlay */}
      <div className="absolute top-6 left-6 right-6 z-30">
        <div className="glass rounded-full px-6 py-4 flex items-center gap-4 shadow-2xl border border-white/20">
          <Search size={20} className="text-on-surface/40" />
          <input
            type="text"
            placeholder="Search the map..."
            className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
          />
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-on-surface/60">
            <Filter size={16} />
          </div>
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="absolute right-6 top-24 flex flex-col gap-4 z-30">
        <button className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors">
          <Navigation size={20} />
        </button>
        <button className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors">
          <Heart size={20} />
        </button>
      </div>

      {/* Bottom Sheet */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.y < -50) setIsSheetOpen(true);
          if (info.offset.y > 50) setIsSheetOpen(false);
        }}
        animate={{ y: isSheetOpen ? 0 : 'calc(100% - 120px)' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="absolute bottom-0 left-0 right-0 glass rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 border-t border-white/40"
      >
        <div className="w-full flex flex-col items-center pt-4 pb-8 cursor-grab active:cursor-grabbing">
          <div className="w-12 h-1.5 bg-on-surface/10 rounded-full mb-6" />
          <div className="px-8 w-full">
            <div className="flex items-center justify-between mb-8">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">For Your Palette</p>
                <h2 className="text-2xl font-serif font-bold">Nearby Curations</h2>
              </div>
              <button
                onClick={() => setIsSheetOpen(!isSheetOpen)}
                className="p-2 rounded-full bg-muted text-on-surface/40"
              >
                <ChevronUp className={cn("transition-transform duration-500", isSheetOpen && "rotate-180")} />
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto max-h-[60vh] pb-12 no-scrollbar">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-4 group cursor-pointer">
                  <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0">
                    <img
                      src={`https://images.unsplash.com/photo-${1500000000000 + i}?auto=format&fit=crop&q=80&w=200`}
                      alt="Restaurant"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 py-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-serif font-bold text-lg">Lumière Gastronomie</h3>
                      <div className="flex items-center gap-1 text-primary">
                        <Star size={12} className="fill-primary" />
                        <span className="text-xs font-bold">4.9</span>
                      </div>
                    </div>
                    <p className="text-xs text-on-surface/40 font-medium uppercase tracking-wider mb-2">Modern French • $$$$</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-wider">Michelin</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary font-bold uppercase tracking-wider">Top Rated</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const Filter = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="2" y1="14" x2="6" y2="14" />
    <line x1="10" y1="8" x2="14" y2="8" />
    <line x1="18" y1="16" x2="22" y2="16" />
  </svg>
);
