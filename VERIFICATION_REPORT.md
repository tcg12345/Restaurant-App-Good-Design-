# Post-Fix Verification Report — Gourmet Canvas

*Generated 2026-07-19. Re-audit of the codebase after the fix pass, verifying the ~114 prompts in `CLAUDE_CODE_FIX_PROMPTS.md` were implemented correctly and hunting for regressions/new bugs. Five parallel deep audits (security/data, social/messaging/reels, pantry/rating/detail, discover/AI-chat, recipes/guides/shell); top findings hand-verified against source.*

---

## Overall verdict

**The fix pass is excellent.** The overwhelming majority of findings were implemented correctly, and several were implemented *better* than the prompt asked (atomic rate-limit RPC, per-id toggle serialization queue, keyset pagination, signed Mux playback, a shared `useSubmitOnce`/`useBlobPhotos`/`kb-pad` set of helpers). Twelve new database migrations (046–061) were added, numbered sequentially, with `SECURITY DEFINER` functions correctly pinning `search_path`. `tsc --noEmit` was wired into the build as `prebuild`. No **critical or high-severity** regressions were found.

What remains is a short tail of **low/medium** items — a few spots a fix didn't reach, and a handful of minor new edge cases. None block shipping; the one worth doing before a recipe-import release is I-1.

Spot-checks I verified directly: `api/` deleted; Mux ownership + `userId:rowId` passthrough + signed playback; MediaEditor audio merge (both paths); follow-count / expert-stat / public-data RPCs with matching arg names; `clearLocalAppData` on sign-out/guest/switch incl. the signed-URL cache; RecipeModal delete wired to `deleteRecipe`; ImportRecipesModal parser (still broken — see I-1); duplicate `037` migration prefix.

---

## Verification summary

| Area | Result |
|---|---|
| **Security (S1–S10)** | All correct. `api/` removed; AI endpoints require JWT + atomic per-user rate limiting; Mux upload verifies ownership and signs non-public playback; video edits keep audio; prompt-injection fencing + undoable `toggle_wishlist` + route-whitelisted `navigate`; profile-load failure shows retry (no bio wipe); sign-out purges all local data. |
| **Data integrity (H1–H8, M30)** | Correct, one partial: merge stamps `updatedAt` on all entity edits with local-wins ties; delta-only community republish; single-upsert replaces `ensureRow`; `restaurant_meta` split into real columns; photo retry queue; AI-chat flush-before-switch + storage-backed images. *Partial:* ~20 list/wishlist/trip/meal mutators still run persistence inside their `setState` updater (harmless today — coalesced + idempotent — but not the stated goal). |
| **Social / messaging / reels** | Correct: follower-count + expert-stat RPCs; decline-then-re-request works; like/save races serialized and reconciled; per-user conversation hide; failed-send/retry states; server-timestamp unread + visibility gate; single-timestamp feed ordering with "edited"; friends' posts queried server-side; cross-user geocode writes removed (shared geo cache); upload cancel + reaper + keyset pagination + blob-URL revocation. |
| **Pantry / rating / detail** | All 12 correct: touch reorder → `/reorder` and desktop splice-in-place; slider gap clamp; single-fire H2H completion; live trip ratings + correct average; on-demand trip geocoding; `RatingModal` retired for `AddRestaurantModal` with submit latch + correct price/date seeding; shared `parseVisitDate`; unified `getNextOpenLabel`; RestaurantPanel try/catch + blob photos; non-interactive inline map; hours TTL refresh. |
| **Discover / AI-chat / location** | All 10 correct: UGC fencing + whitelisted navigate; flush-first history + sliced retry + uploaded draft images; loading-state try/finally; map survives layout flip; canonical prefs-hash + runId + AbortSignal; social signals re-score; whole-city Michelin match; home-anchored search bias; dead rec pipeline removed; **F11 personalization now forwarded to the assistant**. |
| **Recipes / guides / shell** | Mostly correct: recipe delete + latch + explicit cover; strict + unicode-aware ingredient parsing in the main flows; seeded-draft slot isolation; AI coercion + error handling; 24h hour wheel; review writes via `stashMetaKey`; `Editable` innerText + paste sanitization; guide Esc/backdrop/unpublish/reset/city-capture; keyboard `--kb-height` sweep; dead desktop nav removed; ref-counted scroll lock; `replace:true` up-nav; error-boundary filtering + reset. *Gaps:* I-1, I-9 below. |

---

## Remaining / new issues

Ordered by severity. Each has a copy-pasteable prompt.

### I-1 — [MEDIUM] ImportRecipesModal still uses its own broken ingredient parser

The strict shared parser (fix H13/H15) was applied to RecipeModal, AddRecipeModal, RecipePage and recipe-display, but **not** to the bulk importer. `src/components/ImportRecipesModal.tsx:81-99` keeps its own regex that treats any ≤8-char first word as a unit — `"2 bay leaves"` → unit `"bay"`, `"3 ripe bananas"` → unit `"ripe"` — so imported recipes get garbage units. This is the exact bug the shared strict parser eliminated everywhere else.

```
In src/components/ImportRecipesModal.tsx, delete the local parseIngredientLine (~lines 81-99) and import the shared parser: `import { parseIngredientLine, displayAmount } from '../lib/ingredient-parsing'`. Update the two call sites (~174 CSV, ~237 JSON) to map its result to RecipeIngredient as RecipeModal/AddRecipeModal already do: { name, amount: displayAmount(amount), unit }. Verify "2 bay leaves" imports as name "bay leaves" with no unit, and "1 1/2 cups flour" as amount 1.5 / unit cups / name flour.
```

### I-2 — [MEDIUM] AI chat: `recommend_recipes` falsely reports "None matched" in the search-then-recommend flow

`src/components/LocationChat.tsx:1850-1855`: `recipeById` is the closure value captured when `sendTurn` was created. When the model calls `search_community_recipes` and then `recommend_recipes` with those ids in a later agentic turn of the *same* call, the validity check still sees the pre-search map → the tool result tells the model "None of the recipe ids matched" while the cards actually render — a contradictory closing sentence or a needless re-search. This is the intended search→recommend pattern, so it's reachable in normal use.

```
In src/components/LocationChat.tsx, resolve community-recipe validity for the recommend_recipes tool through a ref updated synchronously in the same place setChatCommunityRecipes is called (a chatCommunityRecipesRef), rather than the memoized recipeById — OR drop the id-validity gate for recommend_recipes the way recommend_restaurants already omits it (~1838-1843). Verify: in one message, ask the assistant to find and recommend community recipes; the closing text should acknowledge the cards it rendered instead of claiming none matched.
```

### I-3 — [LOW-MED] `sendTurn` omits `model` and `onSearchMichelin` from its dependency array

`src/components/LocationChat.tsx:2380-2406`: both are used inside (`model` at ~1674, `onSearchMichelin` at ~1963/1967) but aren't deps. `messages` changes every send so it self-heals after one turn, but a mid-conversation model switch (Sonnet→Opus) doesn't apply to the immediately-next message, and a re-created `onSearchMichelin` can anchor a Michelin search to a stale city.

```
Add `model` and `onSearchMichelin` to the useCallback dependency array of sendTurn in src/components/LocationChat.tsx (~2406). Verify switching the model mid-conversation applies on the very next message.
```

### I-4 — [LOW-MED] RecipeCommentThread composer missing the IME guard

The double-Enter/`isComposing` fix (M21) reached SocialFeed, FriendReviewDetail and Messages but not this composer. `src/components/RecipeCommentThread.tsx:193` (reply) and `:224` (comment) check `Enter && !shiftKey` without `!e.nativeEvent.isComposing`, so a CJK/IME confirm-Enter posts mid-composition; its in-flight guard is also state-based rather than ref-based.

```
In src/components/RecipeCommentThread.tsx add `&& !e.nativeEvent.isComposing` to the Enter handlers at ~193 and ~224, and add a submittingRef guard (mirroring commentSubmittingRef in SocialFeed) so a same-tick double Enter can't post twice. Verify an IME confirm-Enter doesn't post.
```

### I-5 — [LOW] "Open · closes …" shows both times on split-hours days

The hours unification (M1) fixed the *closed→opens* side via `getNextOpenLabel`, but the *open→closes* side still naively splits the day string. `RestaurantDetailMobile.tsx:595-596` and `RestaurantDetailDesktop.tsx:390-391` do `getTodayHours(...).split(/\s*[–-]\s*/)[1]`, so on `"11:30 AM – 2:30 PM, 5:00 PM – 9:30 PM"` it renders **"closes 2:30 PM, 5:00 PM"**. `getOpenStatus` in `useRestaurantLocationLabel.ts:99-102` already computes the correct current-window close.

```
In RestaurantDetailMobile.tsx (~595) and RestaurantDetailDesktop.tsx (~390), replace the getTodayHours(...).split(...)[1] close-time computation with the close of the currently-open interval (reuse getOpenStatus from useRestaurantLocationLabel.ts, which returns closeRaw). Verify a split lunch/dinner restaurant shows a single correct "closes" time.
```

### I-6 — [LOW] `email_exists` rate limit keys on the spoofable leftmost X-Forwarded-For

`supabase/migrations/049_auth_password_and_rate_limit.sql:71-75` uses `split_part(x-forwarded-for, ',', 1)` — the left-most XFF entry is client-supplied, so an attacker can rotate it per request to bypass the 30/min cap and resume email enumeration. (Exploitability depends on the Supabase gateway's XFF handling — verify whether Kong/Cloudflare overwrites vs appends before treating as live.)

```
In the email_exists rate-limit logic (migration 049), key the per-IP counter on the trusted client IP (the right-most X-Forwarded-For hop the gateway appends, or cf-connecting-ip) instead of split_part(...,',',1). Confirm against the deployed gateway's XFF behavior. Verify rotating a fake leftmost XFF value no longer resets the counter.
```

### I-7 — [LOW] `restaurant_geo` cache is world-writable (map cache-poisoning)

`supabase/migrations/054_restaurant_geo_cache.sql:28-39` uses `WITH CHECK (true)` on INSERT/UPDATE, so any authenticated user can overwrite any restaurant's cached coordinates (last-writer-wins, shared by all users). Not a data leak (only `restaurant_id/lat/lng`), but a griefing/poisoning vector.

```
Harden the restaurant_geo write policy (migration 054): either route writes through a SECURITY DEFINER upsert that validates the coordinates came from a geocode of that restaurant_id, or at minimum reject updates that move an existing coordinate by more than a few km without confirmation. Verify a normal geocode still writes, but arbitrary overwrites of an existing entry are rejected.
```

### I-8 — [LOW] Duplicate migration number `037`

`supabase/migrations/037_create_messaging.sql` and `037_meal_reviews_meta_rpc.sql` share the `037` prefix (latest is `061`). Both apply under filename ordering, but any tool that keys on the numeric prefix could skip the second — and if the meal-reviews RPC is skipped, cross-user meal-review counts silently fall back to an owner-only scan that returns nothing for other users.

```
Renumber supabase/migrations/037_meal_reviews_meta_rpc.sql to 062_meal_reviews_meta_rpc.sql (next free number) so no two migrations share a prefix. Confirm the RPC (get/​set meal-review meta) is present exactly once and applied.
```

### I-9 — [LOW] `local-plugins/liquid-glass-nav/` husk not deleted

Directory still exists containing only a leftover Xcode user-state plist; nothing in `src`, `vite.config.ts`, or `package.json` references it (zero runtime impact), but the cleanup (F10) is incomplete.

```
Delete local-plugins/liquid-glass-nav/ (and local-plugins/ if it becomes empty). Confirm no references to "liquid-glass" or "local-plugins" remain in the repo.
```

### I-10 — [LOW] Side effects still inside ~20 ListsContext setState updaters (M30 partial)

`rateRestaurant`/`updateRating`/`commitMeta` were correctly hoisted, but ~20 list/wishlist/trip/home-meal mutators still call `saveToStorage(...)` + `sync…ToCloud(...)` inside the functional updater (e.g. `src/contexts/ListsContext.tsx` trips 1805-1866, lists/recipes 1936-2871, home meals 1943-2146, wishlist 2339-2855). Practical impact is low — cloud writes are coalesced per channel per microtask and `saveToStorage` is idempotent, and no `publishCommunityRating` sits inside an updater — but it's unsafe under React concurrent features and contradicts the stated goal.

```
In src/contexts/ListsContext.tsx, finish M30: move the saveToStorage + sync…ToCloud calls OUT of the remaining ~20 functional setState updaters (trips, lists, recipes, home meals, wishlist) using the same eager-ref/commit helper pattern already applied to rateRestaurant/updateRating (a commitX helper mirroring commitMeta). Verify in dev StrictMode that each mutation produces exactly one storage write and one coalesced cloud write.
```

### Minor / cosmetic (optional)

- **CORS still `*` on AI Edge Functions** (auth.ts, build/location/image/import) — low risk since they use Bearer-token auth, not cookies; tighten only if desired.
- **`AddRecipeModal` has no double-submit latch** (`~193`) — synchronous write with a `Date.now()` id, so low risk; add the `useSubmitOnce` latch for parity with RecipeModal.
- **AppErrorBoundary reset only fires on `popstate`**, not `pushState` (tab taps) — "Try again" and hardware-back both still work.
- **ImportRestaurants displays the raw unclamped rating** ("12/10") though the saved score is clamped — display-only.
- **`parseVisitDate` consolidation missed one spot** (`RestaurantDetailMobile.tsx:1439` hand-rolls the same noon-anchor) — identical output today.
- **Empty-chat cuisine suggestion chips** don't fire on `/location` (label vs Google-type key mismatch, `LocationChat.tsx:768`) — cosmetic; the system prompt still reads correctly.
- **`listPosts` >150-author chunked path** sorts by `created_at` without the `id` tiebreak the single-query path uses — a page-boundary row could duplicate/skip only for users following >150 people.

---

## Bottom line

Ship-ready. Do **I-1** before promoting the recipe-import feature (it silently corrupts imported ingredient units), and **I-2** if the AI recipe-recommendation flow is user-facing. Everything else is low-severity polish that can batch into a follow-up. No critical/high regressions, no compile-breaking errors surfaced, and the security-critical items (open AI endpoints, Mux hijack, followers-only leakage, prompt injection, profile wipe, sign-out leakage) are all genuinely closed.
