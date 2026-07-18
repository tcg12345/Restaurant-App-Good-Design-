-- 050: Reap uploads stuck in 'processing'.
--
-- Reels and post video items insert their row BEFORE the browser PUTs the
-- bytes to Mux (so a fast webhook always finds a row to update). If the app
-- is backgrounded or killed mid-upload — common for 60s videos on iOS — the
-- in-page rollback never runs, no Mux asset is ever created, and the row
-- sits at mux_status='processing' forever: an eternal "Processing video…"
-- slide that pollReelReady gives up on after ~3 minutes.
--
-- Two layers of defense:
--   1. mux-webhook now handles video.upload.cancelled / video.upload.errored
--      and marks rows errored the moment Mux reports the upload dead
--      (Mux times direct uploads out server-side, default ~1 hour).
--   2. This scheduled job is the backstop for events that never arrive
--      (webhook secret unset, delivery failure): anything still
--      'processing' after 6 hours is marked 'errored'. Marked, not
--      deleted — the owner keeps the row visible with a discard
--      affordance instead of content silently vanishing.
--
-- pg_cron ships with Supabase; scheduling is idempotent via unschedule.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('reap-stuck-mux-uploads');
exception when others then
  null; -- job didn't exist yet
end $$;

select cron.schedule(
  'reap-stuck-mux-uploads',
  '23 * * * *', -- hourly, off the :00 spike
  $job$
    update public.reels
      set mux_status = 'errored'
      where mux_status = 'processing'
        and created_at < now() - interval '6 hours';
    update public.post_items
      set mux_status = 'errored'
      where mux_status = 'processing'
        and created_at < now() - interval '6 hours';
  $job$
);
