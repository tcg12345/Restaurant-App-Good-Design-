-- Nightly schedule for the urr_compute Edge Function via pg_cron + pg_net.
-- The function URL and bearer secret are configured out-of-band via Supabase
-- Dashboard project settings (app.urr_compute_url, app.urr_compute_secret).
--
-- Manual trigger for dev/test:
--   supabase functions invoke urr_compute --body '{"trigger":"manual"}'

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule prior job with the same name (idempotent re-run of this migration).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'urr-nightly-compute') THEN
    PERFORM cron.unschedule('urr-nightly-compute');
  END IF;
END
$$;

SELECT cron.schedule(
  'urr-nightly-compute',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.urr_compute_url', true),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.urr_compute_secret', true),
      'Content-Type', 'application/json'
    ),
    body    := '{"trigger":"cron"}'::jsonb
  );
  $$
);
