-- Nested replies for post + reel comments (one level deep).
-- Adds a self-referencing parent_id; top-level comments have parent_id = NULL,
-- replies point at their parent. ON DELETE CASCADE so deleting a parent removes
-- its replies. Run once in the Supabase SQL editor.

alter table public.post_comments
  add column if not exists parent_id uuid
  references public.post_comments(id) on delete cascade;

create index if not exists post_comments_parent_id_idx
  on public.post_comments(parent_id);

alter table public.reel_comments
  add column if not exists parent_id uuid
  references public.reel_comments(id) on delete cascade;

create index if not exists reel_comments_parent_id_idx
  on public.reel_comments(parent_id);
