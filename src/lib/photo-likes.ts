import { supabase, supabaseConfigured } from './supabase';
import type { CommunityPhoto } from './supabase-community';
export interface PhotoLikes { count: number; liked: boolean }
export async function getPhotoLikes(photoId: string): Promise<PhotoLikes> {
  if (!supabaseConfigured) return { count: 0, liked: false };
  const { data, error } = await supabase.rpc('community_photo_like_stats', { p_photo_ids: [photoId] });
  if (error) throw error;
  if (!data?.length) throw new Error('Photo unavailable');
  return { count: Number(data[0].like_count), liked: !!data[0].liked };
}
export async function setPhotoLiked(photoId: string, userId: string, liked: boolean): Promise<void> {
  const query = liked
    ? supabase.from('community_photo_likes').upsert({ photo_id: photoId, user_id: userId }, { onConflict: 'photo_id,user_id', ignoreDuplicates: true })
    : supabase.from('community_photo_likes').delete().eq('photo_id', photoId).eq('user_id', userId);
  const { error } = await query;
  if (error) throw error;
}
export async function getPopularRestaurantPhoto(restaurantId: string): Promise<CommunityPhoto | null> {
  if (!supabaseConfigured) throw new Error('Community photos unavailable');
  const { data, error } = await supabase.rpc('popular_restaurant_photo', { p_restaurant_id: restaurantId });
  if (error) throw error;
  return data?.[0] || null;
}
