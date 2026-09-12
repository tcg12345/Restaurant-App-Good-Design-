# Second implementation batch — September 10, 2026

This batch addresses S5 (recipe URL fetching), the reel/post portion of S4 (private media), and the remaining U2 public-query failures. **Private visit/recipe/guide/chat photos in the `photos` bucket are still public and remain an open priority finding.**

## Deployed

- `import-recipe` version 14 uses a shared destination validator and bounded page reader. Every redirect is validated independently. DNS answers must all be public; the TCP connection uses the selected checked IP. Native Deno TLS verifies the original hostname and sends its SNI without resolving again. Credentials, local/private/reserved addresses, nonstandard ports and unsupported protocols are rejected. The reader limits page bytes, headers, redirect count and total elapsed time; it rejects incomplete or ambiguous framing. It sends no caller cookies, bearer tokens or provider keys to the source website.
- The fetcher requests uncompressed HTML/text and rejects servers that insist on compressed responses. Existing paste-text and photo import modes remain available. Sites requiring browser execution/login may still decline imports. This is not a promise of universal recipe-site compatibility.
- Applied `20260910131404_audit_reel_storage_and_expert_schema.sql`. The `reels-videos` bucket is now private. Reel and post object reads cover the video/media and its `.jpg` poster, with owner previews for unpublished uploads. Published references must match the author's folder, preventing another user's public post from exposing a copied private path. Visibility otherwise follows the existing public/owner/accepted-follower rules.
- Created the previously missing `expert_recommendations` table. Publishing/updating requires the current user to own the recommendation and be verified; public reads only return verified authors' recommendations. Deletion remains author-only.
- Guests can read shared restaurant cuisine labels and additional tags. Guest writes remain disallowed.

Existing signed URLs remain valid until their expiry, and previously downloaded files cannot be recalled by a storage-policy change. The current reel/post client uses a 24-hour signing TTL; shortening it and reviewing account-switch cache behavior are follow-up work. Existing production reel content uses Mux, which is unaffected by this legacy storage change.

## Application changes ready locally

- Expert recommendations fetch their rows once, then hydrate author display data in one batch. Removed the invalid join through an `auth.users` foreign key and its failed-request fallback.
- Cuisine enrichment checks the local session before contributing a cache write. Guests keep the displayed cuisine without sending an unauthorized write; network/cache errors cannot become unhandled promise rejections.
- Location/profile maps avoid replacing their just-created style with the same style. Actual theme changes wait for initial style loading, retaining the camera and DOM markers. This removes the reproduced initial style-diff rebuild warning.

These client changes, along with the first batch's client fixes, have **not been released to the website or installed in a new iPhone build** during this batch.

## Validation and limits

- **1,476 tests passed in 156 files**, including 57 new cases this batch. See `batch2-tests.log`.
- PGlite tests execute the actual migration with synthetic accounts and RLS roles: anonymous/stranger denial, owner previews, accepted versus pending/removed follows, visibility changes, posters, malicious copied references, verified-author writes and guest cuisine access.
- URL/HTTP tests exercise private and alternate-format addresses, mixed DNS answers, DNS changes between redirects, relative redirects, redirect loops, host/certificate settings, fragmented responses, byte/header limits, truncated bodies and ambiguous HTTP framing.
- Final TypeScript check and production build passed; see `batch2-build.log`. The existing bundle-size warning remains.
- Local Deno 2.1.14 and Supabase's hosted Edge runtime both fetched `example.com` and BBC Good Food's recipe page using the new transport. The temporary fixed-target hosted smoke function was deleted after verification. No test endpoint remains, and no AI-provider call was needed for this check.
- The deployed import endpoint returns 401 before work for a request without authentication. A complete signed-in AI transcription was not exercised in this batch.
- Live anonymous signing and a one-byte public media download from the private `post-media` bucket succeeded (HTTP 206). Experts and cuisine reads returned HTTP 200 after migration. All existing reel/post paths were checked in aggregate for author-folder compatibility; no mismatches were found. There is no live legacy reel path to exercise, so reel authorization behavior is covered by the database fixtures rather than a production private-video fetch.
- Local guest flow: Discover → New York recommendations → Chalong Southern Thai → Back loaded successfully. The restaurant page produced no `[Expert]` or `[Cuisine]` warnings. After the map follow-up, no new style-diff rebuild warning appeared.
- Discovery did produce PostHog client-rate-limit errors. That event-volume issue is retained for the performance batch; these checks do not establish a warning-free app or flawless iOS animation performance.
- Post-migration Supabase security advisors were fetched. The existing discovery-view, mutable-search-path, definer-grant inventory, password-protection and database-version findings remain; no new definer function was introduced. See `batch2-advisors.json`. [Supabase database linter documentation](https://supabase.com/docs/guides/database/database-linter).

## Next: coordinated photo privacy rollout

Do not flip `photos` private while shipping clients still consume permanent public URLs.

1. Introduce one canonical photo-reference resolver that signs authorized reads without persisting signed tokens into ratings, recipes, guides, chats or offline records. Cover image components, CSS backgrounds, image editors/canvas, sharing and upload previews. Handle refresh, errors, account changes and in-flight requests.
2. Define object permissions from owner access and explicitly shared references: public/authorized community photos, published public recipes (including step images), and published public guides (including entry images). Bind every reference to the object owner's folder so copied URLs cannot grant access. A public profile alone must not expose all its private uploads.
3. Inventory legacy visit photos stored under `avatars/restaurant-photos` separately from intentionally public avatars. Prepare an idempotent migration and retain a reversible reference mapping. Add upload size/type limits consistent with each current uploader.
4. Test owner, authorized viewer, guest and stranger access with synthetic records, including offline cache, revocation, upload-before-publish, account switching and expired URLs.
5. Release compatible web and iOS readers, verify the supported app versions, then migrate objects/references and close public bucket access. Verify storage and CDN behavior, not just whether gallery rows are hidden.

After photo privacy, continue with discovery-view access, dependency/platform hardening, native metadata persistence, bundle splitting, evidence sync and analytics event volume.
