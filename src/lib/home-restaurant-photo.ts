import { getPopularRestaurantPhoto } from './photo-likes';
import { getHomeCardPhoto, type HomeCardPhoto } from './home-card-photo';
export interface HomeRestaurantPhoto { url: string; google?: HomeCardPhoto }
const selections = new Map<string, Promise<HomeRestaurantPhoto | null>>();
/** Freeze the displayed photo for this launch, with per-viewer visibility. */
export function getHomeRestaurantPhoto(place: { id: string; name: string; address: string }, viewer: string): Promise<HomeRestaurantPhoto | null> {
  const key = `${viewer}:${place.id}`;
  const existing = selections.get(key);
  if (existing) return existing;
  const result = (async () => {
    // A failed community query is not evidence that a restaurant has no photos.
    const community = await getPopularRestaurantPhoto(place.id);
    if (community) return { url: community.url };
    const google = await getHomeCardPhoto(place);
    return google ? { url: google.url, google } : null;
  })().catch(() => null);
  selections.set(key, result);
  return result;
}
