-- Adds the include_photos toggle to guides. When false, the published
-- guide renders entry cards in a text-only editorial layout (no hero
-- image per entry). Default true so existing rows keep their current
-- look.
ALTER TABLE public.guides
  ADD COLUMN IF NOT EXISTS include_photos BOOLEAN NOT NULL DEFAULT true;
