import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import ts from 'typescript';

const migration = readFileSync(new URL('../../supabase/migrations/20260910125019_audit_legacy_access_and_billing_atomicity.sql', import.meta.url), 'utf8');
const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table profiles(id uuid primary key,is_public boolean);
    create table friends(user1_id uuid,user2_id uuid);
    create table friend_profile_cache(user_id uuid,profile_data jsonb);
    create table restaurants(user_id uuid,name text,address text,google_place_id text);
    create table user_profiles(user_id uuid primary key,plan text,pro_until timestamptz,pro_source text,pro_will_renew boolean,updated_at timestamptz);
    create table subscription_events(id text primary key,user_id uuid,type text,store text,environment text,product_id text,expires_at timestamptz,payload jsonb);
    alter table subscription_events enable row level security;
    alter table user_profiles enable row level security;
    grant all on user_profiles,subscription_events to service_role;
    insert into profiles values('${a}',false);
    insert into friend_profile_cache values('${a}','{"notes":"synthetic private note"}');
    insert into restaurants values('${a}','Audit Cafe','1 Synthetic Street',null);`);
  const definitions = JSON.parse(readFileSync(new URL('./__fixtures__/legacy-security-functions.json', import.meta.url), 'utf8'));
  for (const fn of definitions) await db.exec(fn.definition);
  await db.exec(migration);
}, 30000);
beforeEach(async () => {
  await db.exec(`reset role; truncate subscription_events,user_profiles;
    insert into user_profiles(user_id,plan) values('${a}','free'),('${b}','free');`);
});
afterAll(async () => { await db?.close(); });
const update = (user = a, plan = 'pro') => ({ user_id: user, plan, pro_until: null, pro_source: 'test', pro_will_renew: true });
const receipt = (id = 'event') => ({ id, user_id: a, type: 'INITIAL_PURCHASE', payload: { event: { id } } });
const apply = (updates: unknown[], record = receipt()) => db.query<{ applied: boolean }>('select apply_billing_event($1::jsonb,$2::jsonb) applied', [JSON.stringify(record), JSON.stringify(updates)]);

it('denies the reproduced anonymous and authenticated legacy bypasses, preserving service access', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await expect(db.query('select get_cached_friend_profile($1,$1)', [a])).rejects.toThrow('permission denied');
    await expect(db.query("select update_restaurant_google_place_id('Audit Cafe','1 Synthetic Street','attacker')")).rejects.toThrow('permission denied');
    await expect(apply([update()])).rejects.toThrow('permission denied');
    await db.exec('reset role');
  }
  const grants = await db.query<{ allowed: boolean }>("select has_function_privilege('service_role','get_cached_friend_profile(uuid,uuid)','execute') allowed");
  expect(grants.rows[0].allowed).toBe(true);
  expect((await db.query<{ google_place_id: string | null }>('select google_place_id from restaurants')).rows[0].google_place_id).toBeNull();
});

it('rolls back receipts and all transfer writes if any profile update fails, then retries successfully', async () => {
  await db.exec(`delete from user_profiles where user_id='${b}'; set role service_role`);
  await expect(apply([update(a), update(b)])).rejects.toThrow('Billing profile not found');
  expect((await db.query('select * from subscription_events')).rows).toHaveLength(0);
  expect((await db.query<{ plan: string }>('select plan from user_profiles')).rows[0].plan).toBe('free');
  await db.exec(`insert into user_profiles(user_id,plan) values('${b}','free')`);
  expect((await apply([update(a), update(b)])).rows[0].applied).toBe(true);
  expect((await db.query<{ plan: string }>('select plan from user_profiles')).rows.map(row => row.plan)).toEqual(['pro','pro']);
});

it('only suppresses completed deliveries and can repair an old receipt with no completion marker', async () => {
  await db.exec(`insert into subscription_events(id,type,payload) values('event','INITIAL_PURCHASE','{}'); set role service_role`);
  expect((await apply([update()])).rows[0].applied).toBe(true);
  expect((await apply([update(a, 'free')])).rows[0].applied).toBe(false);
  expect((await db.query<{ plan: string }>('select plan from user_profiles where user_id=$1', [a])).rows[0].plan).toBe('pro');
  expect((await db.query<{ processed_at: string | null }>('select processed_at from subscription_events')).rows[0].processed_at).not.toBeNull();
});

it('the actual webhook retries a failed database transaction and only then acknowledges duplicates', async () => {
  const source = readFileSync(new URL('../../supabase/functions/billing-webhook/index.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replace(/^import .*;\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let handler!: (req: Request) => Promise<Response>, attempts = 0;
  await db.exec('set role service_role');
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    rpc: async (name: string, args: { event_record: ReturnType<typeof receipt>; plan_updates: unknown[] }) => {
      expect(name).toBe('apply_billing_event');
      if (++attempts === 1) return { error: { message: 'synthetic outage' }, data: null };
      const result = await apply(args.plan_updates, args.event_record);
      return { error: null, data: result.rows[0].applied };
    },
  };
  const deno = { env: { get: (key: string) => key === 'REVENUECAT_WEBHOOK_SECRET' ? 'test-secret' : undefined }, serve: (fn: typeof handler) => { handler = fn; } };
  new Function('Deno','serviceClient','subscriberSnapshot','UUID_RE','withRequestTelemetry','console',code)(deno,()=>client,async()=>({state:{plan:'pro',proUntil:null,proSource:'test',proWillRenew:true},observedAtMs:1000}),/^[0-9a-f-]{36}$/,(_name: string, fn: unknown)=>fn,{error() {}});
  const request = () => new Request('https://example.invalid', { method:'POST', headers:{ Authorization:'Bearer test-secret' }, body:JSON.stringify({event:{id:'webhook',type:'INITIAL_PURCHASE',app_user_id:a,entitlement_ids:['pro']}}) });
  expect((await handler(request())).status).toBe(500);
  const retried = await handler(request());
  expect(retried.status).toBe(200); expect(await retried.json()).toMatchObject({applied:true});
  expect(await (await handler(request())).json()).toMatchObject({duplicate:true});
  expect((await db.query<{ plan: string }>('select plan from user_profiles where user_id=$1',[a])).rows[0].plan).toBe('pro');
});
