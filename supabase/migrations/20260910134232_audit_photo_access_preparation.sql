-- Preparation only: ship compatible web/iOS readers before disabling public
-- downloads. Restrict signing/listing now without breaking installed clients.
CREATE SCHEMA IF NOT EXISTS media_private;
GRANT USAGE ON SCHEMA media_private TO anon, authenticated;

-- Normalize a reference without trusting its query token or its publisher.
-- Ownership is checked separately against the referencing row's user_id.
CREATE OR REPLACE FUNCTION media_private.photo_reference_path(reference text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
DECLARE encoded text; result bytea := ''::bytea; i integer := 1; c text;
BEGIN
  encoded := substring(reference from '^https?://[^/]+/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/((?:photos|avatars)/[^?#]+)');
  IF encoded IS NULL THEN RETURN NULL; END IF;
  WHILE i <= length(encoded) LOOP
    c := substr(encoded,i,1);
    IF c = '%' THEN
      result := result || decode(substr(encoded,i+1,2),'hex'); i := i + 3;
    ELSE
      result := result || convert_to(c,'UTF8'); i := i + 1;
    END IF;
  END LOOP;
  RETURN convert_from(result,'UTF8');
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION media_private.photo_reference_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION media_private.photo_reference_path(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION media_private.can_read_photo(bucket text, object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH raw_target AS (
    SELECT bucket || '/' || object_name AS path,
      CASE WHEN bucket='photos' THEN split_part(object_name,'/',1)
        WHEN bucket='avatars' AND split_part(object_name,'/',1)='restaurant-photos'
        THEN split_part(object_name,'/',2) END AS owner
  ), target AS (
    SELECT path, CASE WHEN owner ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN owner::uuid END AS owner FROM raw_target
  )
  SELECT COALESCE((SELECT
    owner IS NOT NULL AND (
      owner = (SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM public.user_profiles p
        WHERE p.user_id=owner AND media_private.photo_reference_path(p.avatar_url)=path)
      OR EXISTS (SELECT 1 FROM public.community_photos p
        WHERE p.user_id=owner AND media_private.photo_reference_path(p.url)=path)
      OR EXISTS (SELECT 1 FROM public.community_ratings r
        WHERE r.user_id=owner AND media_private.photo_reference_path(r.photo_url)=path)
      -- Reuse the app's established authorized meal projection. This excludes
      -- private meals and deletion tombstones without exposing user_app_data.
      OR EXISTS (SELECT 1 FROM public.user_profiles author
        CROSS JOIN LATERAL jsonb_path_query(public.get_public_home_meals(author.user_id),'$.** ? (@.type() == "string")') photo
        WHERE author.user_id=owner AND media_private.photo_reference_path(photo #>> '{}')=path)
      OR EXISTS (SELECT 1 FROM public.recipes r
        WHERE r.user_id=owner AND r.is_public AND (
          EXISTS (SELECT 1 FROM unnest(r.photos) photo WHERE media_private.photo_reference_path(photo)=path)
          OR EXISTS (SELECT 1 FROM jsonb_path_query(r.steps,'$.** ? (@.type() == "string")') photo
            WHERE media_private.photo_reference_path(photo #>> '{}')=path)
        ))
      OR EXISTS (SELECT 1 FROM public.guides g
        WHERE g.user_id=owner AND g.is_published AND g.visibility='public' AND (
          media_private.photo_reference_path(g.cover_photo)=path
          OR EXISTS (SELECT 1 FROM jsonb_path_query(g.entries,'$.** ? (@.type() == "string")') photo
            WHERE media_private.photo_reference_path(photo #>> '{}')=path)
        ))
      OR EXISTS (SELECT 1 FROM public.recipe_reviews review JOIN public.recipes r ON r.id=review.recipe_id
        WHERE review.user_id=owner AND media_private.photo_reference_path(review.photo)=path)
      OR EXISTS (SELECT 1 FROM public.expert_recommendations r
        WHERE r.user_id=owner AND media_private.photo_reference_path(r.photo_url)=path)
    ) FROM target),false);
$$;
REVOKE ALL ON FUNCTION media_private.can_read_photo(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION media_private.can_read_photo(text,text) TO anon, authenticated;

DROP POLICY IF EXISTS "photos public read" ON storage.objects;
DROP POLICY IF EXISTS "Photo reads follow explicit sharing" ON storage.objects;
CREATE POLICY "Photo reads follow explicit sharing" ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id='photos' AND media_private.can_read_photo(bucket_id,name));
DROP POLICY IF EXISTS "photos owner update" ON storage.objects;
CREATE POLICY "photos owner update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='photos' AND (SELECT auth.uid())::text=split_part(name,'/',1))
WITH CHECK (bucket_id='photos' AND (SELECT auth.uid())::text=split_part(name,'/',1));

-- These limits match the JPEG compressor and avoid accepting executable SVG/HTML.
UPDATE storage.buckets SET file_size_limit=10485760,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']
WHERE id='photos';
-- Do not set public=false here. The release cutover is a separate operation.

-- Legacy visit uploads occupy the avatars bucket. Ordinary avatars remain
-- intentionally readable; legacy visit objects use the same audience rules.
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own restaurant photos" ON storage.objects;
CREATE POLICY "Avatar and legacy visit photo reads" ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id='avatars' AND (
  split_part(name,'/',1)<>'restaurant-photos' OR media_private.can_read_photo(bucket_id,name)
));
