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
