import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MapPin, Sparkles, Loader2 } from 'lucide-react';
import { groupPlaceSummary, type GroupPlace } from '../lib/group-swipe';
import { useMichelinMatch } from '../lib/useMichelinMatch';
import { MichelinBadge } from './MichelinBadge';
import './GroupPlaceInfo.css';

// Shared by cards, comparisons and the detail sheet, scoped to account + room.
// No persistence of room data after the browsing session.
const summaries = new Map<string, { expires: number; result: Promise<string> }>();
function overview(userId: string, roomId: string, placeId: string): Promise<string> {
  const key = `${userId}:${roomId}:${placeId}`;
  const cached = summaries.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = groupPlaceSummary(roomId, placeId).then(data => {
    if (!data.summary?.trim()) throw Error('The overview is unavailable. Please try again.');
    return data.summary;
  }).catch(error => { summaries.delete(key); throw error; });
  if (summaries.size >= 100) summaries.delete(summaries.keys().next().value!);
  summaries.set(key, { expires: Date.now() + 30 * 60_000, result });
  return result;
}

export const GroupPlaceInfo: React.FC<{
  place: GroupPlace; roomId: string; userId: string; onDetails?: () => void;
}> = ({ place, roomId, userId, onDetails }) => {
  const { michelin } = useMichelinMatch(place.name, place.lat, place.lng, place.address, place.cuisine, '');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    ++request.current; inFlight.current = false; setSummary(''); setBusy(false); setError('');
    return () => { ++request.current; };
  }, [place.id, roomId, userId]);
  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const seq = ++request.current;
    setBusy(true); setError('');
    try { const text = await overview(userId, roomId, place.id); if (request.current === seq) setSummary(text); }
    catch (e) { if (request.current === seq) setError(e instanceof Error ? e.message : 'Couldn’t write an overview. Try again.'); }
    finally { if (request.current === seq) { inFlight.current = false; setBusy(false); } }
  };
  return <div className="gs-place-info">
    <p className="gs-place-address"><MapPin size={15} aria-hidden="true" /><span>{place.address || 'Address unavailable'}</span></p>
    {michelin && <div className="gs-place-awards"><MichelinBadge michelin={michelin} /></div>}
    <div className="gs-place-tools">
      {!summary && <button type="button" disabled={busy} onClick={() => void generate()} aria-label={`AI overview of ${place.name}`}>
        {busy ? <Loader2 size={16} className="gs-overview-spin" /> : <Sparkles size={16} />}{busy ? 'Writing overview…' : error ? 'Try AI overview again' : 'AI overview'}
      </button>}
      {onDetails && <button type="button" onClick={onDetails} aria-label={`Details for ${place.name}`}>Restaurant details<ArrowUpRight size={16} /></button>}
    </div>
    <div aria-live="polite" aria-atomic="true">
      {summary && <div className="gs-place-overview"><span><Sparkles size={13} />AI overview</span><p>{summary}</p></div>}
      {error && <p className="gs-place-error" role="alert">{error}</p>}
    </div>
  </div>;
};
