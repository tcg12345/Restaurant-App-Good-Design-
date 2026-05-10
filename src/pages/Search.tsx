import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Map as MapIcon, ChevronRight } from 'lucide-react';
import { FollowingFeed } from '../components/FollowingFeed';
import { cn } from '../lib/utils';

type SearchTab = 'discover' | 'following';

export const Search: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<SearchTab>('discover');

  return (
    <div className="pb-32 min-h-screen bg-surface">

      {/* Tab switcher */}
      <div className="px-4 pt-5">
        <div className="flex items-center gap-6">
          {([
            ['discover', 'Discover'],
            ['following', 'Following'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'relative py-3 text-sm font-bold tracking-wide transition-colors',
                tab === key ? 'text-on-surface' : 'text-on-surface/40 hover:text-on-surface/60',
              )}
            >
              {label}
              {tab === key && (
                <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 pt-4">
        {tab === 'discover' ? (
          <div className="space-y-3">
            {/* Real input that transitions into the full search page on focus.
                readOnly keeps the mobile keyboard from flashing before the
                route change; the auto-focus on SearchMain brings it up there. */}
            <div className="w-full relative">
              <SearchIcon
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
              />
              <input
                type="text"
                readOnly
                placeholder="Search restaurants, cuisines, lists..."
                onFocus={(e) => {
                  e.currentTarget.blur();
                  navigate('/search/main');
                }}
                onClick={() => navigate('/search/main')}
                className="w-full bg-on-surface/[0.04] hover:bg-on-surface/[0.07] border border-on-surface/[0.06] rounded-full py-3 pl-11 pr-4 text-base font-medium text-on-surface placeholder:text-on-surface/40 focus:outline-none cursor-pointer transition-colors"
                aria-label="Search"
              />
            </div>

            {/* Prominent map entry — replaces the old navbar split. */}
            <button
              type="button"
              onClick={() => navigate('/map')}
              className="group w-full flex items-center gap-3 rounded-2xl border border-on-surface/[0.08] bg-white px-4 py-3.5 text-left transition-all hover:border-on-surface/15 hover:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.16)] active:scale-[0.99]"
            >
              <span className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <MapIcon size={22} strokeWidth={2.2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold text-on-surface leading-tight">Explore on map</span>
                <span className="block text-[12px] text-on-surface/55 mt-0.5">Discover restaurants near you</span>
              </span>
              <ChevronRight size={18} className="flex-shrink-0 text-on-surface/30 group-hover:text-on-surface/55 transition-colors" />
            </button>

          </div>
        ) : (
          <FollowingFeed />
        )}
      </main>
    </div>
  );
};
