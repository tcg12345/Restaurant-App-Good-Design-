-- 055: Client crash reports.
--
-- Production builds strip console.log/debug (and previously stripped
-- console.error too), so crashes in the field left zero diagnostics.
-- Clients insert here best-effort (see src/lib/error-reporting.ts,
-- throttled per session); rows are write-only from the app — read them
-- with the dashboard / service role.

CREATE TABLE IF NOT EXISTS public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  message text NOT NULL,
  stack text,
  context text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created ON public.client_errors(created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can report their own errors" ON public.client_errors;
CREATE POLICY "Users can report their own errors"
  ON public.client_errors FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
-- Deliberately NO select/update/delete policies: write-only from clients.
