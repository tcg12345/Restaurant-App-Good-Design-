-- 072: You may suggest again after your last suggestion was decided.
-- ════════════════════════════════════════════════════════════════════
-- Reported from the app as:
--
--   new row violates row-level security policy (USING expression)
--   for table "cuisine_suggestions"
--
-- 069 wrote the UPDATE policy as
--
--   USING (auth.uid() = user_id AND status = 'pending')
--
-- and the client suggests with an upsert — INSERT … ON CONFLICT
-- (restaurant_id, user_id) DO UPDATE — because UNIQUE (restaurant_id,
-- user_id) means changing your mind must replace your row rather than add
-- a second vote. On the conflict path Postgres checks that USING against
-- the EXISTING row. Once your suggestion has been approved, denied or
-- auto-applied its status is no longer 'pending', the USING clause fails,
-- and you can never suggest for that restaurant again.
--
-- 071 turned that from an edge case into the main path: suggesting a
-- SECOND cuisine for a place is now the normal thing to do, and the most
-- likely person to do it is whoever suggested the first one.
--
-- The status test belongs in WITH CHECK, which governs the row you end up
-- with, not USING, which governs the row you are allowed to touch. You may
-- touch your own row, always; what you may leave behind is a pending
-- suggestion of your own. Reproduced against a live database before and
-- after.
--
-- Run AFTER 069.

DO $$
BEGIN
  IF to_regclass('public.cuisine_suggestions') IS NULL THEN
    RAISE EXCEPTION 'public.cuisine_suggestions is missing — run 069_cuisine_suggestions.sql first.';
  END IF;
END $$;

-- ── 1. A row going back to pending carries no verdict ────────────────
-- Re-suggesting must clear the previous decision, or the row would claim
-- to be pending while still naming the admin who approved something else
-- and the moment they did it. Runs BEFORE the row is checked, so the
-- policy below can insist on a clean row and get one.
CREATE OR REPLACE FUNCTION public.reset_cuisine_suggestion_verdict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.deny_reason := NULL;
    NEW.created_at  := now();   -- it is a new proposal, and the queue sorts by age
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_cuisine_suggestion_verdict ON public.cuisine_suggestions;
CREATE TRIGGER trg_reset_cuisine_suggestion_verdict
  BEFORE UPDATE ON public.cuisine_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.reset_cuisine_suggestion_verdict();

-- ── 2. The policy ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Replace own pending suggestion" ON public.cuisine_suggestions;
DROP POLICY IF EXISTS "Replace own suggestion" ON public.cuisine_suggestions;
CREATE POLICY "Replace own suggestion"
  ON public.cuisine_suggestions FOR UPDATE
  TO authenticated
  -- Which rows you may touch: your own. Whatever became of them.
  USING (auth.uid() = user_id)
  -- What you may leave behind: a pending suggestion of your own, with no
  -- verdict attached. The trigger above has already cleared one if there
  -- was; this is what makes that non-optional.
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

-- The DELETE policy is deliberately NOT widened. Withdrawing a suggestion
-- nobody has ruled on is yours to do; erasing one that was reviewed is
-- erasing the reviewer's decision, and re-suggesting through the flow
-- above covers every honest reason to want it gone.

-- ── Verify ───────────────────────────────────────────────────────────
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE tablename = 'cuisine_suggestions' ORDER BY cmd;
