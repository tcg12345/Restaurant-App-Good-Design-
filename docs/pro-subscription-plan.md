# GoodEats Pro — subscription plan

Status: proposal, 2026-09-02. Nothing here is built. The app has zero
monetization plumbing today (no IAP plugin, no Stripe, no `plan` column), so
this is greenfield, but the surrounding scaffolding (server-side per-user
quotas, DB-guarded profile flags, a global gate-modal context) fits it well.

The companion decision page lists every candidate feature with a
recommendation; the picks the owner makes there drive Phase 3 below.

---

## 1. Principles

1. **Free is a complete app.** Rating, lists, wishlist, social, messaging,
   guides, recipes you write yourself, the taste tier, the first import,
   privacy controls and dark mode are never gated. Pro is *more*, not *the rest*.
2. **Pro = the AI layer + the insight layer.** Everything that costs real money
   per use (Claude, image generation, Mux minutes) and everything that is
   "your taste, deeper" (comparisons, trends, twins, full leaderboard).
3. **Prompts are contextual, never interruptive.** The paywall appears when a
   person reaches for a Pro thing, or in two passive places (Settings, Profile).
   Never on launch, never during onboarding, never inside the rating flow, the
   composer, or a chat reply.
4. **One entitlement, several plans.** Monthly / Annual (/ optional Lifetime)
   all unlock the same `pro` entitlement. No "Pro Plus" at launch; the gate
   code is a boolean plus a limits table, not a tier ladder.
5. **Server enforces the money; client enforces the experience.** Any gate that
   protects a paid API is checked in the edge function from the DB plan.
   Client checks are for UX only.
6. **Continuation.** Whatever the person was doing when the sheet opened
   resumes automatically after purchase. No re-tapping.

---

## 2. Platform: RevenueCat over StoreKit 2 (iOS) and Stripe (web)

**Recommendation:** RevenueCat as the entitlement layer.

| Rail | Provider | Why |
|---|---|---|
| iOS app | StoreKit 2 via `@revenuecat/purchases-capacitor` | App Review Guideline 3.1.1 requires Apple In-App Purchase for digital features/subscriptions. The only exception is the US storefront's external-link allowance (since May 2025), which still carries an Apple commission and a worse UX (Safari round-trip, no Face ID pay sheet). Not worth it. |
| Web (Vercel PWA) | Stripe Billing, connected to RevenueCat | The PWA is a real audience (`public/site.webmanifest`, `VITE_PUBLIC_WEB_ORIGIN`). Stripe Checkout + Customer Portal is the standard web rail. RevenueCat's Stripe integration ingests Stripe events so we handle **one** webhook shape. |
| Source of truth | Postgres `user_profiles.plan` + `subscription_events`, written only by our `billing-webhook` edge function | Every AI function already carries the user's JWT (`src/lib/api-base.ts`), so plan enforcement has one server-side choke point. |

Why not Stripe alone: it cannot be used inside the iOS app for this. Why not
hand-rolled StoreKit 2: receipt/JWS verification, App Store Server
Notifications v2, renewals, grace periods, billing retry, refunds, family
sharing and cross-platform aliasing are all things RevenueCat handles, and its
free tier covers early revenue (confirm current pricing; historically free up to
a monthly-tracked-revenue threshold, then ~1%). Apple's Small Business Program
(15% instead of 30% under $1M/yr) is worth enrolling in before launch.

Fees to expect: Apple 15% (SBP) on iOS; Stripe ~2.9% + 30¢ on web; RevenueCat
0–1%. Web is the high-margin rail but iOS will be most of the volume.

**Sources:** RevenueCat Capacitor SDK docs
(https://www.revenuecat.com/docs/getting-started/installation/capacitor),
RevenueCat Stripe Billing (https://www.revenuecat.com/docs/web/integrations/stripe),
Apple guideline update for US external links (https://developer.apple.com/news/?id=9txfddzf).

---

## 3. Plans and pricing (proposal)

| Plan | Price | Notes |
|---|---|---|
| Pro Monthly | $4.99 / month | No trial. The "try it for a month" option. |
| Pro Annual | $29.99 / year (≈ $2.50/mo, "save 50%") | **Default selection.** 7-day free trial (StoreKit intro offer / Stripe trial). |
| Founding Lifetime (optional) | $79.99 once | Only if you want a launch moment. Non-consumable IAP. Remove after launch window. |

Product ids: `goodeats_pro_monthly`, `goodeats_pro_annual`,
`goodeats_pro_lifetime`. One App Store subscription group ("GoodEats Pro").
RevenueCat entitlement id `pro`, offering `default` with packages `$rc_monthly`,
`$rc_annual`, `$rc_lifetime`. Same ids as Stripe price lookup keys.

Grandfathering: every account that exists at launch gets 30 days of Pro via a
`pro_grants` row ("thanks for being early"). Cheap, honest, and it seeds the
first trial→paid cohort.

Prices are a starting point; RevenueCat Experiments can A/B them without a
client release.

---

## 4. Data model (migration 084)

```sql
-- user_profiles gains four columns the client can read but never write
ALTER TABLE public.user_profiles
  ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  ADD COLUMN pro_until TIMESTAMPTZ,          -- null = no expiry (lifetime) or not pro
  ADD COLUMN pro_source TEXT,                -- 'app_store' | 'stripe' | 'grant'
  ADD COLUMN pro_will_renew BOOLEAN;

-- Extend guard_profile_verification() (034/035) so client writes to
-- plan / pro_until / pro_source / pro_will_renew are silently reverted
-- unless current_user is the service role. Same clause as is_verified.

-- Raw webhook log: idempotency + audit. RLS on, no policies.
CREATE TABLE public.subscription_events (
  id TEXT PRIMARY KEY,                 -- RevenueCat event id
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE, ...
  store TEXT,                          -- APP_STORE | STRIPE | PROMOTIONAL
  product_id TEXT,
  expires_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin / promo / grandfathering grants. RLS on, no policies.
CREATE TABLE public.pro_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,                -- 'launch_30d', 'promo:FOODIE', 'admin'
  expires_at TIMESTAMPTZ,
  granted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one question every gate asks. SECURITY DEFINER, authenticated only.
CREATE FUNCTION public.is_pro() RETURNS BOOLEAN ...
  -- plan = 'pro' AND (pro_until IS NULL OR pro_until > now())
  -- OR EXISTS active pro_grants row

-- Plan-aware quotas replace the caller-supplied p_max_per_hour.
CREATE TABLE public.plan_limits (
  plan TEXT NOT NULL, endpoint TEXT NOT NULL,
  window TEXT NOT NULL CHECK (window IN ('hour','day','month')),
  max_count INTEGER NOT NULL,
  PRIMARY KEY (plan, endpoint, window)
);
-- consume_ai_quota(p_endpoint) → {allowed, remaining, window, resets_at}
-- reads is_pro(), checks every window row for the plan, increments all.
-- get_ai_quota_status() → the same numbers without consuming, for meters.
```

Notes:
- `fetchProfile` is `select('*')`, so `profile.plan` arrives on the client
  with no change (`src/lib/supabase-community.ts:560`). Add the new columns to
  `OPTIONAL_PROFILE_COLUMNS` so a missing migration can't break saves.
- Keep `consume_ai_rate_limit` for one release as a shim that calls
  `consume_ai_quota`, then delete it.
- Seed `plan_limits` with today's numbers for `pro` and the chosen free
  allowances (section 7).

---

## 5. Server: edge functions

| Function | Purpose |
|---|---|
| `billing-webhook` | RevenueCat → us. Verify the `Authorization` shared secret, insert into `subscription_events` (ignore duplicate ids), then set `plan/pro_until/pro_source/pro_will_renew` on `user_profiles` with the service role. Handles INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE, CANCELLATION (keep pro until expiry, set will_renew=false), UNCANCELLATION, EXPIRATION, BILLING_ISSUE (grace period per RC `expiration_at`), TRANSFER. Stripe purchases arrive through the same webhook because Stripe is connected inside RevenueCat. Follow `mux-webhook` for shape (HMAC/secret check, service role, idempotency). |
| `billing-sync` | Client calls this right after a successful native purchase or on "Restore". Pulls the subscriber from RevenueCat's REST API and writes the plan immediately, so the person never waits on webhook latency. |
| `billing-checkout` (web only) | Creates a Stripe Checkout session (`client_reference_id` = user id, `customer_email` = user email, `success_url` = `/pro/welcome`, `cancel_url` = `/pro`). Returns the URL; client opens it with `openExternalUrl`. |
| `billing-portal` (web only) | Creates a Stripe Customer Portal session for manage/cancel. |

Rules:
- New functions go in `supabase/config.toml` with `verify_jwt = false` and
  verify inside, like the others. `billing-webhook` has no user JWT at all;
  it authenticates by shared secret only.
- **Do not** add a Vercel `/api` copy (README warns against the second copy).
- The plan check in the five AI functions must **fail closed** for Pro-only
  gates. `enforceRateLimit` currently fails open on RPC error
  (`_shared/limits.ts:48-51`); keep fail-open only for the free-tier soft
  limit, never for a paid gate.
- `location-chat`, `import-recipe`, `import-restaurants` inline their own
  copies of the helpers on purpose. The quota call must be mirrored into all
  three by hand.
- `location-chat`: if the caller is not Pro and asks for Opus (or a
  recipe-build turn, which forces Opus at `index.ts:175`), run Sonnet and set
  a `x-goodeats-model-downgraded` header so the client can show one quiet line.
- Non-AI gates that can't be verified server-side cheaply (video length,
  guide themes) are client-enforced. Video can be back-stopped in
  `mux-webhook`: if `duration` exceeds the free cap and `is_pro()` is false,
  flip the asset private. Low stakes; do it in Phase 3 if at all.

---

## 6. Client architecture

New files:

| File | Role |
|---|---|
| `src/lib/entitlements.ts` | The single `FEATURES` map: `{ key, label, free: false \| number \| 'full', pro: 'full' \| number, window?, source }`. Client UI and the SQL seed are generated from the same list (same discipline as the taste points formula being duplicated in SQL with a pinned test). |
| `src/lib/billing.ts` | RevenueCat wrapper: `configureBilling(userId)`, `getOfferings()`, `purchase(pkg)`, `restore()`, `openManage()`. On web: `startWebCheckout(plan)` → `billing-checkout` → `openExternalUrl`. `isNativeRuntime()` decides. |
| `src/contexts/PlanContext.tsx` | `usePlan()` → `{ isPro, planChecked: boolean \| 'unknown', proUntil, willRenew, source, quota: Record<endpoint, {remaining, resetsAt}>, refresh() }`. Tri-state like `adminChecked` so the paywall never flashes at a paying user. Reads `profile.plan` from AuthContext; also reads RevenueCat `customerInfo` on native for the optimistic path. Subscribes to `postgres_changes` on the user's `user_profiles` row so a web purchase shows up on the phone. |
| `src/contexts/PaywallContext.tsx` | `requirePro(feature, { reason, onUnlocked })` / `openPaywall(source)` / `close()`. Owns the `ProSheet` JSX. Mounted in `App.tsx` immediately inside `SignInModalProvider` (`:758`) and above `ListsProvider` so domain contexts can call it exactly like they call `requireSignIn` (`ListsContext.tsx:1097`). Stores the pending `onUnlocked` and runs it after purchase (continuation). Frequency-caps the soft prompts. |
| `src/components/pro/ProSheet.tsx` | The paywall bottom sheet (section 8). `useBottomSheet`, `--ease-drawer`, registers with `overlay-registry` so the native tab bar yields. z-index above sign-in (`z-[100]`), at or below verification (`z-[130]`). |
| `src/components/pro/ProMark.tsx` | The Pro mark. Same shape as `VerifiedBadge.tsx` (30 lines, `size`/`fill` props). Uses `--color-accent` (the champagne reserved for verified/featured). Never a new hue. |
| `src/components/pro/ProGate.tsx` | Wrapper for locked rows/sections: renders children with a lock glyph + "Pro" tag, or a blurred teaser (`variant="teaser"`) with an inline unlock line. |
| `src/components/pro/QuotaMeter.tsx` | "2 of 3 left this month" pill. Only rendered for free users once `remaining <= 2`. Tapping opens the sheet. |
| `src/components/RequireProRoute.tsx` | Clone of `RequireAuthRoute` for the rare fully-Pro route (none planned at launch; keep for completeness). |
| `src/pages/ProPage.tsx` (`/pro`, `/pro/welcome`) | The in-app "what is Pro" page and the web return route. |
| `src/lib/billing-events.ts` | Analytics, modeled on `onboarding-events.ts`: `paywall_shown(source, feature)`, `plan_selected`, `purchase_started`, `purchased`, `restored`, `purchase_failed`, `paywall_dismissed`. Migration 085 `billing_events`. |

Sign-in lifecycle: on native, `Purchases.configure({ apiKey })` at app start,
then `Purchases.logIn(userId)` when Supabase auth resolves and `logOut()` on
sign-out. App user id = Supabase user id, so web and iOS purchases alias to the
same customer.

Native setup (outside git, per `ios/NATIVE-SETUP.md`): add the In-App Purchase
capability in Xcode, a StoreKit configuration file for local testing, and note
that RevenueCat's Capacitor plugin registers itself (verify in
`capacitorDidLoad()` since auto-discovery has been unreliable here).

---

## 7. Feature catalog

Three gate types:

- **Full** — Pro only. Free sees the entry point with a Pro tag.
- **Partial** — free gets a real, useful slice; Pro gets the rest.
- **Usage** — free has an allowance; Pro has the existing abuse cap.

Recommendation labels: **Launch** (in the recommended launch bundle),
**Later** (good candidate, hold for a second wave), **Optional** (defensible
either way), **Avoid** (would hurt growth or trust).

### AI assistant (`location-chat`, Sonnet 4.6 / Opus 4.8)

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| A1 | Assistant messages | Usage | 15 / day | 120 / hr (today's cap) | Launch | server |
| A2 | Opus model in the picker (`LocationChat.tsx:165`) | Full | Auto + Sonnet | + Opus | Launch | server (downgrade) |
| A3 | Recipe-build turns on Opus (forced today) | Full | Sonnet | Opus | Launch | server |
| A4 | Saved chat history (`MAX_SAVED_CHATS = 30`) | Partial | last 5 chats | 30 | Later | client |
| A5 | "Ask about this" attachments from detail/share | Full | — | ✓ | Avoid | — |
| A6 | Find-a-place with free-text mood | Full | who/where | + mood text | Optional | client |
| A7 | Longer replies (`max_tokens` 1024 → 2048) | Full | 1024 | 2048 | Optional | server |
| A8 | Suggested follow-ups (`FOLLOWUP_LIMIT`) | — | keep | keep | Avoid | — |

### Recipes and home cooking (`build-recipe`, `import-recipe`, `generate-recipe-image`)

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| R1 | AI recipe generation (Opus) | Usage | 3 / month | 40 / hr | Launch | server |
| R2 | AI recipe ideas grid (Sonnet) | Usage | 10 / day | 80 / hr | Launch | server |
| R3 | AI hero image generation (OpenAI) | Full | — | 20 / hr | Launch | server |
| R4 | Combine two recipes (AI) | Full | — | ✓ | Launch | server (counts as R1) |
| R5 | Import from link | Usage | 5 / month | 30 / hr | Launch | server |
| R6 | Import from photo / text (vision) | Full | — | ✓ | Launch | server |
| R7 | Bulk recipe import (`ImportRecipesModal`) | Full | — | ✓ | Later | client + server |
| R8 | Recipe drafts (`MAX_DRAFTS = 30`) | Partial | 5 | 30 | Optional | client |
| R9 | Nutrition panel on recipe page (new: CSS exists, no data or markup; needs a recipe field, values from builder/importer, AI estimate for hand-written recipes) | Full | — | ✓ | Optional | client + server |
| R10 | Servings scaler | — | keep | keep | Avoid | — |
| R11 | Cook Mode + step timers | — | keep | keep | Avoid | — |
| R12 | Recipe reviews / comments | — | keep | keep | Avoid | — |

### Taste profile, leaderboard, top lists

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| T1 | Taste profile page | Partial | tier ring, points, rank, the 3 sentences, "how you grade", "where the money goes" | + loved-vs-eaten gap, over-time trend, habits, what you look for, points ladder detail | Launch | client |
| T2 | Platform comparisons / percentiles (`get_taste_benchmarks`) | Full | self-referential sentences | "you grade 0.6 harder than most" | Launch | client (RPC could gate) |
| T3 | Taste twins (`get_taste_twins`) | Full | — | ✓ | Launch | server RPC |
| T4 | Leaderboard | Partial | top 10 + your rank, points sort | full board, all 4 sorts | Later | server RPC (limit) |
| T5 | Top lists boards (`topLists.ts`) | Partial | overall + by cuisine | + city, price, tag boards | Optional | client |
| T6 | Precise scores toggle (2 dp, Settings) | Full | 1 dp | 2 dp | Later | client |
| T7 | Score history per restaurant (drift chart across visits) | Full | last visit | full timeline + chart | Later | client |
| T8 | "Your year in food" annual recap | Full | — | ✓ (new) | Later | client |
| T9 | Someone else's taste profile | — | keep | keep | Avoid | — |

### Recommendations and discovery (Google Places on the client)

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| D1 | "Why this?" explanations on recs (predicted score + reasons from the engine) | Full | score only | reasons | Later | client |
| D2 | Recs radius (`REC_RADIUS_MILES = 8`) | Partial | 8 mi fixed | 2–25 mi chip | Optional | client |
| D3 | "Load more" taps on city pages (each tap = up to 6 rounds of 4 billed Places searches; no cap today) | Partial | 2 taps per city visit | unlimited | Optional | client |
| D4 | Michelin distinction filter | Partial | badges shown | filter by distinction | Optional | client |
| D5 | Group "For us" ranking (`MAX_MEMBERS = 5`) | Partial | you + 1 | up to 5 | Later | client |
| D6 | Open-now / meal filters | — | keep | keep | Avoid | — |
| D7 | Search other cities | — | keep | keep | Avoid | — |

### Lists, trips, visits

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| L1 | Custom lists | Usage | 8 + the 4 defaults | unlimited | Optional | client |
| L2 | Trips | Usage | 1 active | unlimited | Optional | client |
| L3 | Hotel dining tracking | Full | — | ✓ | Optional | client |
| L4 | Visit history | Partial | last 3 visits | all | Optional | client |
| L5 | Collaborative lists (new) | Full | — | ✓ | Later | server |
| L6 | List covers / themes (new) | Full | — | ✓ | Optional | client |
| L7 | Data export (CSV / JSON of ratings, lists, recipes) | Full | — | ✓ (new) | Launch | edge fn |
| L8 | Drag-to-reorder ranking | — | keep | keep | Avoid | — |
| L9 | Wishlist | — | keep | keep | Avoid | — |

### Posts, reels, guides (Mux minutes, storage)

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| S1 | Video length (`60 s`) | Partial | 60 s | 3 min | Launch | client (+ mux-webhook backstop) |
| S2 | Items per post (`POST_MAX_ITEMS = 15`) | Partial | 10 | 15 | Optional | client |
| S3 | Media editor: adjustments + filter pack | Partial | crop, trim, text | + brightness/contrast/warmth/vignette, presets | Optional | client |
| S4 | Guide themes + typography (`GuideLiveEditor`) | Partial | default theme | all themes, per-element type | Launch | client |
| S5 | Published guides | Usage | 3 | unlimited | Optional | client |
| S6 | Guide analytics (saves, views over time) | Full | save count | chart + who saved | Later | server |
| S7 | Photos per rating (no cap today) | Usage | 6 | 20 | Optional | client |
| S8 | Share-card styles for ratings | Partial | default | 4 styles | Optional | client |
| S9 | Pinned items on profile (new) | Full | — | 3 pins | Later | client |
| S10 | Posting, likes, comments, reels feed | — | keep | keep | Avoid | — |

### Identity, account, perks

| # | Feature | Type | Free | Pro | Rec | Enforce |
|---|---|---|---|---|---|---|
| I1 | Pro mark on your profile (opt-in to show publicly) | Full | — | ✓ | Launch | client |
| I2 | Alternate app icons (native) | Full | — | 4 icons | Later | native |
| I3 | Early access to new features | Full | — | ✓ | Launch (policy) | client flag |
| I4 | Priority support link | Full | — | ✓ | Optional | — |
| I5 | Ad-free | — | no ads exist | — | Later lever if ads ever ship | — |
| I6 | Dark mode, privacy, private account | — | keep | keep | Avoid | — |
| I7 | First restaurant import (screenshots / recordings) | — | keep free | keep | Avoid (it's acquisition) | — |
| I8 | Re-imports after the first | Usage | 1 lifetime | unlimited | Optional | server |

### Recommended launch bundle

"GoodEats Pro: your taste, deeper."

- **Assistant**: A1, A2, A3 (free: 15 messages/day on Sonnet; Pro: 120/hr, Opus)
- **Recipes**: R1–R6 (free: 3 generations + 5 link imports a month; Pro: image gen, combine, photo import)
- **Taste**: T1, T2, T3 (free: the core profile; Pro: comparisons, trends, twins)
- **Creating**: S1, S4 (3-minute video, guide themes)
- **Account**: L7, I1, I3 (export, Pro mark, early access)

Second wave: A4, T4, T6, T7, D1, D5, S6, I2.

---

## 8. UI

### The paywall sheet (`ProSheet`)

Bottom sheet, `rounded-t-[28px] bg-surface`, drag-anywhere via
`useBottomSheet`, `--ease-drawer`. Layout top to bottom:

1. **Context line** (only when opened from a feature): a pill in
   `text-on-surface/55` — "You've used 3 of 3 recipe generations this month."
   Same truncating-pill idea as the sign-in modal's `reason`.
2. **Headline** in Fraunces: "GoodEats Pro" small caps eyebrow, then
   "Your taste, deeper." The triggering feature's benefit is the first bullet.
3. **What you get**: five rows max, icon tile (`rounded-[13px] bg-primary/10`)
   + bold title + one-line sub. Order is contextual (triggering feature first).
   "See everything in Pro" link → `/pro`.
4. **Plan selector**: two stacked radio rows. Annual first with a "Best value"
   tag in `--color-accent` tint and "$29.99 / year · $2.50 a month"; Monthly
   "$4.99 / month". Selected row gets `ring-2 ring-primary`. Lifetime, if
   enabled, is a third quiet row.
5. **CTA**: full-width `rounded-full bg-primary text-on-primary` — "Start
   7-day free trial" for annual, "Continue" for monthly. Below it, in 12 px
   `text-on-surface/45`: "Then $29.99 / year. Cancel anytime in Settings."
6. **Footer**: "Restore purchases · Terms · Privacy" (Apple requires all
   three on the paywall). On web, "Manage in browser" instead of Restore.
7. Loading state: CTA turns into a spinner and the sheet locks dismissal
   while StoreKit is up. Success: sheet content cross-fades to a short
   "Welcome to Pro" state with the Pro mark, then closes after 900 ms and the
   pending action runs. A `showToast('Welcome to Pro')` covers the case where
   the sheet is already gone.
8. Errors: "Purchase didn't go through. Nothing was charged." with Retry. For
   `userCancelled` say nothing.

Dark mode inverts through the tokens (`bg-primary` flips to bone). No
gradients, no confetti. The one warm note is the champagne "Best value" tag
and the Pro mark.

### The Pro page (`/pro`)

Same content as the sheet at page scale for people who want to read before
buying, and the web landing (`VITE_PUBLIC_WEB_ORIGIN/pro`). Sections: masthead
("Your taste, deeper."), the five benefits as an editorial list with one
mockup each, a free-vs-Pro table, the plan selector, FAQ (cancel, restore,
web vs App Store, family sharing), footer links. On Pro accounts the same
route shows status ("Pro · renews 14 Mar 2027 · Manage").

### Settings

New section `GoodEats Pro` inserted after **Profile** in the `RowSpec[]`
array (`SettingsPage.tsx:381`). Rows:

- Free: `Upgrade to Pro` — sub "Deeper taste profile, unlimited AI" →
  `openPaywall('settings')`.
- Pro: `GoodEats Pro` — sub "Renews 14 Mar 2027 · Annual" → `/pro` (status +
  Manage). `Manage subscription` → App Store subscriptions URL on iOS, Stripe
  portal on web.
- Both: `Restore purchases` (native only).
- Pro: `Show Pro mark on profile` toggle.

### Profile

Pro appears in the existing quiet meta line (`Profile.tsx:953-982`) as
"Pro" with the 12 px mark, next to Verified, in the same `text-on-surface/45`
voice. The header comment says it: facts, not badges. No new chip, no card in
the header. For free accounts, an optional single-line card *below* the action
row and above the tabs: "Pro · Your taste, deeper · Learn more" — dismissable,
30-day snooze, only after the person has 10+ ratings (the score-unlock
threshold, `scoreUnlock.ts`).

### Where the prompts are (and aren't)

| Moment | Treatment |
|---|---|
| Hitting a usage cap (A1, R1, R2, R5) | Inline empty state in the `PermissionPrimer` shape: icon disc, "You've used this month's 3 recipe generations", body with reset date, CTA "Upgrade to Pro", secondary "Not now". Never a modal over a half-typed prompt; the composer stays visible. |
| Approaching a cap | `QuotaMeter` pill in the feature header once `remaining <= 2`. Nothing before that. |
| Tapping a Pro-only control (Opus in the picker, image generation, photo import, guide themes, 3-min trim) | Control carries a small `Pro` tag; tap opens the sheet with that feature's context. The control is never disabled-grey; it's an invitation. |
| Partial content (taste profile sections, comparisons, twins) | Section header renders normally; the body is a real-but-blurred preview (`filter: blur(6px)` + `pointer-events:none`) with one line beneath: "Unlock with Pro". Blur the actual data, not lorem, so it's an honest preview. |
| Passive | Settings row, Profile meta line, `/pro` page. |
| One-time nudge | After score unlock (10 ratings): a single feed card on Discover, "You've unlocked scores. Pro takes your taste further." Dismiss = 30-day snooze, then once more, then never. Stored in `user_app_data` prefs plus `goodeats-pro-nudge` locally. |
| Never | App launch, onboarding, PreAuthFlow, the rating flow, the composer while posting, the guide creator mid-edit, during a streaming chat reply, the first restaurant import. |

Frequency caps: the sheet opens on explicit taps without limit; passive
nudges at most once per 30 days per surface.

### Copy rules

Sentence case, no exclamation marks, no "unlock the magic". Say the number
("3 of 3 used this month"), say the reset ("Resets 1 Oct"), say the price
with the period. The Pro tag is the word "Pro" in 10.5 px uppercase tracking
0.16em in the accent ink, never a star or a crown.

---

## 9. Purchase, restore, manage flows

**iOS purchase**: sheet CTA → `billing.purchase(pkg)` → StoreKit sheet (Face
ID) → RevenueCat returns `customerInfo` → if `entitlements.active.pro`:
set `isPro` optimistically → call `billing-sync` → `refreshProfile()` →
success state → run pending action. Webhook lands seconds later and agrees.

**Web purchase**: `/pro` CTA → `billing-checkout` → `openExternalUrl(url)`
(new tab on web) → Stripe Checkout → return to `/pro/welcome?session_id=…` →
page calls `billing-sync` and polls `profile.plan` for up to 10 s with a
spinner → "Welcome to Pro". iOS never links out to web checkout (keeps the
app compliant on every storefront).

**Cross-platform**: RevenueCat aliases by app user id, so a web purchase is
active on the phone at next `PlanContext` refresh (realtime row change or
foreground). Apple permits honoring subscriptions bought elsewhere as long as
the app doesn't steer to them.

**Restore**: Settings → Restore purchases → `Purchases.restorePurchases()` →
`billing-sync`. On web, signing in is the restore.

**Manage / cancel**: iOS → `https://apps.apple.com/account/subscriptions`
via `openExternalUrl`; web → `billing-portal`. After cancellation the account
stays Pro until `pro_until`; Settings shows "Ends 14 Mar 2027".

**Expiry**: `is_pro()` flips at `pro_until`. Client shows a one-time toast
"Your Pro plan ended" with a Renew action. Data created under Pro is never
deleted or hidden; caps apply going forward (e.g. the 11th list stays, you
just can't make a 12th).

**Billing issue / grace**: RevenueCat extends `expires_at` through the
grace period; the app shows a quiet Settings sub "Payment issue · Update"
that deep-links to the store.

**Refunds / chargebacks**: webhook `CANCELLATION` with `reason=CUSTOMER_SUPPORT`
or `EXPIRATION` → plan back to free.

---

## 10. Rollout

**Phase 0 — accounts (no code, owner does these)**
App Store Connect: Paid Apps agreement, banking/tax, subscription group
"GoodEats Pro", three products, intro offer (7-day trial on annual), localized
descriptions, review screenshot. Stripe: products + prices with matching
lookup keys, Customer Portal enabled. RevenueCat: project, iOS app (App Store
Connect API key, shared secret), Stripe integration, entitlement `pro`,
offering `default`, webhook URL + secret, Experiments later. Enroll in Apple's
Small Business Program.

**Phase 1 — server (one PR)**
Migration 084 (section 4) verified with PGlite, then applied. Edge functions
`billing-webhook`, `billing-sync`, `billing-checkout`, `billing-portal`.
Quota call swapped into the five AI functions (three by hand). Model downgrade
in `location-chat`. Secrets: `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_SECRET`,
`STRIPE_SECRET_KEY`.

**Phase 2 — client foundation (one PR)**
`entitlements.ts`, `billing.ts`, `PlanContext`, `PaywallContext` + `ProSheet`,
`ProMark`, `ProGate`, `QuotaMeter`, `/pro` page, Settings section, Profile
meta line, `billing-events`. `@revenuecat/purchases-capacitor` installed from
the main repo checkout (`cap sync` there; worktrees lack the Xcode project).
Ship with **no gates on** so nothing changes for anyone; verify purchase,
restore, cancel, expiry in sandbox and Stripe test mode. Grant launch-cohort
`pro_grants`.

**Phase 3 — gates (one small PR per area, in this order)**
Assistant → Recipes → Taste profile → Guides + video → Account perks. Each PR
adds the `FEATURES` entries, the `plan_limits` rows, the inline cap state and
the tag on the control. Owner picks come from the decision page.

**Phase 4 — launch**
TestFlight with sandbox testers, App Review notes (how to reach the paywall,
a test account), web in Stripe live mode, the Discover nudge enabled last.
Watch: paywall views → trial starts, trial → paid, D30 churn, refund rate,
and per-plan AI spend (RevenueCat charts + `billing_events`).

**Verification checklist (Phase 2)**
- Sandbox purchase monthly / annual / trial, on device and simulator (StoreKit
  config file works in the sim).
- Restore on a fresh install; sign out and in; second device.
- Cancel in sandbox (auto-renew off) → `pro_will_renew=false`, still Pro.
- Expiry (sandbox renews every few minutes) → `plan='free'` via webhook.
- Web checkout in test mode → phone sees Pro without a reinstall.
- Webhook replay (same event id twice) is a no-op.
- Client PATCH to `user_profiles.plan` is reverted by the trigger.
- AI function with a forged `isPro` in the body still enforces from the DB.
- Paywall never renders while `planChecked === 'unknown'`.
- Dark mode, reduced motion, VoiceOver labels on the plan radios.

---

## 11. Open questions for the owner

1. Which catalog rows are in (decision page).
2. Prices and whether to run the founding Lifetime.
3. Trial on annual only, or on both.
4. Grandfather window (30 days proposed).
5. Whether the Pro mark is public by default or opt-in (opt-in proposed).

---

## 12. Decisions (owner picks, 2026-09-02)

The owner went through the pick list. This section is the contract for
Phase 3; where it disagrees with section 7, this section wins.

### Free vs Pro, final

| Area | Free | Pro | Notes |
|---|---|---|---|
| Assistant messages (A1) | **10 an hour** | 120 an hour | Owner wrote "10 chats per hour"; read as messages. Confirm if they meant conversations. |
| Opus in the picker (A2) | Locked: row shows a lock, tapping opens the upgrade sheet | Selectable | Not a silent downgrade in the UI. Server still downgrades a forged Opus request as the backstop. |
| Recipe-build model (A3) | **Opus for everyone** | Opus | Owner: AI recipe build always uses Opus; free is limited by count instead. |
| AI recipe generation (R1) | **5 a week** (see conflict) | 40 an hour | A3 note said "maybe 3 per day", R1 note said "3–5 per week". Proposing 5 a week; owner to confirm. |
| AI recipe ideas (R2) | **5 a day** | 80 an hour | |
| AI hero image (R3) | — | 20 an hour | |
| Combine recipes (R4) | — | ✓ | Counts against R1 for Pro. |
| Import from link (R5) | **5 a week** | 30 an hour | Bulk import (R7) stays available and simply draws on this allowance. |
| Import from pasted text (R6) | **3 a week** | ✓ | |
| Import from photo (R6) | — | ✓ (3 photos) | |
| Nutrition panel (R9) | — | ✓ | **New feature.** Recipe field + values from builder/importer + AI estimate for hand-written recipes. |
| Find-a-place mood text (A6) | who + where | + mood text | |
| Taste profile depth (T1) | tier, points, rank, three sentences, how you grade, where the money goes | + loved-vs-eaten, trend, habits, what you look for, ladder detail | |
| Comparisons / percentiles (T2) | self-referential sentences | platform comparisons | |
| Taste twins (T3) | — | ✓ | Gate in the RPC. |
| Precise scores (T6) | 1 dp | 2 dp | Settings toggle gets the Pro tag. |
| Score history per restaurant (T7) | last visit | full timeline + drift chart | **Bug + redesign first, see below.** |
| Group "For us" (D5) | you + 1 | up to 5 | |
| Data export (L7) | — | CSV / JSON | |
| Collaborative lists (L5) | — | ✓ (owner needs Pro; collaborators don't) | **New feature.** Owner: "I love this feature." |
| Items per post (S2) | 10 | 15 | |
| Early access (I3) | — | ✓ | Policy + one client flag. |

Everything not in this table stays free and unchanged, including: chat
history (A4), attachments (A5), leaderboard (T4), top lists (T5), rec radius
and load-more (D2, D3), Michelin filter (D4), lists / trips / visits caps
(L1, L2, L4), video length (S1), media editor (S3), guide themes and count
(S4, S5), guide analytics (S6), photos per rating (S7), share cards (S8), the
Pro mark (I1), app icons (I2), re-imports (I8).

### Decided launch bundle (the five rows on the sheet)

1. **Assistant on Opus** — 120 messages an hour, Opus in the picker.
2. **Unlimited AI recipes** — no weekly caps, hero images, combine, photo import, nutrition.
3. **Your full taste profile** — comparisons, trends, taste twins, precise scores, score history.
4. **Plan together** — group picks for up to five, collaborative lists, mood search.
5. **Your account** — export your data, early access to new features.

### Work that is not a gate (do these first; they are safe before billing exists)

| Item | Decision | What was found |
|---|---|---|
| **Pinned items on profile (S9)** | Build it, **free for everyone**, 3 pins. | New; profile shelf + a `pinned` array in user_app_data prefs. |
| **Collaborative lists (L5)** | Build it (gate the *owner* side later in Phase 3). | New table `list_members` (list id, user id, role), list rows gain `owner_id` + `shared`; RLS lets members read and append; deletes stay owner-only. Invites via the existing share sheet. |
| **"Why this?" line on recommendation cards (D1)** | **Remove.** | `RecommendationsBrowser.tsx:1008` picks a `topReason` and `:1086` renders it under the card meta. Delete both; nothing else reads `reasons` in the UI. |
| **Hotels (L3)** | **Remove everything hotel-related.** | The hotel UI is already gone. What remains: (a) `hotel_dining` table + `dining_type` enum from migration 043 (unused by any client code) and its mention in `delete-account/index.ts:15` and `supabase/README.md`; (b) `filterSheet.css:271-307` teal rules for the old Discover hotels mode; (c) the legacy-hotel purge in `ListsContext.tsx:858-885, 1080, 3016-3076` that silently drops old 'Hotel' / 'Hotel Breakfast' ratings on load. Keep the purge for one more release so stale devices can't resurrect hotel rows, then delete it. **Do not** touch the lodging-type exclusion in `places.ts:550-560` and `recommendations.ts:212, 1628`: that code keeps hotels *out* of results. Dropping the table is a migration (`drop table hotel_dining; drop type dining_type`); confirm with the owner before applying it to the live project. |
| **Score history on restaurant pages (T7)** | **Fix, then redesign.** | Today: a visit is archived only when a save is flagged `isNewVisit` (`ListsContext.tsx:2666`); the re-rate path must set that flag or nothing is ever written. On the page the list renders as "N earlier visits" folded inside the collapsed "Your rating" section (`RestaurantDetailMobile.tsx:1010-1060`), two taps deep, and only from localStorage seed + `getVisitHistory`. Verify the flag on every re-rate entry point (RatingFlow, AddRestaurantModal, head-to-head), verify the cloud restore path (memory: `visit_history` table is absent in the live DB, history lives in the user_app_data blob). Then a new section, shown only when history exists: score-over-time line with dots per visit, the visits beneath as a clean list (date, score chip, one-line note), no nested collapses. Free: last visit only. Pro: full timeline + chart. |
| **Recaps (T8)** | **Not now.** Recorded as a wanted feature. | Ideas from the owner: an account recap ("your year in food"); prior years viewable from Settings; weekly and monthly recaps too. Build on `taste-insights.ts`; likely a Pro feature when it ships. |

### Revised order

0. **Pre-billing PR(s)**: remove the reason line; hotel cleanup (code now, table drop after confirmation); score-history fix + section redesign; pinned items (free); collaborative lists (ungated).
1. Server (section 10, Phase 1) with `plan_limits` seeded from the table above. Windows needed: hour (A1), day (R2), week (R1, R5, R6-text). Add `'week'` to the window CHECK.
2. Client foundation (Phase 2), sheet copy from the decided bundle.
3. Gates in this order: assistant → recipes → taste profile (incl. precise scores, score history, twins) → group + collaborative lists + mood → export + early access. Nutrition panel is its own PR since it's a new feature.
4. Launch.

### Confirmed 2026-09-02

- A1: 10 **messages** an hour on the free plan.
- R1: **5 AI recipe generations a week** on the free plan.
- Hotels: **drop** the `hotel_dining` table and `dining_type` enum from the live database.
- First PR scope: remove the rec-card reason line, hotel cleanup (code + table drop), score-history fix + section redesign. Pinned items and collaborative lists follow as their own PRs.

### Phase 3 as built (2026-09-03)

Every gate reads `usePlan().isPro` (the *effective* plan, Pro for everyone
while `billing_settings.gates_enabled` is false) and asks through
`usePaywall()`. Nothing here changes behaviour until launch flips the gates.

| Feature | Where the gate lives | Free sees |
|---|---|---|
| Assistant messages (A1) | `LocationChat`: `handleAiError` on the stream's 429; `QuotaMeter` above the composer; quota refreshed after each turn | the meter once two messages are left |
| Opus (A2) | `LocationChat` model menu: lock tag, tap opens the sheet | Sonnet / Auto |
| Recipe build, ideas (R1, R2) | `AiRecipeGenerator`: `handleAiError` (now reachable — `build-recipe-client` forwards `code`/`resetsAt` on every error path); `QuotaMeter` in the dock | meter at two left |
| Refine / ingredient edit | `AddHomeMealModal`, `LocationChat` draft handlers, `AdvancedRecipeBuilder`: refusals route to the sheet; `RecipeDraftSheet` honours a `handled` flag so no second error line | — |
| Hero image (R3) | `requirePro('recipe-image')` before the call in both hosts; `RecipeDraftSheet` tags the button | tagged button |
| Combine (R4) | `AiRecipeGenerator` "Combine these N" and `RecipePage` Combine: `requirePro`, tag | tagged button |
| Import link / text (R5, R6) | `ImportRecipePanel`: existing `handleAiError` + `QuotaMeter` in the footer | meter at two left |
| Import photo (R6) | `AddHomeMealModal` method chooser: tagged row, `requirePro` on pick | tagged row |
| Taste depth (T1) | `TasteProfilePage` → `TasteBody locked`: Love vs eat renders as a blurred teaser; Over time, Habits, tags, ladder omitted | sentences, palate, grading, spending |
| Comparisons (T2) | `bench={null}` for free, so every platform line falls back to its self-referential copy | own numbers only |
| Taste twins (T3) | palate CTA + "Like you" chip: `requirePro`; **migration 089** wraps `get_taste_twins` with an `effective_plan()` check (`get_taste_twins_core` is private) | tagged chip |
| Precise scores (T6) | Settings row: tag, tap opens the sheet; `PlanProvider` turns the stored preference off when a plan lapses | one decimal |
| Score history (T7) | `ScoreHistory`: chart as a teaser, list shows the current visit, "N earlier visits" opens the sheet | last visit |
| Mood text (A6) | `ChatRecsSheet`: the field renders as a tagged prompt | chips only |
| Group picks (D5) | `GroupPicker max` / `onFull`; `ChatRecsSheet` passes 1 for free and opens the sheet past it | you + 1 |
| Shared lists (L5) | `Pantry` new-list entries and the members sheet's Add friends: `requirePro('shared-lists')` | collaborators unaffected |
| Items per post (S2) | `AddPostModal`: `POST_FREE_MAX_ITEMS` = 10, the cap opens the sheet | 10 |
| Export (L7) | Settings → Data: "Export everything" (JSON) and "Export ratings" (CSV) via `lib/export-data.ts`; the native shell opens the web app's Settings (no file writer on iOS yet) | tagged rows |
| Early access (I3) | `usePlan().earlyAccess`; a Settings row under GoodEats Pro | — |

Not in this phase: the nutrition panel (R9) — a new feature with its own PR.

**Seeing the gates before launch:** `VITE_PLAN_PREVIEW=free` in `.env.local`
makes a development build treat you as free (ignored in production builds).
For the simulator: `VITE_PLAN_PREVIEW=free npx vite build --mode development`,
then sync `dist/` into `ios/App/App/public/`.

### Nutrition panel (R9) as built (2026-09-03)

One field, three sources, one panel.

- **Field**: `HomeMeal.nutrition` / `recipes.nutrition` (migration 090) — per serving: kcal, protein / carbs / fat in grams, optional fiber / sugar / sodium, plus `source` ('ai' | 'import' | 'manual'). `lib/nutrition.ts` normalizes whatever arrives.
- **AI builds**: `nutrition` is now part of the shared `build_recipe` schema (`_shared/recipe-spec.ts`), so every generation, refine, combine and import carries an estimate. The importer marks page-stated numbers as `source: 'import'`.
- **Hand-written recipes**: the recipe page offers the owner "Estimate with AI" — a new `{ nutritionFor }` mode on `build-recipe` (Sonnet, its own `estimate_nutrition` tool, endpoint `nutrition-estimate`: free 0 = Pro-only, Pro 60/hour). The result saves onto the meal (`updateHomeMeal`) or the formal recipe (`updateRecipe`).
- **Panel**: `components/recipe/NutritionPanel.tsx` after Notes from the kitchen. Pro sees the numbers with a provenance line; free sees them through a blur (a placeholder when the recipe has none) and one tap opens the sheet. The Advanced builder keeps the numbers through an edit but has no fields for them.
- **Deploy**: `build-recipe` and `import-recipe` (both bundle the shared schema).
