import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Map as MapIcon } from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { FollowingFeed } from '../components/FollowingFeed';
import { cn } from '../lib/utils';

type SearchTab = 'discover' | 'following';

export const Search: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<SearchTab>('discover');

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <TopBar title="Search" />

      {/* Tab switcher */}
      <div className="px-4 pt-1">
        <div className="flex items-center gap-6 border-b border-on-surface/[0.08]">
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
                className="w-full bg-on-surface/[0.04] hover:bg-on-surface/[0.06] rounded-full py-3 pl-11 pr-4 text-sm font-medium text-on-surface placeholder:text-on-surface/40 focus:outline-none cursor-pointer transition-colors"
                aria-label="Search"
              />
            </div>

            <button
              type="button"
              onClick={() => navigate('/map')}
              className="w-full flex items-center gap-3 py-3 text-left group"
              aria-label="Open map"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 transition-colors group-hover:bg-primary/15">
                <MapIcon size={18} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-on-surface">Explore on map</p>
                <p className="text-[11px] text-on-surface/50">Browse restaurants by location</p>
              </div>
            </button>
          </div>
        ) : (
          <FollowingFeed />
        )}
      </main>
    </div>
  );
};
