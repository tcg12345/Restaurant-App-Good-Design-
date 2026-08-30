-- 077: Was the assistant's answer any good?
--
-- The chat can now be rated per response (thumbs up / thumbs down under the
-- last assistant turn). This table is where those verdicts land, so
-- "the recommendations are good" stops being a vibe and becomes a number
-- per set of places actually recommended.
--
-- Write-only from clients, like client_errors (055) and onboarding_events
-- (075). Anon INSERT is deliberate: the assistant answers for signed-out
-- browsers too, and their opinion counts the same.
--
-- What is NOT stored here, on purpose: the user's prompt and the
-- assistant's prose. Those are the user's own conversation and live in
-- their private user_app_data row; copying them into an admin-readable
-- table would be a different exposure than the one they agreed to. What is
-- stored is the thing being judged — which restaurants were recommended —
-- which is what makes a thumbs-down actionable.
--
-- Read with the dashboard, the service role, or as an admin via the
-- ai_chat_feedback_summary view below.

CREATE TABLE IF NOT EXISTS public.ai_chat_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  user_id uuid,
  -- 'up' | 'down'. A turn can be re-rated; rows are append-only, so the
  -- newest row per turn_key is the standing verdict (see the view).
  verdict text NOT NULL,
  -- Stable pointer to the rated turn: chat id + turn index. Lets a
  -- re-rating supersede the earlier row without an UPDATE policy, and
  -- lets one chat's answers be told apart. Not content.
  turn_key text NOT NULL,
  -- The Google place ids the assistant recommended in that turn, if any.
  restaurant_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_feedback_created ON public.ai_chat_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_feedback_turn ON public.ai_chat_feedback(turn_key, created_at DESC);

-- ── Bound the writes ─────────────────────────────────────────────────
-- `WITH CHECK (true)` on an anon-writable table accepts anything from
-- anyone holding the publishable key. These are the shapes lib/
-- ai-chat-feedback.ts actually emits.
ALTER TABLE public.ai_chat_feedback
  DROP CONSTRAINT IF EXISTS ai_chat_feedback_verdict_shape;
ALTER TABLE public.ai_chat_feedback
  ADD CONSTRAINT ai_chat_feedback_verdict_shape
  CHECK (verdict IN ('up', 'down'));

ALTER TABLE public.ai_chat_feedback
  DROP CONSTRAINT IF EXISTS ai_chat_feedback_anon_shape;
ALTER TABLE public.ai_chat_feedback
  ADD CONSTRAINT ai_chat_feedback_anon_shape
  CHECK (char_length(anon_id) BETWEEN 1 AND 64);

ALTER TABLE public.ai_chat_feedback
  DROP CONSTRAINT IF EXISTS ai_chat_feedback_turn_shape;
ALTER TABLE public.ai_chat_feedback
  ADD CONSTRAINT ai_chat_feedback_turn_shape
  CHECK (char_length(turn_key) BETWEEN 1 AND 128);

-- recommend_restaurants caps at 6 ids; 12 leaves room without letting the
-- column become a free text dump.
ALTER TABLE public.ai_chat_feedback
  DROP CONSTRAINT IF EXISTS ai_chat_feedback_ids_shape;
ALTER TABLE public.ai_chat_feedback
  ADD CONSTRAINT ai_chat_feedback_ids_shape
  CHECK (coalesce(array_length(restaurant_ids, 1), 0) <= 12);

ALTER TABLE public.ai_chat_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can rate an assistant answer" ON public.ai_chat_feedback;
CREATE POLICY "Anyone can rate an assistant answer"
  ON public.ai_chat_feedback FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Through is_app_admin() (migration 034), NOT a subquery against
-- app_admins: that table has RLS on with zero policies by design, so a
-- direct subquery returns no rows for everyone and the policy could never
-- be true. Still no UPDATE/DELETE for anyone — the table is append-only.
DROP POLICY IF EXISTS "Admins can read assistant feedback" ON public.ai_chat_feedback;
CREATE POLICY "Admins can read assistant feedback"
  ON public.ai_chat_feedback FOR SELECT
  TO authenticated
  USING (public.is_app_admin());

-- ── The score, as one query ──────────────────────────────────────────
-- One row per rated turn (the newest verdict wins, so a user changing
-- their mind counts once), then rolled up per day.
CREATE OR REPLACE VIEW public.ai_chat_feedback_summary AS
  WITH standing AS (
    SELECT DISTINCT ON (turn_key)
      turn_key, verdict, user_id, anon_id, restaurant_ids, created_at
    FROM public.ai_chat_feedback
    ORDER BY turn_key, created_at DESC
  )
  SELECT
    date_trunc('day', created_at)                      AS day,
    count(*)                                           AS rated_turns,
    count(*) FILTER (WHERE verdict = 'up')             AS thumbs_up,
    count(*) FILTER (WHERE verdict = 'down')           AS thumbs_down,
    round(
      100.0 * count(*) FILTER (WHERE verdict = 'up') / nullif(count(*), 0)
    , 1)                                               AS pct_up,
    count(DISTINCT coalesce(user_id::text, anon_id))   AS raters
  FROM standing
  GROUP BY 1
  ORDER BY 1 DESC;

-- security_invoker: the view runs as the CALLER, so the SELECT policy above
-- still applies. Without it the view would silently hand its owner's
-- privileges to anyone who could select from it.
ALTER VIEW public.ai_chat_feedback_summary SET (security_invoker = on);

GRANT SELECT ON public.ai_chat_feedback_summary TO authenticated;
