-- 058: Dedicated visit_history column on user_app_data.
--
-- Visit history used to live ONLY inside the restaurant_meta blob at the
-- reserved __visit_history__ key — every visit logged re-uploaded the whole
-- meta blob (including inline base64 photo arrays on legacy records). With a
-- dedicated column the per-action write is column-scoped and small.
--
-- The meta stash remains the read/write fallback for clients running against
-- schemas that predate this migration; the client merges both sources on
-- load. Safe to run multiple times.

ALTER TABLE public.user_app_data
  ADD COLUMN IF NOT EXISTS visit_history JSONB NOT NULL DEFAULT '{}'::jsonb;
