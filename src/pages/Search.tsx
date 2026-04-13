import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { TopBar } from '../components/TopBar';

export const Search: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <TopBar title="Search" />
      <main className="px-4 pt-2">
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
      </main>
    </div>
  );
};
