-- Explicit consent authorizes screening of one immutable content revision.
-- Existing approved content is not sent to any provider or reprocessed.
ALTER TABLE public.content_moderation ADD COLUMN screening_state text NOT NULL DEFAULT 'awaiting_consent'
 CHECK(screening_state IN ('awaiting_consent','queued','running','manual','passed'));
ALTER TABLE public.content_moderation ADD COLUMN screening_reason text;
UPDATE public.content_moderation SET screening_state=CASE WHEN status='approved' THEN 'passed' ELSE 'manual' END;
CREATE TABLE safety_private.screening_jobs (
 kind text NOT NULL,content_id text NOT NULL,revision uuid NOT NULL,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 consent_version text NOT NULL CHECK(consent_version='2026-09-12-screening'),consented_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz,
 PRIMARY KEY(kind,content_id),FOREIGN KEY(kind,content_id) REFERENCES public.content_moderation(kind,content_id) ON DELETE CASCADE
);
ALTER TABLE safety_private.screening_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON safety_private.screening_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON safety_private.screening_jobs TO service_role;
CREATE INDEX screening_jobs_due ON safety_private.screening_jobs(available_at);
CREATE TABLE safety_private.screening_usage(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,window_start timestamptz NOT NULL DEFAULT now(),requests integer NOT NULL DEFAULT 0);
ALTER TABLE safety_private.screening_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON safety_private.screening_usage FROM PUBLIC,anon,authenticated;
GRANT ALL ON safety_private.screening_usage TO service_role;

CREATE FUNCTION safety_private.reset_screening() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.revision IS DISTINCT FROM OLD.revision THEN
 NEW.screening_state:='awaiting_consent';NEW.screening_reason:=NULL;
 DELETE FROM safety_private.screening_jobs WHERE kind=OLD.kind AND content_id=OLD.content_id;
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.reviewed_by IS NOT NULL THEN
 NEW.screening_state:=CASE WHEN NEW.status='approved' THEN 'passed' ELSE 'manual' END;
 DELETE FROM safety_private.screening_jobs WHERE kind=OLD.kind AND content_id=OLD.content_id;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER screening_reset BEFORE UPDATE ON public.content_moderation FOR EACH ROW EXECUTE FUNCTION safety_private.reset_screening();

CREATE FUNCTION public.request_content_screening(p_kind text,p_id text,p_revision uuid,p_consent_version text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.content_moderation;
BEGIN
 IF auth.uid() IS NULL OR p_consent_version<>'2026-09-12-screening' OR p_consent_version IS NULL THEN RAISE EXCEPTION 'Screening permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO item FROM public.content_moderation WHERE kind=p_kind AND content_id=p_id FOR UPDATE;
 IF NOT FOUND OR item.user_id<>auth.uid() OR item.revision<>p_revision THEN RAISE EXCEPTION 'Content changed or unavailable' USING ERRCODE='42501'; END IF;
 IF item.status<>'pending' OR item.screening_state NOT IN ('awaiting_consent') THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,28));
 IF (SELECT count(*) FROM safety_private.screening_jobs WHERE user_id=auth.uid())>=100 THEN RAISE EXCEPTION 'Please wait for your current uploads to finish'; END IF;
 INSERT INTO safety_private.screening_usage(user_id,requests) VALUES(auth.uid(),1) ON CONFLICT(user_id) DO UPDATE SET requests=CASE WHEN screening_usage.window_start<now()-interval '1 hour' THEN 1 ELSE screening_usage.requests+1 END,window_start=CASE WHEN screening_usage.window_start<now()-interval '1 hour' THEN now() ELSE screening_usage.window_start END;
 IF (SELECT requests FROM safety_private.screening_usage WHERE user_id=auth.uid())>200 THEN RAISE EXCEPTION 'Please try sharing more content later'; END IF;
 INSERT INTO safety_private.screening_jobs(kind,content_id,revision,user_id,consent_version) VALUES(p_kind,p_id,p_revision,auth.uid(),p_consent_version);
 UPDATE public.content_moderation SET screening_state='queued' WHERE kind=p_kind AND content_id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.request_content_screening(text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_content_screening(text,text,uuid,text) TO authenticated;

-- The secret stays in Vault. No service key is embedded in cron or sent to clients.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='goodeats_screening_secret') THEN
 PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'goodeats_screening_secret'); END IF;
END $$;
CREATE FUNCTION public.claim_content_screening(p_secret text,p_limit integer DEFAULT 2)
RETURNS TABLE(kind text,content_id text,revision uuid,user_id uuid,snapshot jsonb,lease_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected text;
BEGIN
 SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name='goodeats_screening_secret' LIMIT 1;
 IF expected IS NULL OR p_secret IS NULL OR p_secret<>expected THEN RAISE EXCEPTION 'Unauthorized worker' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(73121983);
 IF (SELECT count(*) FROM safety_private.screening_jobs WHERE lease_until>now())>=8 THEN RETURN; END IF;
 RETURN QUERY WITH due AS (
 SELECT j.kind,j.content_id FROM safety_private.screening_jobs j JOIN public.content_moderation m USING(kind,content_id)
 WHERE j.revision=m.revision AND m.status='pending' AND m.screening_state IN ('queued','running')
 AND j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now())
 ORDER BY j.available_at LIMIT greatest(1,least(p_limit,4)) FOR UPDATE OF m SKIP LOCKED
 ),claimed AS (
 UPDATE safety_private.screening_jobs j SET attempts=j.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
 FROM due d WHERE j.kind=d.kind AND j.content_id=d.content_id RETURNING j.*
 ),marked AS (
 UPDATE public.content_moderation m SET screening_state='running' FROM claimed c WHERE m.kind=c.kind AND m.content_id=c.content_id RETURNING m.kind
 ) SELECT c.kind,c.content_id,c.revision,c.user_id,m.snapshot,c.lease_id FROM claimed c JOIN public.content_moderation m ON m.kind=c.kind AND m.content_id=c.content_id;
END $$;
CREATE FUNCTION public.finish_content_screening(p_kind text,p_id text,p_revision uuid,p_lease uuid,p_result text,p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j safety_private.screening_jobs;item public.content_moderation;
BEGIN
 IF p_result NOT IN ('passed','flagged','unsupported','retry') THEN RAISE EXCEPTION 'Invalid result'; END IF;
 -- Same lock order as submission/editing; a stale worker cannot approve new content.
 SELECT * INTO item FROM public.content_moderation WHERE kind=p_kind AND content_id=p_id FOR UPDATE;
 SELECT * INTO j FROM safety_private.screening_jobs WHERE kind=p_kind AND content_id=p_id FOR UPDATE;
 IF j.lease_id IS DISTINCT FROM p_lease OR j.revision IS DISTINCT FROM p_revision OR item.revision IS DISTINCT FROM p_revision OR item.status<>'pending' OR j.lease_until<now() THEN RETURN false; END IF;
 IF p_result='retry' AND j.attempts<3 THEN
 UPDATE safety_private.screening_jobs SET available_at=now()+interval '1 minute'*power(2,j.attempts),lease_id=NULL,lease_until=NULL WHERE kind=p_kind AND content_id=p_id;
 UPDATE public.content_moderation SET screening_state='queued',screening_reason='retry' WHERE kind=p_kind AND content_id=p_id;
 ELSE
 UPDATE public.content_moderation SET status=CASE WHEN p_result='passed' THEN 'approved' ELSE 'pending' END,
 screening_state=CASE WHEN p_result='passed' THEN 'passed' ELSE 'manual' END,
 screening_reason=left(COALESCE(p_reason,p_result),120),reviewed_at=now()
 WHERE kind=p_kind AND content_id=p_id;
 DELETE FROM safety_private.screening_jobs WHERE kind=p_kind AND content_id=p_id;
 END IF;RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_content_screening(text,integer),public.finish_content_screening(text,text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_content_screening(text,integer),public.finish_content_screening(text,text,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION safety_private.screening_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM safety_private.screening_jobs WHERE available_at<=now() AND (lease_until IS NULL OR lease_until<now())) THEN RETURN; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='goodeats_screening_secret' LIMIT 1;
 IF secret IS NOT NULL THEN PERFORM net.http_post(url:='https://ocpmhsquwsdaauflbygf.supabase.co/functions/v1/screen-content',headers:=jsonb_build_object('Content-Type','application/json','x-screening-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=55000); END IF;
END $$;
CREATE FUNCTION safety_private.wake_screening() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM safety_private.screening_tick();RETURN NULL;
END $$;
CREATE TRIGGER screening_wake AFTER INSERT ON safety_private.screening_jobs FOR EACH STATEMENT EXECUTE FUNCTION safety_private.wake_screening();
REVOKE ALL ON FUNCTION safety_private.reset_screening(),safety_private.screening_tick(),safety_private.wake_screening() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION safety_private.reset_screening(),safety_private.screening_tick(),safety_private.wake_screening() TO service_role;
SELECT cron.schedule('goodeats-content-screening','* * * * *','select safety_private.screening_tick()');

-- Publish a carousel together, rather than exposing only its already-checked items.
CREATE FUNCTION safety_private.post_media_ready(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.post_items i LEFT JOIN public.content_moderation m ON m.kind='post_items' AND m.content_id=i.id::text WHERE i.post_id=p_id AND (m.status IS NULL OR m.status<>'approved'));
$$;
REVOKE ALL ON FUNCTION safety_private.post_media_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safety_private.post_media_ready(uuid) TO anon,authenticated,service_role;
CREATE POLICY safety_media_ready ON public.posts AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(user_id=(SELECT auth.uid()) OR (SELECT public.is_app_admin()) OR safety_private.post_media_ready(id));

-- Deleting and recreating an object must not reuse an earlier approval.
CREATE FUNCTION safety_private.invalidate_replaced_media() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.bucket_id NOT IN ('photos','avatars','post-media','reels-videos') THEN RETURN NEW; END IF;
 UPDATE public.content_moderation m SET status='pending',revision=gen_random_uuid(),reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
 WHERE EXISTS(SELECT 1 FROM jsonb_path_query(m.snapshot,'$.** ? (@.type() == "string")') ref
 WHERE media_private.photo_reference_path(ref #>> '{}')=NEW.bucket_id||'/'||NEW.name
 OR (NEW.bucket_id IN ('post-media','reels-videos') AND ref #>> '{}' = NEW.name));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION safety_private.invalidate_replaced_media() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER safety_replaced_media AFTER INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION safety_private.invalidate_replaced_media();

CREATE FUNCTION public.request_manual_content_review(p_kind text,p_id text,p_revision uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 UPDATE public.content_moderation SET screening_state='manual',screening_reason='author_requested_manual'
 WHERE kind=p_kind AND content_id=p_id AND revision=p_revision AND user_id=auth.uid() AND status='pending' AND screening_state='awaiting_consent';
END $$;
REVOKE ALL ON FUNCTION public.request_manual_content_review(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_manual_content_review(text,text,uuid) TO authenticated;
