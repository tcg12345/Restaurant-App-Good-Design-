CREATE TABLE public.user_feedback (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('problem','feedback','suggestion','other')),
  feature text NOT NULL CHECK (char_length(btrim(feature)) BETWEEN 1 AND 80),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 5000),
  allow_contact boolean NOT NULL DEFAULT false,
  contact_email text CHECK (char_length(contact_email) <= 254),
  screenshot_path text,
  app_version text NOT NULL CHECK (char_length(app_version) <= 32),
  platform text NOT NULL CHECK (platform IN ('web','ios')),
  device_type text NOT NULL CHECK (device_type IN ('desktop','tablet','phone')),
  browser text NOT NULL CHECK (char_length(browser) <= 32),
  source_page text NOT NULL DEFAULT 'settings' CHECK (source_page ~ '^[a-z_]{1,80}$'),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','planned','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((NOT allow_contact AND contact_email IS NULL) OR
    (allow_contact AND contact_email IS NOT NULL AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  CHECK (screenshot_path IS NULL OR screenshot_path ~ ('^' || user_id::text || '/' || id::text || '\.(png|jpg|webp)$'))
);
CREATE INDEX user_feedback_user_created ON public.user_feedback(user_id, created_at DESC);
CREATE INDEX user_feedback_status_created ON public.user_feedback(status, created_at DESC);
CREATE INDEX user_feedback_created ON public.user_feedback(created_at DESC);
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.user_feedback TO authenticated;
GRANT UPDATE(status) ON public.user_feedback TO authenticated;
GRANT ALL ON public.user_feedback TO service_role;
CREATE POLICY feedback_submit ON public.user_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status='new');
CREATE POLICY feedback_read ON public.user_feedback FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_app_admin()));
CREATE POLICY feedback_review ON public.user_feedback FOR UPDATE TO authenticated
  USING ((SELECT public.is_app_admin())) WITH CHECK ((SELECT public.is_app_admin()));

-- Server timestamps and a per-account limit; lock serializes concurrent submissions.
CREATE FUNCTION public.guard_feedback_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Sign in to submit feedback' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 817));
    IF NOT EXISTS(SELECT 1 FROM public.user_feedback WHERE id=NEW.id AND user_id=auth.uid()) AND
       (SELECT count(*) FROM public.user_feedback WHERE user_id=auth.uid() AND created_at>now()-interval '1 hour') >= 10
    THEN RAISE EXCEPTION 'Please wait before sending more feedback' USING ERRCODE='P0001'; END IF;
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_feedback_write() FROM PUBLIC;
CREATE TRIGGER feedback_write BEFORE INSERT OR UPDATE ON public.user_feedback
FOR EACH ROW EXECUTE FUNCTION public.guard_feedback_write();

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('feedback-screenshots','feedback-screenshots',false,5242880,ARRAY['image/png','image/jpeg','image/webp']);
CREATE POLICY feedback_image_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='feedback-screenshots' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
CREATE POLICY feedback_image_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='feedback-screenshots' AND ((storage.foldername(name))[1]=(SELECT auth.uid())::text OR (SELECT public.is_app_admin())));
