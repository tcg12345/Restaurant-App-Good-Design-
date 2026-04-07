-- Add status to user_friends for request/accept flow.
-- Run this in your Supabase SQL Editor.

ALTER TABLE public.user_friends ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Update existing rows to 'accepted'
UPDATE public.user_friends SET status = 'accepted' WHERE status = 'pending';

-- Allow users to read friend requests sent TO them (so they can see incoming requests)
DROP POLICY IF EXISTS "Users can read own friends" ON public.user_friends;
CREATE POLICY "Users can read own or incoming friends"
  ON public.user_friends FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Allow users to update requests sent to them (to accept/decline)
DROP POLICY IF EXISTS "Users can update incoming requests" ON public.user_friends;
CREATE POLICY "Users can update incoming requests"
  ON public.user_friends FOR UPDATE
  USING (auth.uid() = friend_id);
