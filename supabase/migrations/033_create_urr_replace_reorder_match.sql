-- Atomic DELETE-then-INSERT for reorder matches. PostgREST cannot do this
-- in a single HTTP call, so we expose a SECURITY-INVOKER RPC. The function
-- runs as the calling user, so RLS on urr_matches still applies — the same
-- policies that let a user insert their own matches let this function
-- delete and re-insert them.
--
-- Only `source='reorder'` rows are rewritten. Backfill is one-shot, and
-- explicit matches are point-in-time signals that accumulate.

CREATE OR REPLACE FUNCTION public.replace_reorder_match(
  p_winner       TEXT,
  p_loser        TEXT,
  p_margin       NUMERIC,
  p_context_tags JSONB,
  p_source_ref   TEXT
) RETURNS public.urr_matches
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  public.urr_matches;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.urr_matches
   WHERE user_id = v_user
     AND source = 'reorder'
     AND ((winner_restaurant_id = p_winner AND loser_restaurant_id = p_loser)
       OR (winner_restaurant_id = p_loser  AND loser_restaurant_id = p_winner));

  INSERT INTO public.urr_matches
    (user_id, winner_restaurant_id, loser_restaurant_id, margin, context_tags, source, source_ref)
  VALUES
    (v_user, p_winner, p_loser, p_margin, p_context_tags, 'reorder', p_source_ref)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_reorder_match(TEXT, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;
