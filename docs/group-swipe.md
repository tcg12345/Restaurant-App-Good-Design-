# Decide together

Entry: Home → Decide together, or `/decide?code=XXXXXXXX`.

## Experience

- Create: host chooses a location, radius and 5–15 suggestions. Existing live rooms can be resumed. Hosts can delete a room from Your rooms; this ends the session and removes it from the list. Closed rooms are excluded automatically, while the weekly allowance record is retained.
- Invite: eight-character code, GoodEats friend/group-chat share, or native external share. Chat invitations render a Join room action.
- Preferences: each member searches the shared cuisine catalog, selects up to six cuisines and acceptable price tiers, and can add a 500-character mood note. The ready action stays outside the scroll area and above the keyboard. Dietary controls are omitted; saving the mood clears legacy room dietary choices. Leaving selections empty means open to anything.
- Ready: at least two participants and everyone ready are required. The host prepares the shortlist, then explicitly starts the shared deck.
- Vote: right/Yes, left/Pass, down/Veto. Buttons provide equivalent accessible controls. A veto requires confirmation and is available once per session.
- Rank: each member automatically compares only their yeses, without waiting for the host or other members. Server-side binary insertion produces a personal ordering with fewer comparisons than all-pairs. Zero or one yes skips this step. Every answer is saved; refresh resumes the current pair. Peers see completion only.
- Results: automatic once everyone completes swiping and ranking. Personal utilities range from 100 (top yes) to 60 (last yes); a single yes is 100 and passes are 0. Final score is `0.6 × mean(utilities) + 0.4 × min(utilities)`. Any veto excludes a place; exact ties use predicted group taste fit. There is no host-triggered deciding round.
- All-pass and all-veto outcomes have explicit empty/no-agreement states. Closing a room ends it for everyone. Leaving the view preserves the room for resuming; a host can close a stalled session from the waiting screen.

## Recommendations

`scripts/build-group-scorer.mjs` bundles the existing `buildTasteProfile`, `scoreCandidates`, `aggregateGroup` and `groupVeto` exports for Deno. This is the same scoring implementation used by existing recommendations, not a separate imitation. `npm run group:scorer` regenerates it. A parity test checks the server bundle against the app scorer.

For each joined account, the Edge function reads its quiz and up to 500 recent ratings, privately on the server. Each member contributes a search query. Sonnet interprets their current notes, cuisine choices and dietary preferences into a concise query; it cannot supply invented restaurant IDs. Google Places provides the real candidates, constrained by the host's radius. Explicit budgets are intersected across the group and take priority over historical spending bands. Existing group dietary veto rules apply; dietary preferences are search/ranking inputs, not verified allergen or menu guarantees.

Each candidate gets a prediction for each member from the existing scorer, adjusted +0.6 for appearing in that member's mood search or −0.3 otherwise. Predictions are aggregated with the existing 60% mean / 40% minimum formula. Cuisine diversity is applied before selecting the deck. This predicted taste-fit score is distinct from the final group-fit score.

Discovery uses an animated group constellation with reduced-motion support, including during the host’s initial request. Search refills undersized pools using Google pagination and bounded additional queries. Radius and budget constraints remain enforced. Publication requires exactly the requested count; genuine shortages return a clear count and adjustment options instead of silently starting a smaller deck.

AI outages fall back to taste scoring and literal mood search. Search failures return the room to the lobby, where the host can edit location/radius and participants can edit preferences. Server-side generation leases prevent concurrent paid requests, with a five-attempt retry cap per room. Missing photos get a designed fallback. Photo requests resolve on the server; the Places key is never included in the room response.

## Server authority and privacy

Migrations: `20260905133738_group_swipe.sql`, `20260905170616_group_room_list_cleanup.sql`, `20260905184247_group_pairwise_ranking.sql`.

Private schema stores rooms and rate counters. Public `group_room_events` contains only an ID and revision, with membership-gated SELECT and Realtime. All writes run through a service-role-only atomic RPC. The Edge handler verifies the JWT using `auth.getUser` before supplying the actor ID; client-supplied actor IDs and internal publish actions are not accepted.

Room requests wait for the SDK session and explicitly attach its access token. A 401 triggers one shared refresh and one retry for the same account; a refreshed foreground token is reused. Transport failures and 5xx responses are never automatically replayed, since a room mutation may already have succeeded. Missing or revoked sessions request sign-in; temporary session recovery failures retain identity and report a connection issue. Session lookup/recovery is bounded to 20 seconds. Server JWT validation remains mandatory.

Peers see names, readiness and submitted votes; their raw taste histories and mood notes are not returned to other members. Row locks serialize votes and transitions. Deck/roster changes are locked after generation. Duplicate same votes are idempotent while voting remains open; stale round votes, repeat vetoes and non-host controls are rejected.

Rooms are accessible for 24 hours. Free accounts can host one room per rolling seven days; joining does not consume the allowance. Active Pro profiles and grants permit unlimited sessions, subject to abuse protections (10 room creations/hour, 40 create/join attempts/hour). Quota enforcement is server-side and applies even if the client is modified.

## Sharing and deployment

- Supabase project: `ocpmhsquwsdaauflbygf`; function: `group-swipe`.
- JWT gateway verification is disabled for CORS preflight; handler authentication is mandatory.
- Required existing secrets: `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, and Supabase-injected URL/anon/service-role keys.
- Public links use `VITE_PUBLIC_WEB_ORIGIN` (currently `https://grubbyrater.com`). Publish this web build there for the new invitation landing page to be available on that domain. This task updates local/Xcode assets and the Supabase backend; it does not publish the web host.
- The native custom scheme `com.tylergorin.restaurantapp://decide?code=XXXXXXXX` is handled on warm and cold launch. The web invitation page offers Open in GoodEats. Existing app installs must receive the updated build. Code joining works without a public website deployment.

## Verification

- `src/lib/group-auth.test.ts`: stale-token recovery, concurrent refresh, missing/revoked sessions, account switching, bounded recovery, and no mutation retries for transport/5xx failures. Mobile browser QA uses a synthetic session and mocks a 401 → refresh → successful creation; no production accounts or rooms are created.

- Rollback-only SQL integration tests: room membership/privacy, host settings, weekly quota, ready/generation locking, one veto, scoring, ties, stale-round rejection and role grants.
- Two mocked browser participants: create → join → preferences → shared start → voting → automatic personal comparisons → results; reload/resume; iPhone 375×667 and 430×932 action visibility.
- Unit tests cover swipe thresholds, room-link parsing, scoring parity, and invitation text preservation.
- Deno type check, app type check/build, 895 passing tests, deployed unauthenticated 401 and OPTIONS 200 checks.
- Xcode simulator build succeeded after syncing generated assets and the native selection-haptic bridge into the main Xcode checkout.
- Fresh invitation tests verify that sign-in preserves the room code and that the sign-in close control remains reachable.
- Supabase advisors reported no findings for the new room objects. Existing unrelated project findings were left unchanged.
- Live multi-account / paid-provider integration testing was blocked by automatic approval review because it would create production test accounts and invoke potentially billable services. Browser services were mocked instead. No real invites or purchases were made.

Pairwise verification: `supabase/tests/group-pairwise.sql` covers insertion ordering, final utilities, zero/one-like skipping, veto exclusion, idempotent retries and stale choices. `src/lib/group-shortlist.test.ts` covers refill from seven to ten, deduplication, request/deadline bounds and partial search failure.

### Room navigation regression (September 6)

Room responses update the URL only when the code actually changes, preserving other query parameters. Replacing an already-correct URL creates another history key; App's history-keyed route stack remounts Decide Together and auto-joins again. Unconditional replacements therefore caused an endless join/remount cycle after creation and on invitation links.

`src/pages/DecideTogether.test.ts` renders the real room page inside `RetainedRouteStack` and React Router with mocked room services. It covers creation, invitation opening, and saving preferences. Both regression tests fail against the original unconditional replacement and pass with the guarded update. No production rooms or accounts are created by these checks.

### Restaurant information during a room (September 6)

Swipe cards, personal comparisons and results now show the full address, matched Michelin distinctions (including Bib Gourmand, Selected and Green Star), and separate AI overview / Restaurant details actions. The shared RestaurantPanel opens as a sheet over the live room; closing it preserves the card and polling. These controls live outside the drag/vote target, and comparison details are separate from the preference button.

`GroupPlaceInfo` uses the existing coordinate-and-address Michelin matcher. Coordinates already published in room decks are now represented in the client type. AI overviews are requested only on tap and cached for 30 minutes in memory per account/room/place, with duplicate-request protection, retryable failures and late-result guards.

New Edge function `group-place-summary` checks the caller using `requireUser`, then checks room membership/expiry and restaurant membership via the existing snapshot RPC before any cache or paid request. It accepts room/place IDs, not client descriptions. A fail-closed 60/hour rate guard uses the existing caller-scoped counter. It requests only Google's editorialSummary (2.5-second timeout), then a small Haiku request (9-second timeout, 150 output tokens). The prompt restricts output to supplied facts and 1–2 sentences; output is also bounded to two complete sentences. Missing editorial data falls back to known room facts, while an AI outage returns a retryable error. The worker caches successful summaries for an hour and coalesces concurrent requests. No schema changes or personal taste/history sharing are involved.

Validation: room navigation and authentication regressions, no-vote preview opening/closing, cached overview reuse, late-response handling, retry after failure, source grounding and response bounds. Offline Deno handler tests verify preflight/authentication, membership (including cache access), deck restriction, quota rejection and fail-closed errors. Browser fixture `scripts/group-info-preview.html` on preview-only port 3013 uses mocked rooms, AI and detail-sheet services; no production rooms or provider calls. Light/dark and 320/393-pixel layouts checked.

Deployment status: local implementation and iOS assets prepared. Automatic approval review rejected production deployment of `group-place-summary` to `ocpmhsquwsdaauflbygf` pending explicit user approval of the destination and paid-provider capability. The AI button requires that deployment; the restaurant facts and preview sheet are client-side changes.

### Custom shortlists (September 6)

Creation now offers **Find places for us** and **Choose our own places**. Custom rooms bypass the mood form, AI discovery, taste-history reads and predicted-fit display. The host builds a shared list of 2–15 real restaurants after creating the room. The host chooses **Only me** or **Everyone can suggest**; the latter permits up to two active suggestions from each guest. Hosts may add up to the total room limit. The existing room allowance still applies.

Custom lobby includes debounced restaurant search, address/Michelin labels, per-place attribution, restaurant previews and removal controls. Guests can remove only their own picks; hosts can remove any pick. Duplicates are idempotent. Turning off guest additions keeps existing suggestions. Leaving/removing a guest removes their suggestions. Every shortlist or policy change resets readiness and increments a version; stale ready/start requests are rejected. Guests need not suggest anything to participate. The host starts once at least one guest has joined, at least two restaurants are selected, and every guest marks ready. Start locks the list and goes directly into the existing swipe/personal-ranking/results flow. Equal vote-based scores remain a tie; no predicted taste fit is presented for manual selections.

Migration `20260907013128_group_custom_shortlist.sql` adds private helper functions and replaces `group_room_action`, preserving existing recommendation and pairwise behavior. No new exposed tables are created. Actions `custom_add`, `custom_remove`, `custom_settings`, and `custom_ready` are authenticated by the existing Edge handler and serialized under the existing room row lock. Guest caps, ownership, room capacity, readiness versions and start permissions are checked in SQL. The service-role-only RPC preserves its existing grants; private helpers are not executable by clients and are security invokers.

`group-swipe/custom.ts` validates membership and contribution capacity before paid lookups, then fetches canonical Google Places facts for the selected ID. Caller-supplied names/ratings/photos are not accepted. Restaurant/café/bakery type and operational business status are checked, photos resolve server-side, and no provider key is returned. Concurrent additions are rechecked by the locked SQL mutation. A fail-closed 60/hour lookup counter bounds retries. Custom additions do not call an AI provider.

Verification:
- `scripts/test-group-custom.mjs` runs the actual migrations and previous pairwise SQL regression against an isolated in-memory PostgreSQL instance. It verifies both room types, permissions, the two-guest-pick and 15-total limits, duplicate idempotency, swaps, attribution, stale versions, guest readiness, policy changes, member removal, locked voting and real vote-based results. No production accounts or rooms are used.
- `GroupCustomLobby.test.ts`, `group-custom.test.ts`, and `DecideTogether.test.ts` cover UI availability, duplicate search results, debounce, exact-ID additions, error visibility, custom creation, no generation, provider validation and the existing route-remount regression.
- Preview fixture `scripts/group-custom-preview.html`, served with `scripts/group-custom-preview.vite.ts` on port 3014, uses mocked rooms, accounts, search, AI and detail sheets. `?create`, `?filled`, `?guest`, `?hostonly`, and `?dark` select the scenarios.

Production status: migration and updated `group-swipe` deployment are prepared locally, not applied. Production approval remains pending, alongside the prior `group-place-summary` endpoint. Apply the migration before deploying the updated room function; then deploy the optional-overview endpoint to enable that earlier feature as well.
