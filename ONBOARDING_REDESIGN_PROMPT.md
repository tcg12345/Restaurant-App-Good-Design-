# Onboarding Redesign — Cold Start

*Intent-driven prompt for Claude Code. Audit first, then build. Nothing here
prescribes an implementation; it describes what should be true when you're
done and why, so you can pick the shape that fits the code as it actually is.*

Companion spec (screen-by-screen, with the diagrams):
`https://claude.ai/code/artifact/6915e105-3b2d-4015-8efd-de62e1a42386`

---

## 0. Read this first

The onboarding flow already exists and is good work. `PreAuthFlow`, `OnboardingKit`,
`TasteSteps` and the `ProfileSetup` wizard are well-factored, the copy is careful, and
the auth-last reorder was the right call. **This is not a rewrite. It is a reordering,
three merges, two additions, and one fix in the recommendation engine that the whole
flow currently rests on and does not have.**

Before changing anything, audit and confirm — in your own words, with file:line — the
five claims below. If any is wrong, stop and say so; the design downstream depends on
them.

1. **The quiz cannot rank.** In `lib/recommendations.ts`, `scoreCandidates` computes
   `ramp = clamp(profile.highRatedCount / 3, 0, 1)`, and the cuisine (1.6), price
   (0.9–2.0), pair (1.8) and tagOverlap (1.1) terms all live inside `if (ramp > 0)`.
   `highRatedCount` only increments on a rating ≥ 8.0. Confirm: a user who answers the
   entire quiz and has rated nothing gets **zero** contribution from all four terms, and
   none of the four taste reason-chips can render.

2. **`pairScore` has no quiz input.** The quiz seeds `cuisineScore` and `priceScore`
   independently and never writes a `"cuisine|price"` key. Confirm `topPairs` is empty
   for a quiz-only profile, and that this makes Tier 1 of `buildCandidateQueries` — the
   first and highest-priority tier — emit nothing.

3. **The city is dropped.** `PreAuthFlow` writes `gourmad-preauth-city`; `ProfileSetup`
   stamps `home_city/home_lat/home_lng`. Confirm that **nothing** reads `profile.home_city`
   into `HomeLocationContext`, the map target, or any rec query — and that
   `Discover.tsx`'s mount effect resolves from `gourmad-home-last-location`, then GPS,
   then a hardcoded `New York, NY`.

4. **The first rating is a constant.** With no prior ratings in the chosen tier,
   `initH2H` completes immediately and `computeFinalScore` returns the band midpoint.
   Confirm every first "Loved it" is 8.5, and that the reveal card animates a count-up
   over it.

5. **The save toast leaks the score.** Confirm `rateRestaurant`'s toast subtitle includes
   `score.toFixed(1)` ungated by `scoresUnlocked`, while every other surface hides it
   below `SCORE_UNLOCK_THRESHOLD`.

Report the audit before writing code.

---

## 1. What we're building toward

Onboarding's job in this app is not orientation. It's **data acquisition under a
ninety-second budget**, and there are exactly three things to acquire:

- **a location** — Discover, Search, the rec target and every Places query need one;
- **a ladder** — three of five tabs are empty without the user's own ratings;
- **a few people** — the friend term is weight 1.6 and starts at zero.

Every screen must produce one of those or come out. The codebase already states the
right test, in `TasteSteps.tsx`: *"The admission rule for a question: it must change
what the app does afterwards."* Apply it without mercy, including to questions that
are currently there.

**Principles that decide the ordering:**

- *Value before the gate; the gate at the moment of loss.* Ask for the account when
  there's something concrete to lose, not a promise to redeem.
- *Don't ask what you can take.* Location from GPS. Name from Apple. Cuisine, price and
  city from an imported list.
- *Merge dimensions rather than serialize them.* Cuisine and price on one screen is the
  only way the pair signal exists.
- *Every OS permission is primed, and tied to the thing it unlocks.*
- *Never promise what the engine can't deliver.* This is why §2 comes before §3.

---

## 2. Engine first — the flow is a wrapper on this

Do these before touching a screen. Without them, the redesign ships a prettier version
of the same non-answer, and the "built from your answers" headline stays untrue.

### E1 — Let stated taste open the ranking gate, partially

`ramp` should measure *signal strength*, not *rating count*. A complete quiz is weaker
evidence than a rating the user actually gave, but it is not zero evidence. Give it
half a slot:

```
priorStrength = 1.5 * quizMass
ramp = clamp((highRatedCount + priorStrength) / 3, 0, 1)
```

This requires `quizMass` to be visible to the scorer — expose it on `TasteProfile`
rather than recomputing it. A fully answered quiz with zero ratings lands at
`ramp = 0.5`: taste terms at half strength, real ratings taking over as they arrive.

Update `recommendations.test.ts` — the `// cold start → quality/popularity only`
assertion is currently documenting the bug. Add a test that a quiz-only profile
produces a non-empty `reasons` array containing a taste-derived chip.

### E2 — Seed `pairScore` from the merged cuisine × spend answer

Inside the existing quiz-priors block, for each selected cuisine:

- `pairScore["<cuisine>|<primaryTier>"] += 2 * quizMass`
- `pairScore["<cuisine>|<secondaryTier>"] += 1 * quizMass` when a second tier was given

This is the largest weight in `DEFAULT_WEIGHTS` and the driver of query tier 1. It is
the single highest-leverage line in this whole document.

The quiz answer shape needs to change to carry it — `prices: number[]` becomes an
ordered/primary+secondary shape. Keep `sanitize()` in `taste-quiz.ts` backward-compatible:
old rows carrying a flat `prices` array must still read correctly (treat `prices[0]` as
primary). Do not migrate rows; widen the reader.

### E3 — Make the city we collect the city we use

The location step writes `gourmad-home-last-location` at the moment it resolves — the
key `Discover` genuinely reads — alongside the existing `gourmad-preauth-city`. Also
seed city affinity, which is otherwise only ever derived from rating addresses:

```
cityScore[extractCityState(loc.label, loc.label)] = 3
```

Add a backstop on sign-in: if `gourmad-home-last-location` is empty and
`profile.home_city` is set, hydrate one from the other. That covers reinstalls and
second devices.

While you're in `HomeLocationBar`: the geolocation denial copy says *"Enable it in your
browser settings"*. Wrong for a shipped App Store app. Rewrite it and add a Settings
deep link on the native path, the way the photo-permission flow already does.

### E4 — Decay the priors on the counter that opens the gate

`quizMass` fades on `scoreN` (any rating). `ramp` opens on `highRatedCount` (ratings ≥ 8).
So priors currently evaporate *before* the machinery that consumes them switches on. Key
both to `scoreN` so the handoff is continuous.

### E5 — Raise the price-confidence seed 4 → 6

`pricedPositiveN += 4 * quizMass` gives `confidence = 0.4`, and a primary+secondary
answer lands at `concentration ≈ 0.28` — under the 0.35 threshold, so the price-restricted
Places query never fires for the most natural human answer. At 6, a two-tier answer
clears it at ≈ 0.36 and a single tier stays comfortably above. Verify against the
existing `priceDist` tests rather than trusting the arithmetic here.

### E6 — Negative cuisine priors from the "rather skip" row

Symmetrical to the positive seed: `cuisineScore[token] -= 2 * quizMass`. This activates
the `negativeMult: 1.5` branch that exists, is wired, and is currently unreachable at
cold start. Map dietary answers to positive tag priors too — `Good Vegetarian Options`
is already an `ALL_TAGS` token and already matches community rows.

### E7 — Fix `LIST_TAG_MAP`

It writes `'Date Night'`, `'Cocktails'` and `'Hidden Gem'` into `tagScore`. None of the
three are tokens in `ALL_TAGS`, so no rating can carry them and no community row can
match them — they occupy `topTags` slots and send `getTagSimilarRestaurants` looking for
nothing. The real tokens are `'Special Occasion'` and `'Great Cocktails'`; there is no
hidden-gem tag, so drop that entry. The file states this invariant for
`ATMOSPHERE_TAG_PRIORS` and then breaks it two blocks down.

### E8 — Stop animating an uncomputed score

In `InlineResult`, when `comparisons === 0`: skip the count-up, change the eyebrow from
`We ranked it at` to something true, and promote the existing honest line
(*"Nothing else in this range to compare against yet"*) from 11.5px grey to the primary
subtitle. §3 makes this rare, but it still fires on the first rating in any new tier.

### E9 — Gate the save toast on `scoresUnlocked`

Below the threshold the subtitle should read `#{rank} of {total}` instead of the number.
More useful anyway, and consistent with every other locked surface.

---

## 3. The flow

Twelve named steps; the median path with Apple sign-in and an import is eight screens.
The full screen-by-screen spec — proposed copy, controls, escape hatches, what each
writes — is in the companion artifact. What follows is the structural intent.

### Act I — before the account (device-local, no user yet)

| # | Screen | Change |
|---|--------|--------|
| 01 | Welcome | Lead with the ranking, not discovery. Keep both escapes. |
| 02 | **Location** | **Moved to the front, and primed.** |
| 03 | **Cuisine × spend** | **Merged from two screens.** |
| 04 | Vibe | Keep the photo grid; add a real-`ALL_TAGS` chip row. |
| 05 | Preview + save | The gate. Now with a heart on each card. |

**02 is the important move.** It primes the permission `Discover` currently grabs
unannounced on first paint, it puts the cheapest and highest-value answer first, and it
lets every screen after it show real local places. "Use my location" is the primary and
the OS prompt fires on *that tap*, after the explainer — never on mount. Typing a city
is a first-class path, not a fallback: a GPS denial lands on the search field with
focus, not on an error.

**03 is a merge with a purpose.** Cuisine chips, then a single-select "A normal night
out" price row, then an optional smaller "and when I'm celebrating". A single dominant
tier is what crosses `concentration ≥ 0.35`; a free multi-select does not. At the bottom,
a collapsed "Anything you'd rather skip?" opening a dietary chip row (E6). The collapse
matters — most users never open it, and it costs no screen.

**05 is the gate, and it should stay the gate.** The pre-auth ordering is already right.
What changes is that the cards get a heart, so the ask becomes *save the thing you just
saved* rather than *trust us with your email*. Keep the honest thin-results copy; do not
lower the quality floor to fill five cards.

### Act II — the account (06)

Apple and Google as visual primaries; email → 6-digit code below.

**Recommended cut: drop the choose-password step at signup.** The code already proves
ownership and creates the session, and "Email me a sign-in code" is already a working
re-entry path — so the password screen buys little and costs a step at the highest
drop-off moment in the flow. Re-ask once at the end of the session, when there's a
ladder worth protecting. This touches `needsPasswordSetup` in `AuthContext` and the
`App.tsx` gate that holds `Auth` up until it's set, so treat it as a real change and
flag anything it breaks. **The conservative variant — keep the password step exactly
where it is and accept one extra screen — is acceptable; say which you shipped.**

### Act III — identity (07)

Name and handle on one screen, handle auto-deriving from the name as typed (the `seed`
logic already does this), with the live availability check. Apple/Google users get an
inline confirm instead of a screen.

**Cut the public/private step.** Asking a user with zero content who may see it is
abstract and costs a full screen. Default public (already the default) and surface the
choice at the first publish. If it must stay for trust reasons, make it a one-line
toggle here — not its own step.

This is where the profile row persists. Everything after is skippable, and a bailout in
Act IV must still leave a working account.

### Act IV — the ladder (08, 09, 10) ← the heart of this redesign

**08 — Import.** Promote `/import` out of Settings and mount it as an onboarding step.
It already works: vision-reads Beli screenshots and screen recordings, parses CSV,
writes `ratingMethod: 'import'`, skips the settle, counts toward the unlock. One action
fills both dead tabs and opens the `ramp` gate on *real* evidence rather than priors.
Restyle it into the `OnboardingKit` language. Three routes: screenshots/recording, CSV,
"I'm starting fresh" — the last with no friction and no guilt copy.

**A user who imports skips 09 and 10 entirely. Branch, don't stack.**

**09 — Pick five you've been to.** A grid of recognizable places near their city, seeded
from the candidate pool the preview already fetched (so it costs no extra billed Places
search), plus a search field. Five is a target, not a minimum — three works, one works.

**10 — One ranking pass.** The real head-to-head, same engine and same cards, run once
over the picked set. Five places is roughly seven comparisons, about forty seconds.

This replaces the current search-and-rate-one-at-a-time step, and it is the fix for
audit item #4. Today the first rating is a solo event with an empty comparison pool,
so the head-to-head — *the product* — never runs on the one rating everybody sees. A set
gives it something to rank: five real anchors instead of one hardcoded 8.5, and for most
users three ratings at 8.0+, which opens `ramp` on earned signal.

Ends on the reveal: *"#1 of 5 — your ladder is live."*

> **Worth considering while you're here:** lowering `SCORE_UNLOCK_THRESHOLD` from 10 to
> 5. Five comparison-derived placements is a defensible ladder, and ten is a long way to
> walk with the numbers hidden — especially now that the flow reliably produces five in
> the first session. Raise it as a question rather than changing it unilaterally; it
> also governs when ratings publish to the community, which is a product decision.

### Act V — people (11, conditional)

Re-rank `getSuggestedProfiles`: verified accounts in their city first, then **users who
rated the places just ranked** — real overlap, computable only after step 10, which is
exactly why this step belongs after the ladder and not before it — then global verified.

**Skip the screen silently when fewer than three candidates have real ratings.** Following
an account whose subtitle reads "New here" produces zero downstream value:
`getAllFriendRatings` returns nothing for them and friend similarity stays at the flat
0.6 default until a co-rating exists. An empty rail is worse than no rail.

### Act VI — landing (12, no screen)

**Delete the "You're all set" interstitial.** It's a dead end between the work and the
reward. Land on Discover with the location already resolved (E3) and the recommendations
prefetched during Act IV. One coach mark on the next action.

---

## 4. Invariants — do not break these

- **Guest browsing stays reachable** from the welcome screen and the gate screen. App
  Store Guideline 5.1.1(v); this app has already been rejected over it once.
- **Sign in with Apple stays a first-class option** and its name/email must not be
  re-collected (Guideline 4). The existing `seed` logic handles this — preserve it.
- **The profile row persists at the end of Act III**, before any skippable step.
- **Leaving the pre-auth flow in any direction marks it done for the device.** It's a
  first-launch experience, never a wall a returning user climbs twice.
- **Never re-ask a question the pre-auth flow already answered.** The current skip logic
  in `ProfileSetup` is correct; keep its shape as the step list changes.
- **`ProfileSetup` must never overwrite a real profile with defaults.** The
  `profileError` / `profileLoading` ordering in `App.tsx` exists for that reason. Leave
  it alone.
- **Desktop keeps its single-form `AuthShell` layout.** The wizard is the mobile surface.
  Don't port the new steps to desktop unless you also design them there.
- **The imported-rating path must keep `ratingMethod: 'import'`** and keep skipping the
  settle — migration 063's aggregation contract depends on it.
- **Chip labels must be exact `ALL_TAGS` / `CUISINE_TYPES` strings.** The rec engine
  credits them verbatim; a near-miss scores nothing. That's the bug in E7.

---

## 5. Instrumentation

`onboarding_events` currently has an INSERT policy and **no SELECT policy at all** — every
event fired since migration 075 is unreadable, including by you. Fix that first or the
redesign can't be evaluated.

- Add a read path (admin role or a view) in a new migration.
- Add **abandon** events, not just `_done`. Today the table can say how many finished a
  step and never which step lost them.
- Keep the per-install `anon_id` chain across the gate so pre-auth and post-signup read
  as one journey. That part is already right.

Four numbers decide whether this worked:

| Metric | What it answers |
|---|---|
| `location_resolved` | Share of installs with a real location **before** the gate. Effectively zero today. |
| `ladder_seeded` | Share reaching 5 ratings in session one, split by imported / ranked / neither. |
| `gate_conversion` | Preview → account, and preview → guest. Guest isn't failure; track whether guests convert later. |
| `rec_chip_rate` | Share of rec cards rendering a **taste-derived** reason chip rather than a star count. The honesty metric — 0% until E1+E2 ship. |

---

## 6. Order of work

Ship in this order. Each stage is independently valuable and independently revertible.

1. **Audit** (§0) — report before coding.
2. **E3** — the city reaches the map. Smallest diff, largest immediate improvement.
3. **E1 + E2 + E4 + E5** — the answers reach the ranking. Tests first.
4. **E7, E8, E9** — the cheap corrections.
5. **Step 08** — import promoted into onboarding.
6. **Steps 09 + 10** — the five-place ranking pass.
7. **Steps 02–05** — the pre-auth reordering and the merge (E6 rides here).
8. **Steps 06, 07, 11, 12** — account, identity, people, landing.
9. **Instrumentation** (§5).

If only three things ship: **E3**, **E1+E2**, and **step 08**. Those change what the app
does on day one. The screen choreography is worth doing and can wait a release.

---

## 7. Open questions — raise, don't decide

- Drop the signup password step, or keep it? (§Act II)
- Lower `SCORE_UNLOCK_THRESHOLD` 10 → 5? (§Act IV)
- The dietary row collects data App Store privacy labels treat carefully — an allergy
  reads as health data, halal/kosher as religious affiliation. Frame it as preferences,
  keep it optional, store it in the existing `taste_profile` JSON, and confirm the App
  Privacy questionnaire is updated before it ships.
- Three primitives are missing that cap what any onboarding can do, and none belong in
  this change: **no invite / contact sync / share-your-profile** (a `sharedProfile`
  variant of the existing `ShareDialog` is the cheap version); **no push notifications
  at all** (no APNs entitlement, no plugin — net-new plumbing, and when it lands, prime
  it after the first rating publishes, never during onboarding); **no way to read the
  funnel** (§5).
