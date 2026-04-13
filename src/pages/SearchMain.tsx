import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, X, Clock } from 'lucide-react';

const RECENT_SEARCHES_KEY = 'gourmet-canvas-recent-searches';
const MAX_RECENT = 10;

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecentSearches(list: string[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

export const SearchMain: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the input so the user can start typing immediately.
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const performSearch = (query: string) => {
    const q = query.trim();
    if (!q) return;
    const next = [q, ...recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    setRecentSearches(next);
    writeRecentSearches(next);
    // Hand off to the Explore discover search for the actual results.
    navigate(`/?discover=1`);
  };

  const handleRecentClick = (q: string) => {
    setSearchQuery(q);
    performSearch(q);
  };

  const handleRemove = (q: string) => {
    const next = recentSearches.filter((x) => x !== q);
    setRecentSearches(next);
    writeRecentSearches(next);
  };

  const handleClearAll = () => {
    setRecentSearches([]);
    writeRecentSearches([]);
  };

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <header className="sticky top-0 w-full px-4 py-3 flex items-center gap-3 bg-surface/80 backdrop-blur-md z-40">
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <form
          className="flex-1 relative"
          onSubmit={(e) => {
            e.preventDefault();
            performSearch(searchQuery);
          }}
        >
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search restaurants, cuisines..."
            className="w-full bg-white/60 backdrop-blur-sm rounded-full py-3 pl-11 pr-10 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all border border-on-surface/10"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                inputRef.current?.focus();
              }}
              className="absolute inset-y-0 right-3 flex items-center text-on-surface/30 hover:text-on-surface/60"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </form>
      </header>

      <main className="px-4 pt-4">
        {recentSearches.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-on-surface/40" />
                <h2 className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em]">Recent Searches</h2>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-[10px] font-bold text-primary uppercase tracking-wider"
              >
                Clear All
              </button>
            </div>
            <div className="h-px bg-on-surface/6 -mx-4 mb-2" />
            <ul className="divide-y divide-on-surface/5">
              {recentSearches.map((q) => (
                <li key={q} className="flex items-center gap-3 py-3 group">
                  <Clock size={14} className="text-on-surface/25 flex-shrink-0" />
                  <button
                    type="button"
                    onClick={() => handleRecentClick(q)}
                    className="flex-1 text-left text-sm text-on-surface/80 truncate hover:text-primary transition-colors"
                  >
                    {q}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(q)}
                    className="w-7 h-7 rounded-full text-on-surface/30 hover:bg-on-surface/5 flex items-center justify-center flex-shrink-0"
                    aria-label={`Remove ${q} from recent searches`}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <SearchIcon size={32} className="text-on-surface/15 mb-3" />
            <p className="text-sm font-medium text-on-surface/40">No recent searches</p>
            <p className="text-xs text-on-surface/30 mt-1">Your recent searches will appear here</p>
          </div>
        )}
      </main>
    </div>
  );
};
