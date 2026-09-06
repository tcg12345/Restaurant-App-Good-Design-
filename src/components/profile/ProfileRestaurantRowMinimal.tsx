import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Bookmark } from 'lucide-react';
import { scoreHex } from '../../lib/score';
import type { CommunityRating, CommunityPhoto } from '../../lib/supabase-community';
import { Collapse } from '../Collapse';
import { PhotoGallery } from '../PhotoGallery';
import { homeHaptic } from '../../lib/haptics';
import './PublicProfileDesign.css';

interface Props {
  rating: CommunityRating;
  photos: CommunityPhoto[];
  expanded: boolean;
  onToggle: () => void;
  ownerName: string;
  compact?: boolean;
  saved?: boolean;
  onToggleSave?: () => void;
}

/** Flat, expandable entry: a short overview with the complete visit one tap away. */
export const ProfileRestaurantRowMinimal: React.FC<Props> = ({
  rating, photos, expanded, onToggle, ownerName, saved = false, onToggleSave,
}) => {
  const [galleryAt, setGalleryAt] = useState<number | null>(null);
  const detailId = useId();
  const score = Number(rating.score);
  const scoreLabel = Number.isFinite(score) ? score.toFixed(1) : '—';
  const color = scoreHex(Number.isFinite(score) ? score : 0);
  const date = rating.visit_date ? new Date(rating.visit_date.length === 10 ? `${rating.visit_date}T12:00:00` : rating.visit_date) : null;
  const visit = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const toggle = () => { homeHaptic(); onToggle(); };
  return (
    <article className="public-rating">
      <button type="button" className="public-rating-toggle" onClick={toggle} aria-expanded={expanded} aria-controls={detailId} aria-label={`${rating.restaurant_name}, rated ${scoreLabel}. ${expanded ? 'Hide' : 'Show'} visit details`}>
        <div className="public-rating-copy">
          <h3>{rating.restaurant_name}</h3>
          <p>{[rating.cuisine, rating.price].filter(Boolean).join(' · ')}</p>
          {visit && <p>{visit}</p>}
          {rating.notes?.trim() && !expanded && <p className="public-rating-note">{rating.notes}</p>}
        </div>
        <span className="flex-none grid place-items-center rounded-full font-semibold tabular-nums" style={{ width: 44, height: 44, fontSize: 16, background: `${color}12`, color, boxShadow: `inset 0 0 0 1px ${color}45` }} aria-label={`Score ${scoreLabel} out of 10`}>{scoreLabel}</span>
      </button>
      <div className="public-rating-actions">
        <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={detailId}>{expanded ? 'Hide details' : photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} · Visit details` : 'Visit details'}<ChevronDown size={13} /></button>
        {onToggleSave && <button type="button" onClick={onToggleSave} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={saved}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button>}
      </div>
      <div id={detailId}>
        <Collapse open={expanded}>
          <div className="public-rating-details">
            {rating.address && <p>{rating.address}</p>}
            {rating.notes?.trim() && <p className="public-rating-full-note" aria-label={`${ownerName}'s note`}>{rating.notes}</p>}
            {photos.length > 0 && <div className="public-rating-photos">{photos.slice(0, 6).map((photo, index) => <button key={photo.id} type="button" onClick={() => setGalleryAt(index)} aria-label={index === 5 && photos.length > 6 ? `View all ${photos.length} photos` : photo.caption || `View photo ${index + 1}`}><img src={photo.url} alt={photo.caption || ''} loading="lazy" referrerPolicy="no-referrer" />{index === 5 && photos.length > 6 && <span>+{photos.length - 6}</span>}</button>)}</div>}
            {!!rating.tags?.length && <div className="public-rating-tags">{rating.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
            <Link className="public-rating-link" to={`/restaurant/${rating.restaurant_id}`}>View restaurant<ArrowRight size={14} /></Link>
          </div>
        </Collapse>
      </div>
      {galleryAt !== null && <PhotoGallery photos={photos.map(photo => photo.url)} communityPhotos={photos} name={rating.restaurant_name || ''} initialIndex={galleryAt} onClose={() => setGalleryAt(null)} />}
    </article>
  );
};
