import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Map as MapIcon } from 'lucide-react';
import { TopBar } from '../components/TopBar';

export const Search: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <TopBar title="Search" />
      <main className="px-4 pt-2 space-y-3">
        <button
          type="button"
          onClick={() => navigate('/search/main')}
          className="w-full relative"
          aria-label="Open search"
        >
          <div className="absolute inset-y-0 left-4 flex items-center text-on-surface/40">
            <SearchIcon size={18} />
          </div>
          <div className="w-full bg-white/60 backdrop-blur-sm rounded-full py-3 pl-11 pr-4 text-sm font-medium text-on-surface/40 text-left border border-on-surface/10">
            Search restaurants, cuisines, lists...
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/map')}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary/5 border border-primary/15 text-left hover:bg-primary/10 transition-colors"
          aria-label="Open map"
        >
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <MapIcon size={18} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-on-surface">Explore on map</p>
            <p className="text-[11px] text-on-surface/50">Browse restaurants by location</p>
          </div>
        </button>
      </main>
    </div>
  );
};
