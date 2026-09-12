# GoodEats audit — September 10, 2026

Historical findings from the initial audit. Subsequent fixes and verification are recorded in [RELEASE.md](RELEASE.md) and the numbered BATCH notes; the findings below are not a statement of current release status. Raw diagnostic files referenced here remain local because they can contain private test-account data.

The audit found security defects that should be addressed before onboarding real users, a reproducible billing recovery bug, visible interface inconsistencies, and substantial startup payload overhead. A successful build and existing passing tests do not cover these defects.

Scope: production public UI at https://grubbyrater.com, source at commit `6529bc5c44545c9946b87057863510caf0e8dd69`, Supabase live schema/grants/policies and selected deployed function source, dependency audit, and prior iOS verification evidence. This was an audit: no application, database, deployment, or account changes were made. Reproductions used isolated fictional data. No private production profiles were retrieved through the vulnerable functions.

Priority: P1 = address before launch or further real-user onboarding; P2 = next reliability/design/performance work; P3 = measured hardening or consistency work. These are engineering priorities, not CVSS scores. Evidence labels distinguish local reproductions, live observations, code findings, and profiling follow-ups.

## Findings requiring priority attention

### S1 — P1: Legacy database functions bypass private-profile access

**Evidence: live function definitions and grants; isolated reproduction.** `get_cached_friend_profile(target_user_id, requesting_user_id)` is a SECURITY DEFINER function executable by `anon`. It trusts the caller-supplied requesting identity. Supplying the target identity as the requester passes its ownership check. `build_friend_profile_cache(target_user_id)` is also anonymous-executable and lacks a caller authorization check; it builds profile data including restaurant/wishlist content. Table RLS does not repair authorization omitted inside a privileged function.

The local reproduction proves that an anonymous role unable to read the cache directly can retrieve a fictional private note by spoofing the requester. Related legacy readers (`get_friend_profile_data`, `get_friend_wishlist_data`, `get_lightning_fast_friend_profile`, `get_friends_with_scores`, and `debug_friend_ratings`) need the same identity/visibility review; the two-function reproduction does not imply every reader was separately exploited.

**Remediation:** revoke unnecessary anonymous execution; derive the requester from `auth.uid()` inside every reachable privileged function; reject null identity where appropriate; enforce the actual owner/friend/public rule before reading or populating a cache. Restrict the cache builder to authorized internal callers. Remove unused legacy entry points through a migration. These definitions were found in the live database, not the current source tree: deploying the frontend will not remove them.

**Retest:** anonymous, unrelated signed-in user, accepted friend, owner, private/public transitions, forged requester argument, and direct builder calls. Verify allowed callers still work.

### S2 — P1: Anonymous callers can modify other owners' restaurant links

**Evidence: live definitions/grants; isolated reproduction.** `update_restaurant_google_place_id` updates matching restaurant names/addresses without caller or owner checks and is anonymous-executable as SECURITY DEFINER. A local anonymous call changed another fictional owner's `google_place_id`. `aggressive_restaurant_linking`, `auto_link_all_restaurants`, and `simple_emergency_link` expose related global linking operations and require containment too.

**Impact:** incorrect restaurant identity and links can contaminate saved restaurant data. This is an integrity issue independent of whether the current frontend calls these functions.

**Remediation:** make global maintenance routines service-only; scope any legitimate user operation to its owner and validate the proposed identity. Revoke stale grants explicitly, including PUBLIC grants. Retest unauthorized calls and owner-scoped linking in an isolated database.

### S3 — P1: Legacy AI endpoints lack authentication and usage controls

**Evidence: deployed source/configuration.** `determine-cuisine` and `perplexity-restaurant-info` have gateway JWT verification disabled and lack compensating handler authentication/quota checks. Their handlers invoke paid OpenAI/Anthropic APIs using server-side keys. Gateway verification being disabled is not itself a vulnerability when a handler validates identity; these particular handlers do not.

**Impact:** anonymous invocation can consume provider resources if the configured keys and provider models remain functional. No paid requests were issued to demonstrate spending, and provider availability was not assumed.

**Remediation:** disable unused legacy endpoints or apply shared identity validation, server-enforced quotas and request limits. Inventory all 66 deployed functions against the much smaller current repository inventory. For comparison, the inspected legacy account-deletion handler does validate the requesting user; it was not flagged solely for its gateway setting.

### S4 — P1: Private visit photos use publicly readable storage

**Evidence: live bucket/policy metadata and upload path.** The `photos` and `reels-videos` buckets are public and their public SELECT policies permit reads/listing within those buckets. `src/lib/images.ts:139` uploads to `photos` and returns a permanent public URL, without an audience parameter. `ListsContext.tsx:1873` retries rating-photo uploads through this same path. Gating a community gallery separately does not protect the underlying object URL.

**Impact:** profile/visit privacy cannot guarantee photo confidentiality while its files remain public. This does not mean every publicly published reel should become private.

**Remediation:** separate intentionally public media from private visit content; authorize private reads and generate appropriate short-lived access URLs. Plan migration of existing private objects and cached public URLs. Add appropriate MIME/size limits: the inspected photos/reels buckets have no bucket-level limits configured. Test access as owner, authorized viewer, stranger, and anonymous caller, including after a visibility change.

### S5 — P1: Recipe URL fetching can bypass its initial destination check

**Evidence: current and deployed code; internal network access was not probed.** `supabase/functions/import-recipe/index.ts:345` validates the initial hostname and rejects common private IP literals. `fetchPage` at line 411 then uses `redirect: 'follow'`. Redirect targets are not revalidated, and a public hostname resolving to a private address is not covered by the string check.

**Impact:** an authenticated caller can supply a URL whose eventual destination falls outside the intended public-web boundary. Actual reachable internal services depend on the hosting network and were not established.

**Remediation:** disable automatic redirects and validate each allowed hop; enforce public destinations at the network/egress layer or use a constrained fetch service, covering DNS resolution and rebinding. Bound response sizes, timeouts, and redirect count. Use a local fake server to test redirect/private-address cases without probing production infrastructure.

### R1 — P1: Billing retries can acknowledge an entitlement update that never succeeded

**Evidence: current/deployed code and isolated handler reproduction.** `supabase/functions/billing-webhook/index.ts:108` inserts the event before applying the entitlement. A plan-write failure returns 500, but a retry encounters the existing event ID and returns 200 at line 119 without retrying `writePlan` at line 152.

**Reproduction:** first delivery fails its plan write; second delivery returns `{duplicate:true}`; the plan writer was attempted only once. A valid purchase or cancellation can therefore remain unapplied after a transient database error.

**Remediation:** atomically apply the event and entitlement, or track received/processing/processed status and only suppress successfully processed events. Ensure transfers recover from partial writes. Test transient errors, concurrent duplicate deliveries, and ordering before release.

## Security hardening and deployment consistency

### S6 — P2: Search view exposes a broader anonymous audience than base-table policy

**Evidence: live metadata.** `profiles_public_search` is a definer view granted to anonymous callers. It includes profiles where `is_public OR allow_friend_requests`, exposing discovery fields including home city and bio. The corresponding base-table discovery policies require an authenticated caller. The view therefore widens the audience, including some private profiles that allow friend requests.

**Remediation:** explicitly decide which discovery fields/audiences are intended; use an invoker view or a narrowly authorized API and grants consistent with that decision. Do not blindly switch view security without checking that legitimate search still works. [Supabase documents the view/RLS distinction](https://supabase.com/docs/guides/database/postgres/row-level-security#views).

### S7 — P2: Dependency and platform patches are outstanding

The fresh dependency audit reports **17 affected packages: 1 critical, 10 high, 4 moderate, 2 low**. These counts are advisory classifications, not 17 demonstrated production exploits. The critical `tar` dependency comes through `@capacitor/cli`; Vite/Vitest findings primarily concern development/build environments. `react-router-dom` and Mapbox's `protocol-buffers-schema` dependency are in runtime dependency paths, but SSR/RSC-specific router advisories do not automatically apply to this static BrowserRouter app.

**Remediation:** update in controlled groups, inspect the individual advisories and actual paths, then run build/tests and native packaging. Avoid a blind forced major-version upgrade. The Supabase advisor also reports outstanding patches for `supabase-postgres-17.4.1.069` and disabled leaked-password protection. Schedule the supported database upgrade and enable password protection with a sign-up/reset regression check.

### S8 — P2: Browser response hardening is incomplete

The inspected production HTML response has HSTS, but no Content-Security-Policy, frame restriction, Referrer-Policy, or X-Content-Type-Options header. `vercel.json` currently provides SPA rewrites. Absence of CSP is not proof of an XSS exploit.

**Remediation:** introduce an app-compatible CSP in report-only mode, then enforce it; set an appropriate `frame-ancestors`, referrer policy and `nosniff`. Validate maps, images, OAuth, analytics, workers, and Capacitor behavior before enforcement.

## Functionality and design

### U1 — P1: The restaurant sheet covers the guest sign-in form

**Evidence: live reproduction, screenshot, DOM layers, and code.** Guest → Search → open Hey Thai → Rate this place. Requiring sign-in is correct and explicitly confirmed by the user. The defect is only presentation: the restaurant sheet remains in front of the form, blocking it.

The sheet is promoted into the browser top layer by `src/lib/useBottomSheet.ts:66`; the sign-in overlay at `src/contexts/SignInModalContext.tsx:57` is an ordinary `z-[100]` element. Raising its numeric z-index will not put it above a top-layer popover. Both were exposed as modal dialogs at once.

**Remediation:** coordinate sheet dismissal/suspension and authentication presentation, or use the existing top-layer overlay infrastructure, with focus transfer and restoration. Retest all guest account-only actions originating inside sheets, cancellation, successful sign-in, and return to the intended action.

![Restaurant sheet covers sign-in](sign-in-behind-restaurant.png)

### U2 — P2: Public browsing makes requests that fail by design or schema mismatch

**Evidence: live browser warnings, saved in `browser-warnings.json`.**

- `guide_save_counts` returns permission denied for the guest. `src/lib/supabase-guides.ts:680` catches it and renders no count; migration 061 grants only authenticated execution. Align guest UI requests with the intended count visibility instead of repeatedly making a forbidden request.
- Expert recommendation queries report that `public.expert_recommendations` is missing from the API schema cache. `src/lib/supabase-community.ts:1832` then retries the same missing table without the join, returning an empty list. Check actual deployment/migration state and schema exposure; a fallback cannot repair an unavailable table. The public UI cannot distinguish this failure from no recommendations.
- Cuisine caching reports an RLS-rejected insert (`src/lib/restaurant-cuisine.ts:221`). Gate guest cache writes or route trusted cache updates through a properly authorized service; do not loosen RLS just to silence the warning.

These warnings are actual failed operations. They do not establish that the entire page failed to render.

### U3 — P2: Dark mode changes inconsistently between maps

Search and the restaurant sheet use a dark map, while full restaurant detail displays a bright light map within a dark screen. `src/pages/useRestaurantDetail.ts:144` hardcodes `mapbox/light-v11`; `LocationPage.tsx:1539` and `UserProfile.tsx:455` contain similar hardcoded styles.

**Remediation:** centralize map style selection and theme-change handling. Verify both initial theme and switching while the map is mounted, preserving markers/camera after style replacement.

![Bright map inside dark restaurant detail](restaurant-dark-light-map.png)

### U4 — P2: Experts empty-state text is too faint and loses its page heading

`src/pages/Experts.tsx:182` returns an empty-state layout before the regular heading. At lines 190–191 the normal-size text uses 40%/30% foreground opacity. Computed foreground/background composition in the inspected dark theme yields approximately **3.49:1** and **2.53:1** contrast. Both fall below the **4.5:1** requirement for normal text. These are CSS color calculations, not an automated whole-app accessibility certification. [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Remediation:** keep the page heading/navigation shell for empty states and use readable semantic secondary-text tokens. Audit muted text in filters, cards and forms in both themes.

![Experts empty-state contrast](experts-empty-low-contrast.png)

### U5 — P2: Small form text and viewport settings constrain readability

`index.html:11` declares `maximum-scale=1.0`. Plan editor search/detail fields use 12px text (`src/components/calendar/PlanEditor.css:60,156`). Platform behavior varies, so the meta tag is a confirmed constraint rather than proof that every iOS browser prevents zoom.

**Remediation:** allow user scaling and use comfortably readable input sizes; test keyboard focus/autozoom in the actual WKWebView and larger text settings. Check clipping and reachability with the keyboard open.

### U6 — P3: Typography and control styling vary between related flows

**Evidence: visual review and CSS; design judgment.** The plan editor uses a prominent Fraunces display heading (`PlanEditor.css:44`), while nearby calendar/filter/detail flows use sans-serif headings. Global type tokens name Manrope, body/headings use Archivo, and several feature styles introduce system/Inter stacks. Plan/recipe primary actions are mint while restaurant/guide primary actions are white in dark mode. Close controls vary between filled circles and outlined/glass treatments.

These choices are not inherently invalid, but currently make adjacent flows feel like separate products. Define the intended hierarchy first, then share title, primary-action, close-button, field and sheet tokens. Preserve deliberate editorial exceptions explicitly. Include loading/empty/error states in the same review.

![Plan editor typography and controls](plan-editor-style.png)

## Loading, persistence and animation

### P1 — P1: The main entry payload is too large for a fast cold start

**Evidence: successful fresh production build.** Main JavaScript is **6,573.65 kB raw / 1,860.42 kB gzip**; main CSS is **1,069.06 kB / 164.54 kB gzip**. The separately loaded Michelin chunk adds **4,070.90 kB / 738.89 kB gzip** when requested. It is lazy-loaded and should not be described as always part of first load.

`src/App.tsx` eagerly imports most routes and many global providers/composers. A guest pays substantial download/parse cost before using much of the app. Blank intervals were observed during initial navigation; no reliable duration or frame timing was captured. Local and deployed JS hashes differ, so these exact byte counts describe the local build, not a byte-for-byte assertion about the deployed artifact.

**Remediation:** split route groups and heavy map/media/editor components; defer optional global surfaces; render a lightweight initial shell. Inspect bundle composition before changing caching. Measure cold and warm start on the iPhone, constrained network, and a lower-end device. Record LCP/INP/CLS for web and first useful interaction for native.

### P2 — P2: Native restaurant metadata persistence has already failed

**Evidence: prior real-device verification log.** `saveToStorage(goodeats-restaurant-meta) failed even after stripping images` was emitted on the phone. This is a confirmed failed cache write; exact cause and lost user-visible state were not established. The warning concerns restaurant metadata, not proof of a failed ranking-evidence write.

**Remediation:** inspect payload sizes through safe diagnostics, bound/evict recomputable caches, and keep durable user data separate. Move larger records off synchronous localStorage as appropriate. Test low-storage/quota failure, app termination/relaunch, and offline recovery using synthetic fixtures. Do not silently label failed persistence a successful save.

### P3 — P2: Ranking evidence sync repeatedly processes full history

**Evidence: code review; future growth concern.** `src/lib/supabase-ranking-evidence.ts` downloads the owner's paginated history during sync and retries on visibility/online/minute triggers. The local journal is serialized as it grows. With today's small dataset this is not a demonstrated slow screen, but work grows with lifetime history rather than new events.

**Remediation:** retain complete evidence server-side, use incremental cursors plus a pending outbox, and keep durable writes efficient. Retest offline creation, duplicate delivery, owner isolation, multiple devices, and crash recovery. Preserve the current separation from displayed H2H scores.

### P4 — P2: Database performance warnings need representative query tests

The live advisor reports 20 unindexed foreign-key findings, 174 auth/RLS initialization findings, 78 multiple-permissive-policy findings, and 4 duplicate-index findings. It also lists 94 unused indexes; with almost no real users, that is not a reason to remove them indiscriminately.

**Remediation:** capture the actual feed/search/profile query plans against representative fictional data. Optimize per-row auth evaluation where appropriate, consolidate policies while preserving access rules, and add/remove indexes based on plans and write costs. These counts are maintenance signals, not measured user latency.

### P5 — Profiling follow-up: Smoothness is not yet verified across all iOS flows

The walkthrough did not measure native frame pacing, memory, gesture interruption, keyboard animation, or sustained map/reels scrolling. A sampled reel had a loaded video with no media error but was paused; without controlling focus/playback conditions, that is neither a passing playback test nor a confirmed autoplay defect.

Profile retained routes, map contexts, glass effects, large lists, and provider updates on device. The restaurant detail memory caches have explicit entry limits, so they were not reported as unbounded leaks. Reduced-motion handling exists in some app paths; verify it across the remaining custom sheets and animations rather than assuming it is universally absent or complete.

## Coverage and evidence

| Area | What was checked | Remaining limit |
|---|---|---|
| Public app | Guest onboarding, Home, Search/map, restaurant sheet/detail/back, recipes/filter, guide, Experts, calendar/plan validation, Decide gate, Pro presentation, import presentation, reels feed, public profile | No authenticated CRUD, purchases, imports, publishing, messages, or social writes |
| Visual | Primarily 393×852 dark mobile viewport; some desktop pages; saved screenshots | Not a complete light/dark/breakpoint, VoiceOver or Dynamic Type matrix |
| Security | Live grants/RLS/views/buckets, selected deployed handlers, dependency advisory scan, response headers | No intrusive production exploitation, internal-network probes, or exhaustive proof for every deployed routine |
| Reproductions | Anonymous private-cache access, unauthorized restaurant link update, billing retry skip | Local fictional fixtures, not production mutations |
| Build | Fresh production build including TypeScript succeeded | Build success does not establish runtime correctness |
| Existing tests | Earlier same-commit run: 1,415 tests across 153 files; two widget tests; native simulator checks and relaunch | Not rerun wholesale during this read-only audit; see prior iOS verification document |
| iOS | Prior build install/launch verification and native persistence warning considered | No comprehensive device animation/performance trace in this audit |

All inspected public base tables had RLS enabled. Private ranking evidence retained owner-scoped access. The advisor's 13 tables with RLS and no policies are largely service-only tables, not automatically vulnerabilities. Likewise, 96 anonymous-executable and 107 authenticated-executable definer-function warnings are inventory counts, not that many confirmed exploits. Several inspected functions correctly validate identity.

Reproduction commands, run from the repository root:

```sh
node docs/audit-2026-09-10/reproduce-legacy-security.mjs
node docs/audit-2026-09-10/reproduce-billing-retry.mjs
```

The accompanying function definitions and scripts contain audit evidence and should remain internal while remediation is pending. No tokens or private production records are needed to run them.

## Recommended implementation sequence

1. Close legacy database read/write bypasses and unauthenticated AI endpoints, with authorization regression tests and explicit live grants verification.
2. Repair billing recovery, media privacy boundaries and recipe fetch restrictions. Reconcile deployed schema/function inventory with migrations.
3. Fix the sign-in overlay, guest failing requests, and native persistence warning.
4. Reduce startup payload; add targeted measurements on real hardware before tuning animation details.
5. Apply shared typography, map-theme, contrast, input and sheet patterns. Review equivalent screens side-by-side in both themes.
6. Finish signed-in end-to-end checks with a dedicated test account: rating/H2H/list changes, preference evidence sync, photos/offline recovery, profile/privacy, friends/messages, recipes/import, calendar, purchases/restore, notification deep links, account switching and deletion. Use store sandbox purchases and synthetic content.
7. Record a repeatable device matrix: cold/warm launches, fast navigation/back/swipe interruptions, keyboard open/close, background/resume, airplane mode/reconnect, reduced motion, large text, and sustained map/reels/list use. Set explicit performance budgets from these baselines and gate subsequent releases against them.

The audit establishes actionable defects; it does not certify that every possible app behavior is error-free. Authenticated flow coverage and measured iOS smoothness remain necessary before calling the app comprehensively verified.
