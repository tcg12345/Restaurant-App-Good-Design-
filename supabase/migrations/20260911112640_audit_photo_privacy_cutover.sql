-- Compatible signed-photo readers are deployed to web and verified on iOS.
-- Preserve existing ownership/sharing policies; public URL downloads must no
-- longer bypass them. Canonical public-shaped URLs remain stored identifiers.
DO $$
BEGIN
  IF to_regprocedure('media_private.can_read_photo(text,text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
      AND tablename='objects' AND policyname='Photo reads follow explicit sharing'
      AND cmd='SELECT')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
      AND tablename='objects' AND policyname='Avatar and legacy visit photo reads'
      AND cmd='SELECT')
  THEN
    RAISE EXCEPTION 'Photo access preparation is missing; cutover aborted';
  END IF;
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('photos','avatars')) <> 2 THEN
    RAISE EXCEPTION 'Expected photo buckets are missing; cutover aborted';
  END IF;
END;
$$;

UPDATE storage.buckets SET public=false WHERE id IN ('photos','avatars');
