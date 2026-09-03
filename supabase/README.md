# Supabase migrations

SQL migrations live in `migrations/`, named `NNN_description.sql`. Apply them
in ascending numeric order in the Supabase SQL Editor (or via the CLI). Every
file is written to be **idempotent** — safe to run more than once (tables use
`CREATE TABLE IF NOT EXISTS`, policies are dropped with `DROP POLICY IF EXISTS`
before `CREATE POLICY`, enums are created inside a
`DO $$ … EXCEPTION WHEN duplicate_object … $$` guard, etc.).

## Renumbered files (was: duplicate `013/014/015` prefixes)

Three version numbers were previously duplicated, which Supabase's migration
tooling (it keys on the numeric prefix) mis-tracks or rejects. The second file
of each pair was renumbered to the next free sequential prefix, preserving the
original relative order and file contents:

| Old filename                         | New filename                          |
| ------------------------------------ | ------------------------------------- |
| `013_fix_rls_and_add_indexes.sql`    | `041_fix_rls_and_add_indexes.sql`     |
| `014_add_home_meals_column.sql`      | `042_add_home_meals_column.sql`       |
| `014_create_hotel_dining.sql`        | `043_create_hotel_dining.sql`         |
| `015_create_recipes_tables.sql`      | `044_create_recipes_tables.sql`       |
| `015_create_visit_history.sql`       | `045_create_visit_history.sql`        |

`013_create_expert_recommendations.sql`, `014_add_home_meals_column.sql`… kept
their number where they were the "first" file of a duplicated pair.

### If your database already ran the OLD filenames

A tracked migration environment keys on the prefix, so it may not recognize
that `041`–`045` are the same SQL it already applied under `013`–`015`. **Do
not blindly re-run** — instead verify the schema already contains what each
migration creates, and only run the ones that are missing (each file is
idempotent, so re-running a already-applied one is harmless, but skipping the
check risks confusion). What each renumbered migration creates:

- **041** — restores the owner-only `SELECT` RLS policy on `user_app_data`
  ("Users can read own app data"), reverting the over-broad policy from
  migration 008; adds indexes on `activity_likes`, `activity_comments`,
  `community_photos`, `community_ratings`. Verify: `user_app_data` has NO
  "Anyone can read app data" policy. *(This is the privacy fix — confirm it
  ran.)*
- **042** — adds the `home_meals` JSONB column to `user_app_data`.
- **043** — created the `dining_type` enum and the `hotel_dining` table. Superseded: **084** drops both (the hotels feature is gone).
- **044** — creates the `recipes` and `recipe_reviews` tables + RLS + indexes.
- **045** — creates the `visit_history` table + RLS + indexes.

Quick schema check in the SQL Editor:

```sql
-- policies on user_app_data (041 should have removed "Anyone can read app data")
SELECT policyname FROM pg_policies WHERE tablename = 'user_app_data';
-- tables the renumbered migrations create
SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('recipes', 'recipe_reviews', 'visit_history');
-- the home_meals column (042)
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'user_app_data' AND column_name = 'home_meals';
```
