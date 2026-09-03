-- ═══════════════════════════════════════════════════════
-- Drop the hotel dining table and enum (migration 043)
-- Run this in your Supabase SQL Editor. Safe to run multiple times.
-- ═══════════════════════════════════════════════════════
--
-- The hotels feature was removed from the app end to end, and every
-- account's legacy hotel ratings were swept in 2026-07. Nothing reads or
-- writes hotel_dining any more; this finishes the removal on the database
-- side. The policies and indexes from 043 go with the table.

DROP TABLE IF EXISTS public.hotel_dining;
DROP TYPE IF EXISTS public.dining_type;
