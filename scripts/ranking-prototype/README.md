# Supplemental restaurant ranking experiment

Update: private preference recording has since been implemented; see [the recording design and verification notes](../../docs/ranking-preference-recording.md). The storage audit below describes the original pre-recording state. This prototype remains offline and is not yet connected to the new journal.

An isolated, dependency-free Node.js prototype of a regularized Plackett–Luce model, with a Bradley–Terry baseline. It combines overlapping personal restaurant lists without using the numerical gaps between personal ratings. It does not import application code, connect to Supabase, read environment variables, change existing scores, or publish results.

**Status: research only.** There are no real users yet, per the project owner. The audit below covers storage readiness, not measured live coverage. All supplied experiments use synthetic users. Every output estimate has `publishable: false`; this is intentional, not a confidence threshold waiting to be lowered.

## Run

From the repository root, with Node 22 or later:

```sh
node --test scripts/ranking-prototype/model.test.mjs
node scripts/ranking-prototype/run.mjs --output /tmp/ranking-results.json --report /tmp/ranking-results.md
```

The default experiment is deterministic: seed `20260909`, 80 user-bootstrap replicates per scenario. `--seed` and `--bootstrap` change those settings. The CLI only writes the explicitly requested output/report paths. [RESULTS.md](RESULTS.md) contains the checked-in synthetic report; rerun with `--report scripts/ranking-prototype/RESULTS.md` to regenerate it. Tests are standalone Node tests, so the app's Vitest command does not discover them.

To audit a future local, minimized export:

```sh
node scripts/ranking-prototype/run.mjs --input /tmp/ranking-input.json --output /tmp/ranking-audit.json --report /tmp/ranking-audit.md
```

Strict order input (best first; missing restaurants are unknown):

```json
{
  "rankings": [
    { "userId": "anonymous-user-1", "items": ["restaurant-A", "restaurant-B", "restaurant-C"] },
    { "userId": "anonymous-user-2", "items": ["restaurant-C", "restaurant-A"] }
  ],
  "referenceIds": ["restaurant-A", "restaurant-B", "restaurant-C"]
}
```

Alternatively, supply `snapshots` instead of `rankings`:

```json
{
  "snapshots": [
    {
      "userId": "anonymous-user-1",
      "ratings": [
        { "restaurantId": "restaurant-A", "score": 8.2, "ratingMethod": "h2h" },
        { "restaurantId": "restaurant-B", "score": 6.4, "ratingMethod": "import" }
      ]
    }
  ]
}
```

Use one current snapshot per user, not visit history or repeated snapshots. Duplicated users/restaurants are rejected. No names, notes, photos, contact information, or credentials are needed. This is a purpose-built minimized export format, not a raw database dump. The adapter reports excluded/invalid rows and users with ties or insufficient comparable items. It preserves singleton observations for coverage reporting, but they contribute no preference evidence. Empty datasets are valid and produce no scores.

The adapter accepts `h2h` and `import` rows. Slider, unknown-method, and untracked legacy rows are excluded by default; `fromAppSnapshots(..., { includeLegacy: true })` is available for an explicitly chosen sensitivity experiment. This is stricter than today's app, which includes legacy community ratings. Imported list orders need separate validation before production use. Equal stored scores exclude the entire affected user's list in this first prototype. Tied groups in explicit input are rejected. Neither exclusion should be carried into production without assessing selection bias; a tie-aware likelihood is future work.

## Storage readiness audit

Reviewed the local source on September 9, 2026. No live queries, exports, migrations, or configuration changes were made.

| Existing source | Finding | Implication |
|---|---|---|
| `src/contexts/ListsContext.tsx`, `RestaurantRating` | Stores restaurant ID, score, method (`h2h`, `slider`, `import`), and timestamps. | Can recover an approximate current per-user order; method filtering is possible. |
| `src/lib/supabase-db.ts`, `UserAppData` / `loadUserData` | User ratings are persisted in `user_app_data.ratings`; custom ordering and visit history have separate fields. | A future approved export should obtain current ratings once per user, not count visits as independent users. |
| `src/lib/headToHeadRating.ts`, `H2HState.history`; `src/components/RatingFlow.tsx`, `resolve` / `persist` | H2H state includes choices, ties, and skips. The final flow persists the resulting score/order and method, without carrying this comparison history into `RestaurantRating`. | Cannot recover which historical ordering constraints were explicit choices versus ties, skips, or inference. |
| `src/lib/settleScores.ts` | Preserves ranking, adjusts numerical gaps, and can enforce deterministic order at 0.01 spacing. | Ignore score magnitude. A 0.01 separation must not be interpreted as confidence or proof of a decisive preference. |
| `src/pages/ReorderRatings.tsx` | Manual reorder passes an explicit order through settlement, then persists score changes. | Final scores encode edits, but provenance of the ordering is not retained in the rating row. |
| `src/lib/scoreUnlock.ts`; `ListsContext.tsx` community publishing | Community publishing begins at ten personal ratings. | A community-only export omits early lists. This unlock is a UX rule, not a statistical readiness threshold for this model. |
| `src/lib/supabase-community.ts`, `countsForCommunity` / `getCommunityRatingStats` | Current community averages exclude slider rows and include legacy rows. | Match filtering consciously when comparing baselines; prototype filtering is deliberately stricter for unknown provenance. |
| `src/lib/restaurant-import.ts`; `src/lib/restaurant-provenance.ts` | Imported ratings use resolved place IDs; the app distinguishes data sources. | Audit canonical identity across providers, branches, imports, and duplicate listings before using shared IDs as statistical overlap. Prototype assumes IDs are already canonical. |

Existing score order is adequate for a limited offline feasibility experiment. It is not a lossless record of user preferences. `custom_order` is not automatically substituted for score order by this adapter; its scope and consistency with current ratings must be resolved before any such conversion.

## Model and audit behavior

Each restaurant has a log strength, theta. For a list `[A, B, C]`, PL models choosing A from `{A,B,C}`, then B from `{B,C}`. It conditions on the visited/ranked subset; it never treats omitted restaurants as losers. All strengths are fitted jointly, which accounts for the strength of the restaurants ranked above and below each item.

The objective is the sum of each user's PL negative log likelihood divided by `listLength - 1`, plus `lambda / 2 * sum(theta²)`. Default lambda is `0.3`. This per-user normalization is a deliberate weighting policy, not the ordinary unweighted PL maximum likelihood estimator. It prevents list length alone from multiplying a user's total stage weight; it does not solve coordinated accounts or all forms of influence. A singleton has no stages. The positive quadratic penalty yields finite, unique fitted strengths, including for undefeated restaurants and disconnected groups. Unique numeric estimates do **not** imply data support for comparisons across those groups.

The BT baseline uses every implied ordered pair, weighting each by `1 / choose(listLength, 2)`. Pairwise observations from one user are not treated as independent people. This baseline is a weighted composite likelihood; its regularization requires separate tuning. Both optimizers use analytic gradients and backtracking with explicit convergence diagnostics (default maximum absolute gradient `1e-5`, comfortably below the statistical uncertainty in these examples). Tests check gradients by finite differences and a two-restaurant optimum against its analytic likelihood equation at a tighter tolerance.

Audit output includes distinct contributors, informative users, opponent counts, undirected connected components, strongly connected directed components, one-sided outcomes, and users whose removal fragments the comparison network (including losing all support for an item). The latter measures structural dependence, not every possible influential user. Directed separation warns when finite relative magnitudes rely on regularization even within a connected group.

Fitting one PL objective/gradient costs O(total list entries), while the BT baseline and opponent inventory expand pairs. The brute-force user-removal audit and bootstrap are intended for small offline experiments; this is not a production-scale training service. No unnecessary pair table is written.

## Uncertainty and the experimental 1–10 number

The bootstrap resamples whole users, refits the model, and reports a 90% range of ranks within each original component. A replicate is usable only when optimization converges and that original component remains connected. Output records the usable count; intervals are omitted with fewer than 20 usable replicates, fewer than two informative users in a component, or an unconverged original fit. These are mechanical reporting safeguards, **not publication criteria**. Reported intervals are conditional on preserved connectivity, not Bayesian credible intervals. Degenerate one-sided samples can give narrow ranges despite little knowledge of absolute strength; warnings must travel with estimates. They also omit uncertainty in the model family, selection process, reference choice, and regularization.

There is no universal rank across disconnected components. `logStrength` values from different components are not directly comparable. Equal fitted strengths receive average ranks, not a fabricated ID-based preference.

If `referenceIds` is supplied, the experimental mapping is:

`1 + 9 × mean(sigmoid(theta_restaurant − theta_reference))`

This means predicted preference against a named, fixed reference set, not an absolute restaurant-quality score or a percentile. Self-comparison contributes 0.5 when a restaurant is in the reference set. References must all be observed and in the candidate's connected component, or its number is omitted. The simulated demos use all training restaurants as an explicit reference list. A production reference set would need a fixed version, representativeness review, and continuity checks; changing it changes the meaning of the score. No blending with existing app scores is performed.

## What the experiment can and cannot establish

Scenarios cover different numerical scales, biased strong/weak selections with overlap, disconnected communities, opposing cuisine preferences, and a sparse startup. Separate fixtures test reliance on one bridging user and one prolific user. Evaluation holds out entire users; pairs involving unseen restaurants or separate training components are excluded and counted. Mean-score comparisons use rank accuracy only, since raw scores are not calibrated preference log odds. The JSON also reports PL/BT log loss and sensitivity to lambda `0.1` and `1`.

Synthetic utilities are PL-generated (except the deliberately heterogeneous mixture), so good results partly reflect matching the generator. The mean-score baseline uses simulated monotonic user score transforms, not the app's complete score-settlement algorithm. A single seed is a demonstration, not a statistical estimate of a real-world uplift. Source bias, unstable experiences over time, ranking errors, and cuisine/price selection require validation with actual users later.

## Recommended next implementation, once there is data

1. Preserve minimal explicit preference information separately: user, canonical restaurant IDs, choice/tie/skip, source, timestamp, and current ranking version. Reorder and deletion events must update or supersede stale evidence. Keep imported and score-inferred orders distinguishable. Decide data access/consent and eligibility before exporting private user snapshots.
2. Build an offline export and measure coverage and connectivity, including early users separately from community publication rules. Resolve restaurant identity and account duplication.
3. Add tie-aware fitting and compare strict explicit evidence with inferred/imported orders. Assess whether one shared model fits actual taste variation. Tune regularization and weighting on a validation split, then evaluate on untouched users or future preferences with coverage reported.
4. Refit in shadow mode; inspect user influence, temporal stability, calibration, disconnected clusters, and model sensitivity. Choose publication rules from those results, not a guessed rating count.
5. Only then consider a scheduled computation and separate versioned score storage/API. Keep existing personal rankings and community averages intact. A supplemental UI should show a score only when the selected evidence and stability rules are met.

## References

- [Plackett–Luce implementation and partial-ranking support](https://hturner.github.io/PlackettLuce/)
- [Turner et al., Modelling rankings in R: the PlackettLuce package](https://link.springer.com/article/10.1007/s00180-020-00959-3): ties, disconnected networks, and regularization.
- [Bradley–Terry model and estimation](https://stat.ethz.ch/CRAN/web/packages/BradleyTerry2/vignettes/BradleyTerry.html): opponent strength from pair comparisons.
- [Fahandar et al., Statistical Inference for Incomplete Ranking Data](https://proceedings.mlr.press/v70/fahandar17a.html): why the process determining observed rankings matters.
