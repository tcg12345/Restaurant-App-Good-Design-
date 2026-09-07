# GoodEats owner analytics

The code is built locally. Nothing in this change enables collection or modifies the live Supabase project. Start with Supabase; PostHog is optional.

## 1. Apply the database migration

Open the SQL Editor in the **same Supabase project used by this app**, create a query, paste the contents of `supabase/migrations/20260907203935_owner_analytics.sql`, and run it once. It requires the existing admin migration (`034_verified_users.sql`) and creates independent analytics tables and reporting functions. Do not rerun the entire migration after it succeeds.

This repository has existing manually applied migrations; avoid blindly running `db push` over the entire history. Your normal migration deployment process is also fine if its history is reconciled.

The existing `app_admins` allowlist controls dashboard access. To check membership in the SQL Editor:

```sql
select a.user_id, u.email
from public.app_admins a join auth.users u on u.id = a.user_id;
```

If your account is missing, insert **your exact Supabase Auth user UUID** (Authentication → Users):

```sql
insert into public.app_admins(user_id)
values ('YOUR-AUTH-USER-UUID')
on conflict do nothing;
```

Sign out and back in after changing membership. This uses the app’s existing admin system; everyone on that allowlist can read analytics. Ordinary users and guests can only submit events.

## 2. Enable the app and deploy

Add these build variables in your web hosting project and `.env.local` for local testing:

```dotenv
VITE_ANALYTICS_ENABLED=true
VITE_ANALYTICS_INCLUDE_ADMINS=false
VITE_ANALYTICS_SEARCH_TERMS=false
VITE_APP_VERSION=1.0.0
```

Keep the version aligned with your releases. Rebuild/redeploy the web app through your usual hosting workflow. These are build-time settings: changing them without rebuilding does nothing.

For iOS, run `npm run ios:sync`, then build and distribute the updated app through your normal Xcode/TestFlight workflow. Older installed versions do not gain tracking automatically.

Open **Settings → Administration → Analytics**, or `/admin/analytics`, while signed into your admin account.

## 3. Enable backend API logging

In Supabase → Edge Functions → Secrets, add `ANALYTICS_ENABLED=true`. This is separate from `VITE_ANALYTICS_ENABLED`.

Redeploy the instrumented Edge Functions. From the repository root, after signing into the Supabase CLI, replace `YOUR_PROJECT_REF` with your existing project reference:

```sh
supabase secrets set ANALYTICS_ENABLED=true --project-ref YOUR_PROJECT_REF
supabase functions deploy location-chat build-recipe import-recipe import-restaurants generate-recipe-image group-swipe group-place-summary cuisine-lookup billing-checkout billing-portal billing-sync mux-upload-init mux-set-visibility --project-ref YOUR_PROJECT_REF --use-api
```

Those functions and their shared helpers contain the current paid outbound calls. The other handlers also have the shared request wrapper, so deploying them through your normal release workflow is fine. The existing `config.toml` auth settings remain in effect. No new credentials are needed: Supabase supplies its service-role credential to Edge Functions. **Never place a service-role credential in a VITE variable.**

Frontend calls and backend calls are distinct network hops. For example, a browser call to `group-swipe` and that function’s Google request both appear, with different providers. The existing `x-client-info` header carries a random correlation ID and normalized page name so server calls can be tied back to the initiating client request. Authentication establishes the user identity; the header does not grant access.

## 4. Add cost rates

Request counts and latency work immediately. Dollar totals stay “Unpriced” until you configure rates in `analytics_rates` using the SQL Editor. Unpriced requests are excluded from cost totals and visibly counted.

Use your provider’s actual price and effective date. The table accepts USD **per 1,000 requests**. For Google Places, copy the exact field mask from a logged request: different masks can use different billing tiers. Rate matching is exact. Separate rate rows can cover the same endpoint with different masks or effective dates.

Find the rate keys being used:

```sql
select properties->>'provider' provider,
       properties->>'endpoint' endpoint,
       coalesce(properties->>'field_mask', '') field_mask,
       count(*) calls
from public.analytics_events
where event = 'api_request'
group by 1, 2, 3
order by calls desc;
```

Example **template**, not a current price quote; replace every placeholder before running:

```sql
insert into public.analytics_rates
  (provider, endpoint, field_mask, usd_per_1000, effective_from)
values
  ('google_places', 'details', 'EXACT_FIELD_MASK', YOUR_USD_RATE, 'YOUR_EFFECTIVE_DATE');
```

For non-Places endpoints, use an empty field mask. Leave token-, image-, bandwidth-, and minute-priced APIs unpriced until you have a defensible per-request estimate, or reconcile them externally. This version measures request counts and latency; it does not extract AI token usage or Mux video minutes. Never price internal `edge_function` calls as if they were a second Google request.

Costs are estimates, not invoices. Google free allowances, volume discounts, provider credits, failed-request billing rules, and your contract can affect the actual bill. Compare with [Google Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) and your provider consoles.

## 5. Optional: connect PostHog

Create a project in PostHog and copy its **project ingest token** and ingest host from Project Settings. Add them to your web build environment and local `.env.local`, then rebuild:

```dotenv
VITE_POSTHOG_KEY=YOUR_PROJECT_INGEST_TOKEN
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_REPLAY=false
```

Use your project’s EU host if you chose the EU region. Do not use a personal API key here. Supabase remains the source for the in-app dashboard; the same client events are also forwarded to PostHog. Backend provider telemetry stays in Supabase.

In PostHog, create these saved insights:

- **Ordered restaurant funnel:** `search_completed` → `restaurant_search_selected` → `restaurant_opened` → `restaurant_saved`. Break down by platform and event source. For a funnel about the *same restaurant*, hold `restaurant_id` constant starting at selection; a broad search has no single restaurant ID.
- **Activation funnel:** `onboarding_step` (use your completed-step value) → `restaurant_opened` → `restaurant_saved`.
- **Paywall funnel:** `billing_event` filtered by `properties.stage`: `paywall_shown` → `purchase_started` → `purchased`.
- **Retention:** returning `page_view` visitors, split by features used and platform.
- **Journeys:** user paths from `page_view`, broken down by its `page` property.
- **Quality:** `ai_feedback` split by `properties.verdict`; `client_error` by app version and page.

The app uses the Supabase Auth UUID to identify signed-in PostHog users and resets identity after sign-out/account switches. Native events and web events share this identity after sign-in. Guest tracking uses an install ID. Raw URL/referrer and automatic person-set properties are stripped; text-field autocapture is disabled.

Session replay is deliberately off. If you choose to use it, test web and the iOS WebView, check your disclosure/consent flow, then enable `VITE_POSTHOG_REPLAY=true` and rebuild. Text and inputs are masked; images, videos, canvas, and `[data-analytics-private]` are blocked. Do not enable network request-body capture. See [PostHog privacy controls](https://posthog.com/docs/session-replay/privacy).

## What is measured

| Area | Events / meaning |
|---|---|
| Pages | `page_view` once per navigation; `page_engagement` in short increments while foregrounded and active. Pauses after 60 seconds without input. iOS app background state is handled. |
| Visible controls | `feature_seen` for visible annotated controls / recognized navigation destinations; `feature_used` for their interactions. Native tab bar interactions are included. |
| Feature outcomes | `feature_outcome` for rating saves, filter opens/applies, assistant opens/message submissions. More explicit events can be added through the shared `track` helper. |
| Provider results | `restaurant_returned` when the central Places mapping returns a restaurant. One search can return many restaurants; these are not separate paid calls. |
| Visible restaurants | `restaurant_seen` when at least half of a shared restaurant card or search-result card is visible. Deduplicated per mounted element per navigation, not every React render. |
| Search | `search_completed` for current completed restaurant search results and AI restaurant searches; result counts and city where available. `restaurant_search_selected` when a result or recent search is opened. This measures explicit selection, not proof that a query was the restaurant’s exact name. |
| Detail visits | `restaurant_opened` on detail pages and restaurant panels, including source surface. |
| Saves and reviews | Wishlist additions/removals, restaurant ratings, and list additions. Local save actions are recorded; a save event does not claim a later cloud sync succeeded. |
| Sharing | Restaurant shares queued in-app, copied links, and successful external share-sheet outcomes. Does not claim the recipient read the share. |
| Outbound | Directions, phone and website actions on mobile and desktop detail pages. Counts taps, not confirmed visits or reservations. |
| Quality / business | Existing onboarding, paywall, and AI-feedback events flow into the common sink. Sanitized error categories also appear. Historical events in the older tables are not automatically backfilled. |
| API requests | Known provider fetch requests from the webview/browser, plus explicit outbound fetches in backend functions. Status, latency, endpoint, source, restaurant ID when applicable, request ID and Places field mask. Memory details-cache hits are separate events. |

Restaurant search, display, opens and API calls are deliberately separate measures. Details opened from retained screens do not count merely because a hidden component remained mounted.

## Reading the dashboard accurately

- Date ranges are rolling 7 / 30 / 90 days. Daily chart buckets use UTC; event times display in your browser’s time zone.
- Counts are aggregated in Postgres, not computed from a silently capped client download. Restaurant ranking queries the full selected period and returns the top 250 for the chosen metric. API groups are top 250; users are the 200 most recently active. CSV exports the currently shown, filtered rows, not the entire database. Visitor timelines load older events in pages of 100.
- Signed-in activity is grouped by user UUID; anonymous activity by install ID. The in-app dashboard does not retroactively merge pre-signup events into the signed-in identity. PostHog provides that identity-linking workflow.
- Retention uses the first observed page visit in retained analytics history and only counts cohorts old enough to complete the return window. No historical activity can be reconstructed from this instrumentation alone.
- Zero-use features are listed. Navigation exposure and actual action instrumentation are separate; a zero exposure count can mean a user entered directly or used a surface without an exposure marker.
- Search terms are off by default. Set `VITE_ANALYTICS_SEARCH_TERMS=true` only if you want redacted query breakdowns. Counts still work without search text. City coverage is available where the search caller supplies a city; other searches are labeled unspecified.
- Existing native SDK networking, Mapbox requests made outside `window.fetch`, database internals, and third-party requests outside the instrumented code are not captured by this request logger. It is not a replacement for provider billing/monitoring.
- Client events are best effort and untrusted. Ad blockers, opt-out, offline use, app termination, and a full queue can cause gaps. The queue batches 40 events, retries with stable IDs, and caps memory at 300 events. No private message bodies, contact lists, passwords, precise coordinates or API keys are copied into the analytics event stream.
- Client admin activity is excluded by default. Server API logs still record legitimate provider usage by admins, because it incurs costs. The replay and user-activity display are read-only.

## Retention and operational checks

The migration includes a service-only `analytics_prune()` function that removes event rows older than 180 days. It is **not scheduled automatically**. In Supabase Cron, create a daily SQL job executing:

```sql
select public.analytics_prune();
```

Run the job with the database maintenance role. Auth-user deletion cascades to associated analytics rows. Guest rows expire with retention. If PostHog is enabled, handle its retention and person deletion separately in PostHog.

Users can turn off client analytics under **Settings → Privacy & permissions → Share usage analytics**. The operational server API log remains enabled independently. To stop collection globally, deploy with `VITE_ANALYTICS_ENABLED=false` and set the Supabase secret `ANALYTICS_ENABLED=false`.

Before launch, test with a regular account (your admin browsing is excluded):

1. Browse home → search → open a restaurant → save it → open it again.
2. Wait approximately 10 seconds, then refresh the owner dashboard.
3. Check page visits, the search selection, detail visit, save, and cache-hit counts.
4. Trigger an AI or group-search operation and verify server rows have `origin=server`, a source function, and a user UUID.
5. Confirm a non-admin account cannot open the analytics page or call `analytics_report`.
6. Confirm opting out prevents new client events; confirm your configured cost masks match actual request rows.

You can use PostHog’s saved-insight alerts for meaningful changes. Automatic external notifications and billing-import jobs are not provisioned by this change.

## Local verification and preview

```sh
npm run build
npm test
node scripts/analytics/verify-database.mjs
npm run dev
```

Open `/scripts/analytics/preview.html` on the local Vite server for an isolated layout preview with clearly labeled synthetic data. It is not an app route or production entry point and never requests real analytics. The database verification runs the real migration in embedded PostgreSQL, testing guest/user read denial, owner reads, spoofed identities/origins, malformed fields, deduplication, estimates and timeline queries. No production data is used by these checks.
