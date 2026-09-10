import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../supabase/migrations/20260910141350_audit_discovery_view_access.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const viewer = '00000000-0000-0000-0000-000000000002';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    CREATE TABLE profiles(id uuid PRIMARY KEY, username text, name text, avatar_url text,
      is_public boolean, allow_friend_requests boolean, created_at timestamptz, home_city text, bio text);
    CREATE TABLE friends(user1_id uuid,user2_id uuid);
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    -- The live legacy policies, including authenticated discovery and owner updates.
    CREATE POLICY discovery ON profiles FOR SELECT USING
      (auth.uid() IS NOT NULL AND auth.uid()<>id AND (is_public=true OR allow_friend_requests=true));
    CREATE POLICY full_profiles ON profiles FOR SELECT USING
      (auth.uid()=id OR EXISTS(SELECT 1 FROM friends f WHERE
        (f.user1_id=auth.uid() AND f.user2_id=profiles.id) OR
        (f.user2_id=auth.uid() AND f.user1_id=profiles.id)) OR
        (auth.uid() IS NOT NULL AND is_public=true));
    CREATE POLICY own_profiles ON profiles FOR SELECT USING(auth.uid()=id);
    CREATE POLICY own_update ON profiles FOR UPDATE USING(auth.uid()=id);
    CREATE VIEW profiles_public_search AS SELECT id,username,name,avatar_url,is_public,
      allow_friend_requests,created_at,home_city,bio FROM profiles
      WHERE is_public=true OR allow_friend_requests=true;
    GRANT ALL ON profiles,profiles_public_search TO anon,authenticated,service_role;
    GRANT SELECT ON friends TO anon,authenticated;
  `);
  await db.exec(migration);
  await db.exec(migration); // Repeat deployment is harmless.
}, 30000);

beforeEach(async () => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);
    TRUNCATE profiles,friends;
    INSERT INTO profiles(id,username,is_public,allow_friend_requests,bio) VALUES
      ('${owner}','public',true,false,'Public bio'),
      ('${viewer}','discoverable',false,true,'Discoverable bio'),
      ('00000000-0000-0000-0000-000000000003','hidden',false,false,'Private bio');`);
});
afterAll(async () => { await db?.close(); });

async function asRole(role: string, id = '') {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE ${role};`);
}
it('denies anonymous discovery, even with a supplied identity', async () => {
  for (const id of ['', owner]) {
    await asRole('anon', id);
    await expect(db.query('SELECT * FROM profiles_public_search')).rejects.toThrow('permission denied');
  }
});
it('preserves signed-in discovery while excluding undiscoverable profiles', async () => {
  await asRole('authenticated', viewer);
  expect((await db.query('SELECT username FROM profiles_public_search ORDER BY username')).rows)
    .toEqual([{ username: 'discoverable' }, { username: 'public' }]);
  await db.exec(`RESET ROLE; UPDATE profiles SET is_public=false WHERE id='${owner}';`);
  await asRole('authenticated', viewer);
  expect((await db.query('SELECT username FROM profiles_public_search')).rows)
    .toEqual([{ username: 'discoverable' }]);
});
it('keeps the view read-only even when the owner can update the base profile', async () => {
  await asRole('authenticated', owner);
  await expect(db.query("UPDATE profiles_public_search SET bio='Changed' WHERE id=$1", [owner])).rejects.toThrow('permission denied');
  await expect(db.query('DELETE FROM profiles_public_search WHERE id=$1', [owner])).rejects.toThrow('permission denied');
  await expect(db.query('INSERT INTO profiles_public_search(id,is_public) VALUES($1,true)', ['00000000-0000-0000-0000-000000000004'])).rejects.toThrow('permission denied');
  expect((await db.query("UPDATE profiles SET bio='Changed' WHERE id=$1 RETURNING bio", [owner])).rows).toEqual([{ bio: 'Changed' }]);
});
it('applies caller RLS even if future base-table rules narrow discovery', async () => {
  await db.exec(`BEGIN; CREATE POLICY restricted_discovery ON profiles AS RESTRICTIVE FOR SELECT TO authenticated USING(id=auth.uid());`);
  try {
    await asRole('authenticated', viewer);
    expect((await db.query('SELECT username FROM profiles_public_search')).rows).toEqual([{ username: 'discoverable' }]);
  } finally { await db.exec('RESET ROLE; ROLLBACK;'); }
});
it('does not remove service access and safely skips a fresh installation without the legacy view', async () => {
  await asRole('service_role');
  expect((await db.query('SELECT id FROM profiles_public_search')).rows).toHaveLength(2);
  await db.exec('RESET ROLE; BEGIN; DROP VIEW profiles_public_search;');
  try { await db.exec(migration); } finally { await db.exec('ROLLBACK;'); }
});
