-- Restore the schema expected by migrations 012 and 042 and the current client.
-- Backfill only newly added columns; never replace a later edit on rerun.
DO $migration$
DECLARE v_column_name text; mirror_key text;
BEGIN
  FOR v_column_name, mirror_key IN VALUES ('trips','__trips__'), ('home_meals','__home_meals__') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name='user_app_data' AND c.column_name=v_column_name
    ) THEN
      EXECUTE format('ALTER TABLE public.user_app_data ADD COLUMN %I jsonb NOT NULL DEFAULT ''[]''::jsonb',v_column_name);
      EXECUTE format('UPDATE public.user_app_data SET %I = restaurant_meta -> %L WHERE jsonb_typeof(restaurant_meta -> %L) = ''array''',v_column_name,mirror_key,mirror_key);
    END IF;
  END LOOP;
END
$migration$;
NOTIFY pgrst, 'reload schema';
