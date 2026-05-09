-- 021: Lock down the reels-videos bucket behind signed URLs.
-- ════════════════════════════════════════════════════════════════════
-- Bucket flips from public → private and the SELECT policy on
-- storage.objects is rewritten to mirror the visibility rules on
-- public.reels. Clients now mint signed URLs (createSignedUrls) at read
-- time; the URL bears a short-lived token, so a leaked direct URL only
-- works until the TTL expires (currently 24h on the client).
--
-- Visibility for a video object passes when ANY of these hold:
--   • the matching reel row has is_public = true
--   • the viewer is the author (auth.uid() = reels.user_id)
--   • the viewer follows the author with an accepted user_friends row
--
-- Users without an active session can't sign URLs at all (Storage
-- requires auth for private buckets), which gives anonymous traffic
-- zero access regardless of follower state.

UPDATE storage.buckets SET public = false WHERE id = 'reels-videos';

-- Replace any prior read policies on this bucket.
DROP POLICY IF EXISTS "Reels videos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Reel videos visible per reel visibility" ON storage.objects;

CREATE POLICY "Reel videos visible per reel visibility" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'reels-videos'
    AND EXISTS (
      SELECT 1
      FROM public.reels r
      WHERE r.video_path = storage.objects.name
        AND (
          r.is_public = true
          OR auth.uid() = r.user_id
          OR EXISTS (
            SELECT 1
            FROM public.user_friends uf
            WHERE uf.user_id = auth.uid()
              AND uf.friend_id = r.user_id
              AND uf.status = 'accepted'
          )
        )
    )
  );

-- video_url is no longer authoritative. Older rows still have a public
-- URL stored there but the bucket is private now, so the client signs
-- a fresh URL at fetch time regardless. Drop NOT NULL and set a default.
ALTER TABLE public.reels ALTER COLUMN video_url DROP NOT NULL;
ALTER TABLE public.reels ALTER COLUMN video_url SET DEFAULT '';
