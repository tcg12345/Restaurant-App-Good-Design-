-- 039: `photos` Storage bucket for rating / recipe / meal / guide photos.
--
-- Photos were stored as base64 data-URLs inside user_app_data.ratings (and
-- home_meals, community_photos, …). A few phone photos blew past the ~5 MB
-- localStorage quota (crashing saves) and bloated the JSONB rows. They now
-- upload here and the app stores the short public URL instead (see
-- src/lib/images.ts uploadPhoto). Old inline data: URLs still render.
--
-- Layout: <user_id>/<filename>. Public read (rating photos show on public
-- restaurant pages), authenticated write scoped to the caller's own folder.
--
-- Run this in your Supabase SQL Editor. Safe to run multiple times.

-- Create the bucket (public read). `id` and `name` are both 'photos'.
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- RLS policies on storage.objects, scoped to this bucket. A user may only
-- write/modify/delete objects whose first path segment is their own uid;
-- anyone may read (bucket is public).
DROP POLICY IF EXISTS "photos public read" ON storage.objects;
CREATE POLICY "photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'photos');

DROP POLICY IF EXISTS "photos owner insert" ON storage.objects;
CREATE POLICY "photos owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "photos owner update" ON storage.objects;
CREATE POLICY "photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "photos owner delete" ON storage.objects;
CREATE POLICY "photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
