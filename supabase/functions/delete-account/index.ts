// Account deletion — Supabase Edge Function (Deno).
//
// Permanently deletes the calling user's account and all associated
// data, in-app, as required by App Store Review Guideline 5.1.1(v).
// The caller is identified from their own JWT (requireUser) — a user
// can only ever delete themselves.
//
// What gets removed:
//   1. Storage objects — the user's folders in the `reels-videos` and
//      `post-media` buckets (storage does not cascade from auth.users).
//   2. The auth.users row via the admin API. Every application table
//      (user_app_data, user_profiles, user_friends, community_ratings,
//      community_photos, recipes, recipe_reviews, posts/*, reels/*,
//      guides, saved_guides, activity_*, expert_recommendations,
//      visit_history, hotel_dining, home_rec_cache) declares
//      REFERENCES auth.users(id) ON DELETE CASCADE, so the row delete
//      wipes them all transactionally.
//
// Requires the service-role key, which is injected into every Edge
// Function automatically as SUPABASE_SERVICE_ROLE_KEY and never
// reaches the browser bundle.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS, requireUser } from '../_shared/auth.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

/** Buckets that store per-user media under a `{userId}/...` prefix. */
const USER_BUCKETS = ['reels-videos', 'post-media'];

/** Remove every object under the user's folder in one bucket. Paged so
 *  prolific posters (>100 objects, the default list page size) are fully
 *  cleaned. Errors are logged but don't abort the account delete — an
 *  orphaned video must not leave the user's identity undeletable. */
async function purgeBucketFolder(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  userId: string,
): Promise<void> {
  try {
    for (;;) {
      const { data: items, error } = await admin.storage.from(bucket).list(userId, { limit: 100 });
      if (error || !items || items.length === 0) {
        if (error) console.warn(`[delete-account] list ${bucket}/${userId}:`, error.message);
        return;
      }
      const paths = items.map((it: { name: string }) => `${userId}/${it.name}`);
      const { error: rmError } = await admin.storage.from(bucket).remove(paths);
      if (rmError) {
        console.warn(`[delete-account] remove ${bucket}:`, rmError.message);
        return;
      }
      if (items.length < 100) return;
    }
  } catch (err) {
    console.warn(`[delete-account] purge ${bucket} exception:`, err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  const { userId } = auth;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1. Media files first — once the auth row is gone we lose the handle
  //    on whose files these are.
  for (const bucket of USER_BUCKETS) {
    await purgeBucketFolder(admin, bucket, userId);
  }

  // 2. The auth user. ON DELETE CASCADE clears every application table.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[delete-account] deleteUser failed:', error.message);
    return new Response(
      JSON.stringify({ error: 'Could not delete the account. Please try again.' }),
      { status: 500, headers: JSON_HEADERS },
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
});
