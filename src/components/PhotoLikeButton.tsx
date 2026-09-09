import React, { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { useToast } from '../contexts/ToastContext';
import { getPhotoLikes, setPhotoLiked, type PhotoLikes } from '../lib/photo-likes';
import { homeHaptic } from '../lib/haptics';
import './PhotoLikeButton.css';

export function PhotoLikeButton({ photoId, onSignInNeeded }: { photoId: string; onSignInNeeded?: () => void }) {
  const { user } = useAuth();
  return <PhotoLikeControl key={`${photoId}:${user?.id || 'guest'}`} photoId={photoId} userId={user?.id} onSignInNeeded={onSignInNeeded} />;
}
const PhotoLikeControl: React.FC<{ photoId: string; userId?: string; onSignInNeeded?: () => void }> = ({ photoId, userId, onSignInNeeded }) => {
  const [stats, setStats] = useState<PhotoLikes>({ count: 0, liked: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false), version = useRef(0);
  const { requireSignIn } = useSignInModal();
  const { showToast } = useToast();
  useEffect(() => {
    const run = ++version.current;
    getPhotoLikes(photoId).then(value => { if (version.current === run) setStats(value); })
      .catch(() => { if (version.current === run) setError(true); })
      .finally(() => { if (version.current === run) setLoading(false); });
    return () => { version.current++; };
  }, [photoId]);
  const toggle = async () => {
    if (!userId) { onSignInNeeded?.(); requireSignIn('Sign in to like a photo'); return; }
    if (inFlight.current || loading) return;
    inFlight.current = true; setBusy(true);
    const run = version.current, before = stats;
    try {
      if (error) {
        const latest = await getPhotoLikes(photoId);
        if (version.current === run) { setStats(latest); setError(false); }
        return;
      }
      const liked = !stats.liked;
      homeHaptic(); setStats({ liked, count: Math.max(0, stats.count + (liked ? 1 : -1)) });
      await setPhotoLiked(photoId, userId, liked);
      // Reconcile concurrent likes without turning a successful write into a failure.
      const latest = await getPhotoLikes(photoId).catch(() => null);
      if (latest && version.current === run) setStats(latest);
    } catch {
      if (version.current === run) { setStats(before); showToast('Couldn’t update photo likes. Try again.'); }
    } finally {
      inFlight.current = false;
      if (version.current === run) setBusy(false);
    }
  };
  return <button type="button" className="photo-like-button" aria-label={error ? 'Retry loading photo likes' : stats.liked ? 'Unlike photo' : 'Like photo'} aria-pressed={stats.liked} disabled={loading || busy}
    onClick={event => { event.stopPropagation(); void toggle(); }}>
    <Heart size={18} fill={stats.liked ? 'currentColor' : 'none'} /><span aria-live="polite">{loading || error ? '—' : stats.count}</span>
  </button>;
};
