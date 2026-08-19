import { describe, it, expect, beforeEach, vi } from 'vitest';

const { upsert, reportClientError } = vi.hoisted(() => ({
  upsert: vi.fn(),
  reportClientError: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: { from: () => ({ upsert }) },
  supabaseConfigured: true,
}));
vi.mock('./error-reporting', () => ({ reportClientError }));

import { saveProfile, missingSchemaColumn } from './supabase-community';

/** PostgREST's PGRST204, verbatim. */
const schemaCacheError = (column: string) => ({
  code: 'PGRST204',
  message: `Could not find the '${column}' column of 'user_profiles' in the schema cache`,
});

/** A database that only knows `known` — anything else answers PGRST204,
 *  exactly like PostgREST validating against a stale/behind schema cache. */
function dbKnowing(known: string[]) {
  const accepted: Record<string, unknown>[] = [];
  upsert.mockImplementation(async (payload: Record<string, unknown>) => {
    const unknown = Object.keys(payload).find((k) => !known.includes(k));
    if (unknown) return { error: schemaCacheError(unknown) };
    accepted.push({ ...payload });
    return { error: null };
  });
  return accepted;
}

const IDENTITY = ['user_id', 'display_name', 'username', 'updated_at'];
const FULL = [...IDENTITY, 'bio', 'is_public', 'home_city', 'home_lat', 'home_lng'];

beforeEach(() => { upsert.mockReset(); reportClientError.mockReset(); });

describe('missingSchemaColumn', () => {
  it('names the column PostgREST rejected', () => {
    expect(missingSchemaColumn(schemaCacheError('home_city'))).toBe('home_city');
  });

  it('ignores unrelated errors', () => {
    expect(missingSchemaColumn(null)).toBeNull();
    expect(missingSchemaColumn({ code: '23505', message: 'duplicate key value' })).toBeNull();
    expect(missingSchemaColumn({ code: '42501', message: 'new row violates row-level security policy' })).toBeNull();
  });
});

describe('saveProfile', () => {
  it('writes the profile when the database is up to date', async () => {
    const accepted = dbKnowing(FULL);
    const res = await saveProfile('u1', 'Tyler Gorin', 'Tyler_Eats', undefined, true, {
      homeCity: 'New York, New York, United States', homeLat: 40.71, homeLng: -74.01,
    });
    expect(res).toEqual({ success: true });
    expect(accepted[0]).toMatchObject({
      user_id: 'u1',
      display_name: 'Tyler Gorin',
      username: 'tyler_eats',
      is_public: true,
      home_city: 'New York, New York, United States',
      home_lat: 40.71,
      home_lng: -74.01,
    });
  });

  // The signup bug: migration 018 had never run, so PostgREST refused the
  // whole upsert over home_city and the account was never created. Entering
  // a home city must not cost someone their account.
  it('still creates the profile when the home-base columns do not exist', async () => {
    const accepted = dbKnowing([...IDENTITY, 'bio', 'is_public']);
    const res = await saveProfile('u1', 'Tyler Gorin', 'tyler_eats', undefined, true, {
      homeCity: 'New York, NY', homeLat: 40.71, homeLng: -74.01,
    });
    expect(res.success).toBe(true);
    expect(res.droppedColumns).toEqual(['home_city', 'home_lat', 'home_lng']);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ user_id: 'u1', username: 'tyler_eats', is_public: true });
    expect(accepted[0]).not.toHaveProperty('home_city');
    // The un-run migration is reported, not swallowed.
    expect(reportClientError).toHaveBeenCalledTimes(3);
  });

  it('never drops an identity column — those fail loudly', async () => {
    dbKnowing(['user_id', 'display_name', 'updated_at']); // no `username`
    const res = await saveProfile('u1', 'Tyler Gorin', 'tyler_eats');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/username/);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('keeps the friendly message for a taken username', async () => {
    upsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const res = await saveProfile('u1', 'Tyler Gorin', 'tyler_eats');
    expect(res).toEqual({ success: false, error: 'Username is already taken' });
  });

  it('surfaces any other error unchanged', async () => {
    upsert.mockResolvedValue({ error: { code: '42501', message: 'new row violates row-level security policy' } });
    const res = await saveProfile('u1', 'Tyler Gorin', 'tyler_eats');
    expect(res).toEqual({ success: false, error: 'new row violates row-level security policy' });
  });
});
