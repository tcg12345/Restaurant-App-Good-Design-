import { PhotoImage } from './PhotoImage';
import { guidePreferenceScore, type TastePreferences } from '../lib/taste-preferences';
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ChevronRight } from 'lucide-react';
import { getGuidesForFeed } from '../lib/supabase-guides';
import { getProfilesByIds } from '../lib/supabase-community';
import { safeImage } from '../lib/utils';
import { type BrowseGuide } from './GuidesBrowser';

/** A small, real preview; the full collection belongs in the browser. */
export function useBrowseGuides(enabled = true) {
  const [guides, setGuides] = useState<BrowseGuide[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      try {
        const list = await getGuidesForFeed({ limit: 60 });
        if (cancelled) return;
        const ids = [...new Set(list.map(g => g.userId))];
        const authors = ids.length ? await getProfilesByIds(ids) : {};
        if (cancelled) return;
        setGuides(list.map(g => ({
          id: g.id, title: g.title.trim() || 'Untitled guide', type: g.type,
          author: authors[g.userId]?.display_name || authors[g.userId]?.username || 'GoodEats member',
          image: safeImage(g.coverPhoto) || '', count: g.entries.length,
          daysAgo: Math.max(0, Math.floor((Date.now() - (Date.parse(g.updatedAt) || Date.now())) / 86400000)),
        })));
      } finally { if (!cancelled) setLoading(false); }
    })().catch(() => { /* The collection remains available to browse. */ });
    return () => { cancelled = true; };
  }, [enabled]);
  return { guides, loading };
}

export function HomeGuides({ preferences }: { preferences?: TastePreferences }) {
  const navigate = useNavigate();
  const { guides, loading } = useBrowseGuides();
  const rankedGuides = useMemo(() => preferences ? [...guides].sort((a,b) => guidePreferenceScore(preferences,b)-guidePreferenceScore(preferences,a)) : guides, [guides,preferences]);
  return <HomeGuideRail guides={rankedGuides} loading={loading} onBrowse={() => navigate('/guides')} />;
}

/** An edge-to-edge shelf: each guide stays in place while you browse. */
export function HomeGuideRail({ guides, loading = false, onBrowse, browseRef }: {
  guides: BrowseGuide[]; loading?: boolean; onBrowse: () => void; browseRef?: React.Ref<HTMLButtonElement>;
}) {
  return <section className="home-guides" aria-label="Recommended guides">
    <div className="home-guide-heading"><h2>Guides worth a look</h2>
      <button ref={browseRef} className="home-guide-browse" onClick={onBrowse} aria-label="View all guides">See all <ChevronRight size={14} /></button>
    </div>
    <div className="home-guide-rail" aria-label="Guides">
      {guides.slice(0, 8).map(guide => <Link key={guide.id} className="home-guide-feature" to={`/guides/${encodeURIComponent(guide.id)}`} aria-label={`Open guide: ${guide.title}, by ${guide.author}`}>
        <div className="home-guide-cover" aria-hidden="true"><BookOpen size={32} strokeWidth={1} /><span>{guide.type === 'recipes' ? 'In the kitchen' : 'Around the table'}</span>{guide.image && <PhotoImage src={guide.image} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}</div>
        <strong>{guide.title}</strong><small>{guide.count} {guide.type === 'recipes' ? 'recipes' : 'places'} · {guide.author}</small>
      </Link>)}
      {!guides.length && <button className="home-guide-empty" onClick={onBrowse}><BookOpen size={26} strokeWidth={1.4} /><span><strong>{loading ? 'Finding inspiration…' : 'Find your next favorite.'}</strong><small>Explore curated places and recipes</small></span><ChevronRight size={18} /></button>}
    </div>
  </section>;
}
