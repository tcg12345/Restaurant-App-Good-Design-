import { PhotoImage } from './PhotoImage';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clapperboard, Play, ChevronRight } from 'lucide-react';
import { useReels, type Reel } from '../contexts/ReelsContext';
import { playableReels } from '../lib/home-reels';
import { muxPosterUrl } from '../lib/mux';
import './HomeReels.css';

const titleFor = (reel: Reel) => reel.restaurant?.name || reel.recipe?.title || reel.caption || 'A little food inspiration';
const hrefFor = (reel: Reel) => `/r/reel-${encodeURIComponent(reel.id)}`;

function ReelPoster({ reel }: { reel: Reel }) {
  const src = reel.posterUrl || (reel.muxPlaybackId && (reel.isPublic || reel.muxTokens?.thumbnail)
    ? muxPosterUrl(reel.muxPlaybackId, { width: 640, token: reel.muxTokens?.thumbnail }) : undefined);
  const [failed, setFailed] = useState<string>();
  return <>
    {src && failed !== src ? <PhotoImage src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} /> : <Clapperboard className="home-reel-fallback" aria-hidden="true" size={32} />}
    <span className="home-reel-shade" />
  </>;
}

/** Poster-only discovery keeps Home light. Playback belongs to the existing
 * full-screen viewer, which preserves feed scroll on return. */
export const HomeReelRail: React.FC<{ reels: Reel[]; loading?: boolean; error?: boolean; onRetry?: () => void }> = ({ reels, loading, error, onRetry }) => (
  <section className="home-reels" aria-label="Reels">
    <div className="home-reels-heading"><div><span>WATCH & DISCOVER</span><h2>A taste of something new</h2></div><Link to="/reels" aria-label="Watch all reels">Reels <ChevronRight size={16} /></Link></div>
    {reels.length > 0 ? <div className="home-reels-rail" data-horizontal-gesture="">
      {reels.slice(0, 8).map(reel => <Link key={reel.id} to={hrefFor(reel)} className="home-reel-tile" aria-label={`Watch ${titleFor(reel)} by ${reel.authorDisplayName || reel.authorUsername}`}>
        <ReelPoster reel={reel} />
        <span className="home-reel-play"><Play size={13} fill="currentColor" /></span>
        <span className="home-reel-copy"><small>{reel.kind === 'recipe' ? 'IN THE KITCHEN' : 'OUT TO EAT'}</small><strong>{titleFor(reel)}</strong><span>@{reel.authorUsername}</span></span>
      </Link>)}
    </div> : loading ? <div className="home-reels-rail" role="status" aria-label="Loading reels">{[0, 1, 2].map(i => <div key={i} className="home-reel-skeleton" />)}</div> : <div className="home-reels-empty"><span className="home-reels-empty-icon"><Clapperboard size={24} /></span><div><strong>{error ? 'Reels couldn’t load' : 'Good food. In motion.'}</strong><p>{error ? 'Try again for a little inspiration.' : 'Restaurant finds and kitchen moments, shared here.'}</p></div>{error ? <button onClick={onRetry}>Retry</button> : <Link to="/reels" aria-label="Explore reels"><ArrowUpRight size={20} /></Link>}</div>}
  </section>
);

export function HomeReels() {
  const { reels, loading, loadError, refreshReels } = useReels();
  return <HomeReelRail reels={playableReels(reels)} loading={loading} error={loadError} onRetry={() => void refreshReels()} />;
}

export const FeedReelCard: React.FC<{ reel: Reel }> = ({ reel }) => {
  return <article className="feed-reel-card">
    <header><Link to={`/user/${encodeURIComponent(reel.authorUsername)}`} className="feed-reel-author"><span className={`feed-reel-avatar ${reel.authorAvatarColor}`}>{reel.authorInitials}</span><span><strong>{reel.authorDisplayName || reel.authorUsername}</strong><small>{reel.locationLabel || (reel.kind === 'recipe' ? 'In the kitchen' : 'Out to eat')}</small></span></Link><span className="feed-reel-kind"><Clapperboard size={14} />Reel</span></header>
    <Link to={hrefFor(reel)} className="feed-reel-media" aria-label={`Watch reel: ${titleFor(reel)}`}>
      <ReelPoster reel={reel} />
      <span className="feed-reel-watch"><Play size={18} fill="currentColor" />Watch reel</span>
      <span className="feed-reel-title"><small>{reel.kind === 'recipe' ? 'COOK SOMETHING GOOD' : 'YOUR NEXT FOOD FIND'}</small><strong>{titleFor(reel)}</strong></span>
    </Link>
    {reel.caption && reel.caption !== titleFor(reel) && <p>{reel.caption}</p>}
  </article>;
};
