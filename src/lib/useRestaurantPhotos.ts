import { useEffect, useState, useSyncExternalStore } from 'react';
import { getCommunityPhotos, type CommunityPhoto } from './supabase-community';
import { mediaAccessVersion, onMediaAccessChange } from './media-access-scope';
import { resolvePhotoUrl } from './photo-access';

const covers = new Map<string, { photo: CommunityPhoto; at: number }>();
onMediaAccessChange(() => covers.clear());
const PAGE_SIZE = 12;
function cachedCover(key: string): CommunityPhoto[] {
  const cached = covers.get(key);
  return cached && Date.now() - cached.at < 5 * 60_000 ? [cached.photo] : [];
}

/** The hero gets its own request as soon as the route ID is known. The
 * library is paged after the route settles, with no unbounded base64 response. */
export function useRestaurantPhotos(id: string | undefined, viewer: string, settled: boolean) {
  const generation = useSyncExternalStore(onMediaAccessChange, mediaAccessVersion, mediaAccessVersion);
  const key = `${generation}:${viewer}:${id ?? ''}`;
  const [state, setState] = useState(() => ({ key, photos: cachedCover(key), coverReady: false }));
  const current = state.key === key ? state : {key, photos: cachedCover(key), coverReady: false};
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({key, photos: cachedCover(key), coverReady: false});
    void getCommunityPhotos(id, 1, 0, {throwOnError: true}).then(rows => {
      if (cancelled || generation !== mediaAccessVersion()) return;
      if (rows[0]) {
        if (rows[0].url.length < 2_000_000) covers.set(key, {photo: rows[0], at: Date.now()});
        if (covers.size > 12) covers.delete(covers.keys().next().value!);
        // Start authorization while Google details are still in flight.
        void resolvePhotoUrl(rows[0].url);
      } else covers.delete(key);
      setState({key, photos: rows, coverReady: true});
    }).catch(() => {
      if (!cancelled) setState(previous => previous.key === key ? {...previous, coverReady: true} : previous);
    });
    return () => { cancelled = true; };
  }, [id, key, generation]);

  const coverReady = current.coverReady;
  const hasCover = current.photos.length > 0;
  useEffect(() => {
    if (!id || !settled || !coverReady || !hasCover) return;
    let cancelled = false;
    void (async () => {
      // Refetch the first bounded page so insertions/deletions between the
      // cover and library requests do not silently skip the next photo.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const rows = await getCommunityPhotos(id, PAGE_SIZE, offset, {throwOnError: true});
        if (cancelled || generation !== mediaAccessVersion()) return;
        if (rows.length) setState(previous => {
          if (previous.key !== key) return previous;
          const merged = new Map(previous.photos.map(photo => [photo.id, photo]));
          rows.forEach(photo => merged.set(photo.id, photo));
          return {...previous, photos: [...merged.values()]};
        });
        if (rows.length < PAGE_SIZE) break;
      }
    })().catch(() => { /* Preserve the usable cover/pages on a failed later page. */ });
    return () => { cancelled = true; };
  }, [id, key, generation, settled, coverReady, hasCover]);
  return {communityPhotos: current.photos, photosLoading: !!id && !current.coverReady};
}
