-- Visit history: stores previous ratings when a user re-rates a restaurant
CREATE TABLE IF NOT EXISTS public.visit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id TEXT NOT NULL,
  score NUMERIC(3,1) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  visit_date TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  would_return BOOLEAN NOT NULL DEFAULT true,
  photos JSONB NOT NULL DEFAULT '[]',
  friend_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.visit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own visit history" ON public.visit_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own visit history" ON public.visit_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own visit history" ON public.visit_history FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_visit_history_user_restaurant ON public.visit_history(user_id, restaurant_id);
CREATE INDEX IF NOT EXISTS idx_visit_history_created ON public.visit_history(created_at DESC);
