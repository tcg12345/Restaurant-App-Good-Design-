-- Adds a `theme` JSONB column to `guides` so the Live Editor can persist
-- per-guide visual customization (accent, surface, fonts, hero/entry/intro
-- layout variants, visibility flags, per-element typography overrides,
-- and per-guide author overrides). Nullable — guides with no customization
-- continue to render with the default theme baked into the rendering
-- primitives.

alter table public.guides
  add column if not exists theme jsonb;
