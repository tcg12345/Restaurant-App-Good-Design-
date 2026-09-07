# Monetization Plan — Gourmet Canvas Pro + Creator Paywalls

*Planning doc, 2026-07-19. Decisions locked with Tyler: both payment rails at launch (Apple IAP via RevenueCat in-app + Stripe on web, unified entitlements) · free tier meters AI and caps creation tools · any user can paywall original content · v1 creator model is one-time unlocks (creator subscriptions and Pro-catalog deferred).*

---

## 1. Principles

1. **The app stays great free.** The core loop — rate restaurants, social feeds, reels/posts, messaging, search, wishlist, head-to-head — is never gated. Gating targets things that cost real money (AI inference, image generation) and power-user creation tools.
2. **Try-before-paywall everywhere.** Every Pro feature has a free allowance ("3 AI recipes left this month"), so users experience the value before being asked to pay.
3. **Server-authoritative entitlements.** The client renders state; edge functions and RLS enforce it. Nothing paid is enforceable client-side only (same philosophy as the privacy/RLS work in migrations 036/046).
4. **One entitlements truth across rails.** An Apple IAP purchase and a Stripe web purchase land in the same `entitlements`/`content_purchases` tables; the app doesn't care where you paid.
5. **Reuse what exists.** The AI rate-limit RPC (047), signed-URL private media, Mux signed playback (048), verification system (034), SECURITY DEFINER RPC patterns, `useSubmitOnce`/Sheet/toast UI kit, and the edge-function auth layer are all building blocks here — very little is greenfield.

---

## 2. The tiers

### Free (everything not listed below is unlimited)
Full social graph, feeds, reels, posts, comments, messaging, ratings (incl. head-to-head + reorder), wishlist, lists, search, Discover, Michelin data/filters, taste profile/stats, restaurant detail, CSV import/export, simple recipe creation (RecipeModal/AddRecipeModal), unlimited *private* everything.

### Metered for free users (Pro removes/raises the caps)

| Feature | Where it lives | Free allowance (proposal) | Pro |
|---|---|---|---|
| AI assistant chat (LocationChat / AppAssistant) | `supabase/functions/location-chat` | 10 messages/day, Sonnet-class only | 200/day, Opus for recipe turns |
| AI recipe generation | `functions/build-recipe` (Opus) | 3/month | 100/month |
| Recipe import (URL / photo / paste) | `functions/import-recipe` | 5/month | 200/month |
| AI recipe cover images | `functions/generate-recipe-image` | 2/month | 50/month |
| Advanced recipe builder (publish) | `AdvancedRecipeBuilder.tsx` | 5 published advanced recipes total, then Pro | Unlimited |
| Published guides | `GuideCreatorSheet` / `supabase-guides` | 1 published at a time | Unlimited |
| Active trips | Pantry TripsTab | 1 active trip | Unlimited |

Notes on cap shapes (matching "a certain number of uses before upgrading, depending on the feature"):
- **Daily** for chat (habit feature, resets fast so free users keep coming back).
- **Monthly** for the expensive one-shots (generation, import, images).
- **Lifetime/concurrent** for creation tools (5 advanced recipes *total*; 1 guide/trip *at a time* — unpublishing a guide or completing a trip frees the slot, which is friendlier than deletion-only).
- All numbers are dials, stored server-side in a `quota_limits` table — marketing can tune without an app release.

### Pro subscription
- **Product:** `pro_monthly`, `pro_yearly` (+ 7-day free trial on yearly — proposal).
- **Suggested pricing (open question #1):** $5.99/mo, $39.99/yr. Apple price tiers map cleanly; Stripe mirrors.
- Also includes: all creator-content *allowances* stay personal — Pro does **not** include creator premium content in v1 (that's the deferred "Pro catalog" phase), keeping creator economics clean at launch.

---

## 3. Architecture

### 3.1 Entitlements (the single source of truth)

New migration `063_monetization_core.sql`:

```sql
-- What a user is entitled to, regardless of where they bought it
create table entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement text not null,          -- 'pro'
  source text not null,               -- 'apple' | 'stripe' | 'promo'
  product_id text,                    -- store SKU / stripe price id
  status text not null,               -- 'active' | 'grace' | 'expired' | 'refunded'
  expires_at timestamptz,
  updated_at timestamptz default now(),
  unique (user_id, entitlement, source)
);
-- RLS: owner SELECT only; writes ONLY via service-role (webhooks). No client writes ever.

create table quota_limits (            -- server-tunable dials
  feature text primary key,            -- 'ai_chat' | 'build_recipe' | 'import_recipe' | 'gen_image' | 'adv_recipe' | 'guides' | 'trips'
  free_limit int not null,
  pro_limit int not null,
  period text not null                 -- 'day' | 'month' | 'lifetime' | 'concurrent'
);
```

**Quota consumption** generalizes the existing `consume_ai_rate_limit` (047) — same atomic INSERT…ON CONFLICT counter pattern, but entitlement-aware:

```sql
create function consume_quota(p_feature text)
returns table (allowed boolean, used int, cap int, is_pro boolean)
security definer set search_path = public ...
-- looks up caller's active 'pro' entitlement, picks free_limit vs pro_limit,
-- windows by period, increments atomically, returns the verdict + meter state.
```

The four AI edge functions swap `enforceRateLimit` → `enforceQuota('ai_chat' …)` in `_shared/limits.ts` (one place — the consolidation flagged in the verification report pays off here). The existing abuse-prevention hourly limits (047) stay as a second, higher ceiling.

`get_quota_state()` RPC returns all meters in one call for the client UI.

### 3.2 Payment rails

**Apple IAP (in-app) — via RevenueCat**
- `@revenuecat/purchases-capacitor` SDK; configure with the Supabase user id as the RevenueCat app-user-id (set after auth in `AuthContext`).
- Products: `pro_monthly`, `pro_yearly` subscriptions; consumables `unlock_t1`…`unlock_t5` for creator content price tiers (§4.4).
- New edge function `revenuecat-webhook`: verifies the webhook auth header, upserts `entitlements` on INITIAL_PURCHASE / RENEWAL / CANCELLATION / EXPIRATION / BILLING_ISSUE (→ `grace`), and records consumable purchases into `content_purchases` (the reel/post `mux-webhook` is the template: service-role writes, signature check, idempotent by event id).

**Stripe (web build) — Checkout + Connect**
- Edge functions: `stripe-checkout-session` (creates a Checkout Session for Pro or a content unlock; `client_reference_id` = user id) and `stripe-webhook` (`checkout.session.completed`, `customer.subscription.updated/deleted` → same `entitlements` / `content_purchases` upserts; idempotent by event id).
- Web-only UI surface: the paywall sheet on `VITE_PUBLIC_WEB_ORIGIN` shows Stripe checkout; the iOS build shows StoreKit. **The iOS app never links to web checkout** (Apple 3.1.1; the US external-link entitlement is a possible later optimization, not v1).
- A purchase on either rail unlocks everywhere — buying on the web and using on iOS is the fully-allowed Netflix/Patreon pattern, as long as the app doesn't advertise it.

**Client: `EntitlementsContext`** (new, sits beside `AuthContext`)
- Loads `entitlements` + `get_quota_state()` on auth; caches in localStorage with a 48h offline grace (local-first, matching ListsContext philosophy); exposes `isPro`, `quota(feature)`, `refresh()`; realtime-subscribes to the user's own `entitlements` row so a web purchase unlocks the open app within seconds.
- Restore purchases: RevenueCat `restorePurchases()` wired into Profile → settings (App Store requirement).

### 3.3 Paywall UI kit (one system, used everywhere)

- **`PaywallSheet`** — the single upgrade surface (built on the existing sheet pattern: `DraggableSheet`/`useBottomSheet`, `kb-pad`, `useSubmitOnce`). Variants: feature-meter exhausted ("You've used 3 of 3 AI recipes this month"), pro pitch (feature list), content unlock (creator item, price, buy button). Native: StoreKit purchase; web: Stripe redirect.
- **`MeterChip`** — "2 left this month" pill rendered next to metered actions (AI generator button, import panel, guide publish, trip create). Data from `EntitlementsContext.quota()` — no extra requests.
- **Lock badges** — small lock glyph on `RecipeCard`/`GuideCard`/`cards/*` for premium creator content, and a `ScoreRing`-style price chip ("$2.99") on unowned items.
- **Gate points** (client preflight + server enforcement):
  - `LocationChat`/`AppAssistant` send → quota check → PaywallSheet (server still enforces in `location-chat`).
  - `AiRecipeGenerator.handleGenerate`, `ImportRecipePanel`, `generate-recipe-image-client` → same.
  - `AdvancedRecipeBuilder` publish, `GuideCreatorSheet` publish (StepPublish), Pantry `CreateTripSheet` → count checks via `consume_quota`/`get_quota_state`.
- Guests (guest mode exists): metered features show the sign-in sheet first (`SignInModalContext`), never the paywall — you can't sell to an anonymous user, and Apple requires purchases be tied to restorable accounts anyway.

---

## 4. Creator paywalls (v1: one-time unlocks)

### 4.1 What can be paywalled
- **Recipes** — public `home_meals` / `recipes` that are original: server-enforced `createdWithAi = false AND importedFrom IS NULL` (both fields already exist on HomeMeal). `AdvancedRecipeBuilder` output qualifies; AI-generated and imported recipes can never be marked premium (the flag is checked in a DB trigger, not just the client).
- **Guides** — published guides (inherently original curation).
- *Not in v1:* reels/posts (keep social free — growth loop), individual photos.
- **Honesty caveat:** `createdWithAi` is self-reported by which builder was used. The trigger enforces the recorded provenance; the report/moderation flow (below) covers false claims and stolen content.

### 4.2 Who can paywall
Per decision: **anyone with original content** — no verification gate. Two safety rails:
1. **Payout account required to price content**: you can't mark content premium until Stripe Connect onboarding is complete (§4.5). This is the natural quality filter (real identity + bank details) without a review queue.
2. **Report → takedown flow**: extend the existing report affordance (`CardActionMenu`) with "stolen/plagiarized content" on premium items; repeated upheld reports revoke monetization (flag on `creator_accounts`). Apple's UGC guideline (1.2) requires this anyway once money is involved.

### 4.3 Content gating — teaser + server enforcement

New migration `064_premium_content.sql`:

```sql
create table premium_content (
  content_type text not null,          -- 'recipe' | 'guide'
  content_id text not null,            -- home_meal id / recipes.id / guides.id
  owner_id uuid not null references auth.users(id) on delete cascade,
  price_tier smallint not null,        -- 1..5 → fixed price points (§4.4)
  active boolean default true,
  created_at timestamptz default now(),
  primary key (content_type, content_id)
);

create table content_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null, content_id text not null,
  owner_id uuid not null,
  source text not null,                -- 'apple' | 'stripe' | 'promo'
  price_cents int, currency text, store_fee_cents int,
  external_txn_id text unique,         -- idempotency across webhooks
  status text not null default 'complete',  -- 'complete' | 'refunded'
  created_at timestamptz default now()
);
-- Purchases survive content edits/unpublish: access checks purchases first.
```

**Access resolution** — one RPC used by every read path:
```sql
create function get_content_access(p_type text, p_id text)
returns text  -- 'owner' | 'purchased' | 'locked' | 'free'
```

**Teaser design** (what "locked" renders):
- **Recipe** (`RecipePage`/`RecipePanel`): cover, title, author, summary/intro, time/difficulty/servings, ingredient *count* and section names — ingredients list, steps, notes, and gallery are locked. Reviews stay visible (social proof sells).
- **Guide** (`GuideDetail`/`GuideRender`): hero, title, intro, TOC entry *names*, first entry fully visible — remaining entries' blurbs/notes/must-orders locked.

**Server-side enforcement — this is the important part.** The full body of a premium item must not reach an unentitled client:
- Premium recipes/guides get their body served through entitlement-aware RPCs (`get_recipe_full`, `get_guide_full`) that check `get_content_access` and return either full or teaser shape. The existing public-data RPC pattern (migration 036) is the template.
- RLS on the base tables narrows direct SELECT of premium rows to teaser-safe columns (or denies and forces the RPC path — cleaner: a `*_teaser` view with `USING (true)` and base-table SELECT restricted to owner + purchasers via an EXISTS on `content_purchases`).
- **Media**: premium photos move to the private-bucket + signed-URL pipeline that already exists for posts (`storage-upload`/`signed-url-cache`); the sign-URL edge path checks `get_content_access` before minting. Premium video (future) uses the Mux signed-playback machinery from 048 as-is.
- Feed/list surfaces (`SocialFeed`, `RecipesForYou`, `GuidesBrowser`, search) show teaser cards with lock badges — they already render from list-shaped queries that don't include bodies, so mostly UI work.

### 4.4 Pricing & purchase flow
- **Fixed price tiers**, not arbitrary prices — Apple IAP requires pre-registered products, so creators pick a tier: T1 $0.99, T2 $1.99, T3 $2.99, T4 $4.99, T5 $9.99. In-app these map to consumable IAPs `unlock_t1..t5`; on web, Stripe charges the same number.
- Buy flow: lock badge / locked section → PaywallSheet (content variant: cover, creator, price) → native purchase or Stripe checkout → webhook writes `content_purchases` → realtime/`refresh()` unlocks in place, with a celebratory toast.
- Refunds: webhook events (Apple `REFUND`, Stripe `charge.refunded`) flip status → `refunded`; access RPC ignores refunded rows; creator ledger reverses the earning.
- Buyers keep access forever, including if the item is later unpublished or its price changes (purchase row is the truth).

### 4.5 Creator earnings & payouts

```sql
create table creator_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text,              -- Connect Express
  onboarding_complete boolean default false,
  monetization_revoked boolean default false,
  updated_at timestamptz default now()
);

create table creator_ledger (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  purchase_id uuid references content_purchases(id),
  gross_cents int not null, store_fee_cents int not null,
  platform_fee_cents int not null, net_cents int not null,
  status text not null default 'pending',   -- 'pending' | 'paid' | 'reversed'
  payout_batch_id uuid, created_at timestamptz default now()
);
```

- **Split (open question #2, proposal):** creator gets **80% of net-after-store-fees**. Worked examples for a $2.99 unlock: Stripe web → ~$2.90 net → creator ~$2.32. Apple IAP (15% SBP) → $2.54 net → creator ~$2.03. (At Apple's 30%: creator ~$1.67 — reality of rail economics; the UI can show creators their earnings by rail.)
- **Payouts:** Stripe Connect Express for everyone (web *and* IAP-sourced earnings — Apple pays you, you pay creators from proceeds). Monthly batch via a scheduled edge function (the migration-050 reaper cron is the template), minimum $25 balance, ledger visible in-app.
- **Creator dashboard:** a new "Earnings" section in Profile settings — lifetime/pending/paid, per-item sales, onboarding CTA (`stripe-connect-onboard` edge function → account link), tax note (Stripe handles 1099s for Express accounts).

---

## 5. App Store compliance checklist

- Digital goods in-app → IAP only; no mention/link of web pricing inside the iOS app (3.1.1). Web-purchase unlocking silently is allowed (3.1.3(b) multiplatform).
- Subscriptions: restore-purchases button, manage-subscription deep link (`https://apps.apple.com/account/subscriptions`), Terms/Privacy links on the paywall (the Auth-page link fix from the audit gets reused), clear price + renewal disclosure on the PaywallSheet.
- Creator (UGC) monetization: report + block + takedown flow live before launch (1.2); "anyone can sell" makes this a review talking point — the payout-onboarding gate helps.
- Account deletion (already implemented) must keep financial records: `delete-account` keeps `content_purchases`/`creator_ledger` rows but anonymizes the user reference (legal/tax retention) — small edit to the existing edge function.
- Price tiers registered in App Store Connect ahead of review; consumables need a restore story (they're recorded server-side, so "restore" = entitlements refresh — document this for review notes).

---

## 6. Build phases

**Phase 1 — Entitlements foundation (1 migration + 4 edge functions + 1 context)**
`063_monetization_core.sql`; `revenuecat-webhook`, `stripe-webhook`, `stripe-checkout-session`; RevenueCat SDK setup; `EntitlementsContext`; PaywallSheet + MeterChip components; Pro products in App Store Connect + Stripe. *Exit: a user can buy Pro on either rail and `isPro` flips everywhere.*

**Phase 2 — Pro metering live**
`consume_quota`/`get_quota_state` + `quota_limits` seeding; swap the four AI functions to `enforceQuota`; client gate points (chat, generator, import, images); creation caps (advanced publish, guide publish, trip create). *Exit: free users hit friendly meters; Pro users don't.*

**Phase 3 — Creator unlocks**
`064_premium_content.sql`; provenance trigger; teaser RPCs + RLS narrowing; premium media through signed URLs; lock-badge UI on cards + locked-body UI on RecipePage/GuideDetail; consumable IAPs + Stripe one-time checkout; purchase webhooks → `content_purchases`; report-flow extension. *Exit: a creator can price an original recipe/guide; a buyer on either rail unlocks it.*

**Phase 4 — Payouts**
Stripe Connect onboarding, `creator_ledger` accrual from webhooks, monthly payout cron, Earnings dashboard. *Exit: creators actually get paid.*

**Deferred (designed-for, not built):** per-creator supporter subscriptions (schema slots in cleanly: an `entitlement = 'creator:<uuid>'` row + per-creator IAP product group) and the Pro-included premium catalog with engagement-weighted rev share (needs a consumption-metering ledger — explicitly out of v1).

---

## 7. Open questions (non-blocking, need answers before Phase 1 ships)

1. **Pro pricing** — proposal: $5.99/mo · $39.99/yr · 7-day trial on yearly. Confirm numbers.
2. **Creator split** — proposal: 80% of net-after-store-fees, same % on both rails (simple story) even though Apple-rail net is lower. Alternative: 100% to creators at launch as a growth lever, take a cut later (grandfathering headache — decide now).
3. **Free-allowance dials** — the table in §2 is a starting proposal; confirm or tune each number (they're server-side dials either way).
4. **Trial abuse posture** — allowances are per-account and guests can't use AI; is that enough, or do we also want device-level throttles on account creation (heavier, defer unless abused)?
5. **Existing users** — grandfather anything? (e.g. users with >1 published guide / >1 active trip at launch keep them — recommended: yes, cap applies to *new* creations only. The plan assumes this.)
