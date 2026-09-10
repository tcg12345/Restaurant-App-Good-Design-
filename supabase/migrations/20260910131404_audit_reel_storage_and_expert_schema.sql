-- Legacy reel clients already sign video_path and its .jpg poster.
-- Bind each reference to its author folder: publishing someone else's
-- path must never turn their private upload into a public object.
UPDATE storage.buckets SET public = false WHERE id = 'reels-videos';
DROP POLICY IF EXISTS "Reels videos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Reel videos visible per reel visibility" ON storage.objects;
CREATE POLICY "Reel videos visible per reel visibility" ON storage.objects
FOR SELECT TO anon, authenticated USING (
  bucket_id = 'reels-videos' AND (
    (SELECT auth.uid())::text = split_part(name, '/', 1)
    OR EXISTS (
      SELECT 1 FROM public.reels r
      WHERE r.user_id::text = split_part(storage.objects.name, '/', 1)
        AND storage.objects.name IN (r.video_path, r.video_path || '.jpg')
        -- Reels' own RLS also applies to this invoker query.
        AND (r.is_public OR r.user_id = (SELECT auth.uid()) OR EXISTS (
          SELECT 1 FROM public.user_friends uf WHERE uf.user_id = (SELECT auth.uid())
            AND uf.friend_id = r.user_id AND uf.status = 'accepted'
        ))
    )
  )
);
DROP POLICY IF EXISTS "Post media visible per post visibility" ON storage.objects;
CREATE POLICY "Post media visible per post visibility" ON storage.objects
FOR SELECT TO anon, authenticated USING (
  bucket_id = 'post-media' AND (
    (SELECT auth.uid())::text = split_part(name, '/', 1)
    OR EXISTS (
      SELECT 1 FROM public.post_items pi JOIN public.posts p ON p.id = pi.post_id
      WHERE p.user_id::text = split_part(storage.objects.name, '/', 1)
        AND storage.objects.name IN (pi.media_path, pi.media_path || '.jpg')
        AND (p.is_public OR p.user_id = (SELECT auth.uid()) OR EXISTS (
          SELECT 1 FROM public.user_friends uf WHERE uf.user_id = (SELECT auth.uid())
            AND uf.friend_id = p.user_id AND uf.status = 'accepted'
        ))
    )
  )
);

-- Reconcile the missing feature table, with server-enforced verification.
CREATE TABLE IF NOT EXISTS public.expert_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id text NOT NULL,
  restaurant_name text NOT NULL DEFAULT '',
  cuisine text NOT NULL DEFAULT '',
  price text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  photo_url text NOT NULL DEFAULT '',
  recommendation_text text NOT NULL DEFAULT '',
  highlight_dishes text[] NOT NULL DEFAULT '{}',
  rating numeric NOT NULL CHECK (rating >= 0 AND rating <= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_id)
);
ALTER TABLE public.expert_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read expert recommendations" ON public.expert_recommendations;
DROP POLICY IF EXISTS "Experts can insert own recommendations" ON public.expert_recommendations;
DROP POLICY IF EXISTS "Experts can update own recommendations" ON public.expert_recommendations;
DROP POLICY IF EXISTS "Experts can delete own recommendations" ON public.expert_recommendations;
CREATE POLICY "Anyone can read expert recommendations" ON public.expert_recommendations
FOR SELECT TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = expert_recommendations.user_id AND p.is_verified)
);
CREATE POLICY "Experts can insert own recommendations" ON public.expert_recommendations
FOR INSERT TO authenticated WITH CHECK (
  (SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = (SELECT auth.uid()) AND p.is_verified)
);
CREATE POLICY "Experts can update own recommendations" ON public.expert_recommendations
FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.user_id = (SELECT auth.uid()) AND p.is_verified));
CREATE POLICY "Experts can delete own recommendations" ON public.expert_recommendations
FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
GRANT SELECT ON public.expert_recommendations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expert_recommendations TO authenticated;
GRANT ALL ON public.expert_recommendations TO service_role;
CREATE INDEX IF NOT EXISTS idx_expert_recommendations_restaurant ON public.expert_recommendations(restaurant_id);

-- Cuisine labels are public restaurant metadata; guests cannot contribute.
GRANT SELECT ON public.restaurant_cuisine, public.restaurant_cuisine_tags TO anon;
DROP POLICY IF EXISTS "Guests can read restaurant cuisines" ON public.restaurant_cuisine;
CREATE POLICY "Guests can read restaurant cuisines" ON public.restaurant_cuisine FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Guests can read cuisine tags" ON public.restaurant_cuisine_tags;
CREATE POLICY "Guests can read cuisine tags" ON public.restaurant_cuisine_tags FOR SELECT TO anon USING (true);
