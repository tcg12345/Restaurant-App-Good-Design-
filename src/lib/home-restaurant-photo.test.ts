import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./photo-likes',()=>({getPopularRestaurantPhoto:vi.fn()}));
vi.mock('./home-card-photo',()=>({getHomeCardPhoto:vi.fn()}));
import { getPopularRestaurantPhoto } from './photo-likes';
import { getHomeCardPhoto } from './home-card-photo';
import { getHomeRestaurantPhoto } from './home-restaurant-photo';
import type { CommunityPhoto } from './supabase-community';
const place={id:'restaurant',name:'Place',address:'New York'};
beforeEach(()=>vi.clearAllMocks());
it('uses the most popular community photo without any Google request and freezes it for navigation',async()=>{
 vi.mocked(getPopularRestaurantPhoto).mockResolvedValue({url:'community.jpg'} as CommunityPhoto);
 const first=getHomeRestaurantPhoto(place,'community-viewer');
 expect(await first).toEqual({url:'community.jpg'});
 expect(getHomeRestaurantPhoto(place,'community-viewer')).toBe(first);
 expect(getPopularRestaurantPhoto).toHaveBeenCalledTimes(1);
 expect(getHomeCardPhoto).not.toHaveBeenCalled();
});
it('uses Google only after a successful empty community result',async()=>{
 vi.mocked(getPopularRestaurantPhoto).mockResolvedValue(null);
 const google={url:'google.jpg',authors:[]}; vi.mocked(getHomeCardPhoto).mockResolvedValue(google);
 expect(await getHomeRestaurantPhoto(place,'no-community')).toEqual({url:'google.jpg',google});
});
it('does not treat a database failure as permission to fetch Google imagery',async()=>{
 vi.mocked(getPopularRestaurantPhoto).mockRejectedValue(new Error('offline'));
 expect(await getHomeRestaurantPhoto(place,'offline-viewer')).toBeNull();
 expect(getHomeCardPhoto).not.toHaveBeenCalled();
});
it('keeps photo selection separate for different signed-in viewers',async()=>{
 vi.mocked(getPopularRestaurantPhoto).mockResolvedValue({url:'different-visible-photo.jpg'} as CommunityPhoto);
 expect(await getHomeRestaurantPhoto(place,'another-viewer')).toEqual({url:'different-visible-photo.jpg'});
 expect(getPopularRestaurantPhoto).toHaveBeenCalledTimes(1);
});
