import { describe, it, expect, vi } from "vitest";
import {
  sanitizeTastePreferences,
  tastePreferencesFromQuiz,
  readTastePreferences,
  mergeTastePreferences,
  patchTastePreferences,
  recipePreferenceScore,
  guidePreferenceScore,
  tasteRankingKey,
  tastePreferenceText,
} from "./taste-preferences";
import {
  buildTasteProfile,
  buildCandidateQueries,
  scoreCandidates,
  withPreferenceOverrides,
  recPrefsHashForProfile,
  type RecCandidate,
  type CandidateSignals,
} from "./recommendations";
import { buildTasteSummary } from "./assistant-taste";
import type { RestaurantRating } from "../contexts/ListsContext";
const prefs = (p: Record<string, unknown> = {}) => sanitizeTastePreferences(p);
const target = { label: "New York, NY", lat: 40.73, lng: -73.99 };
const ratings = Array.from(
  { length: 30 },
  (_, i) =>
    ({
      restaurantId: `old${i}`,
      name: `Old ${i}`,
      cuisine: "Italian",
      price: "$$$$",
      score: 9,
      createdAt: Date.now(),
      tags: [],
      photos: [],
      listIds: [],
      friendIds: [],
      address: "New York, NY",
      wouldReturn: true,
    }) as RestaurantRating,
);
const signals: CandidateSignals = {
  friendUserIds: new Set(),
  expertUserIds: new Set(),
  followedExpertIds: new Set(),
  communityByRestaurant: new Map(),
  expertRecRestaurantIds: new Set(),
};
const candidate = (id: string, cuisine: string, price = 4) =>
  ({
    id,
    name: id,
    types: [`${cuisine}_restaurant`],
    priceLevel: price,
    lat: 40.73,
    lng: -73.99,
    rating: 4.5,
    userRatingCount: 200,
    address: "New York, NY",
  }) as RecCandidate;
describe("private taste preferences", () => {
  it("seeds account quiz preferences and tolerates absent or invalid profile data", () => {
    expect(
      tastePreferencesFromQuiz({
        cuisines: ["Thai"],
        pricePrimary: 2,
        priceSecondary: 3,
      }).prices,
    ).toEqual([2, 3]);
    expect(tastePreferencesFromQuiz({})).toEqual(prefs());
    expect(
      tastePreferencesFromQuiz({ pricePrimary: "wrong", prices: [1] }).prices,
    ).toEqual([1]);
  });

  it("drops invalid tiers, unknown keys and contradictory cuisines", () => {
    const p = prefs({
      prices: [0, 2, 2, 9, "3"],
      cuisines: ["Italian", "Thai"],
      avoidCuisines: ["Italian"],
      points: 9000,
      notes: "x".repeat(900),
    });
    expect(p.prices).toEqual([2]);
    expect(p.cuisines).toEqual(["Thai"]);
    expect(p).not.toHaveProperty("points");
    expect(p.notes).toHaveLength(700);
  });
  it("rejects another account and merges by edit timestamp", () => {
    const a = {
      version: 1,
      ownerId: "a",
      updatedAt: 20,
      values: prefs({ cuisines: ["Thai"] }),
    };
    const b = { ...a, updatedAt: 10, values: prefs({ cuisines: ["Italian"] }) };
    expect(readTastePreferences(a, "b")).toBeNull();
    expect(mergeTastePreferences(a, b, "a")?.values.cuisines).toEqual(["Thai"]);
  });
  it("allows AI to clear fields without replacing unrelated preferences", () => {
    const current = prefs({
      notes: "Mild spice",
      cuisines: ["Thai"],
      prices: [4],
      dietary: ["Vegan"],
    });
    const p = patchTastePreferences(current, {
      prices: [],
      dietary: [],
      notes: "",
    });
    expect(p.cuisines).toEqual(["Thai"]);
    expect(p.prices).toEqual([]);
    expect(p.dietary).toEqual([]);
    expect(current.notes).toBe("Mild spice");
  });
  it("lets an explicit new like replace an old avoidance", () => {
    expect(
      patchTastePreferences(prefs({ avoidCuisines: ["Thai"] }), {
        addCuisines: ["Thai"],
      }).cuisines,
    ).toEqual(["Thai"]);
  });
  it("lets AI clear a cooking time preference", () => {
    expect(
      patchTastePreferences(prefs({ cookingMinutes: 30 }), {
        cookingMinutes: 0,
      }).cookingMinutes,
    ).toBeUndefined();
  });
  it("cannot apply a rating or point change through the AI patch", () => {
    const p = patchTastePreferences(prefs(), {
      points: 100,
      score: 10,
      ratings: [],
      addCuisines: ["Thai"],
    } as any);
    expect(p.cuisines).toEqual(["Thai"]);
    expect(p).not.toHaveProperty("score");
    expect(p).not.toHaveProperty("points");
  });
  it("keeps private prose out of recommendation cache keys", () => {
    const a = prefs({ cuisines: ["Thai"], notes: "Secret family plans" }),
      b = { ...a, notes: "Changed note" };
    expect(tasteRankingKey(a)).toBe(tasteRankingKey(b));
    const p = buildTasteProfile([], [], [], [], null, { preferences: a });
    expect(recPrefsHashForProfile(p, 1000)).not.toContain("Secret");
  });
});
describe("recommendations respect explicit taste without changing evidence", () => {
  it("preserves every computed historical metric and source rating", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1788690000000);
    const copy = structuredClone(ratings);
    const baseline = buildTasteProfile(ratings, [], [], []);
    const edited = buildTasteProfile(ratings, [], [], [], null, {
      preferences: prefs({ cuisines: ["Japanese"], prices: [1] }),
    });
    expect({ ...edited, preferences: undefined }).toEqual(baseline);
    expect(ratings).toEqual(copy);
    clock.mockRestore();
  });
  it("keeps explicit likes and dislikes effective after 30 ratings", () => {
    const baseline = buildTasteProfile(ratings, [], [], []);
    const p = buildTasteProfile(ratings, [], [], [], null, {
      preferences: prefs({
        cuisines: ["Japanese"],
        avoidCuisines: ["Italian"],
      }),
    });
    const pool = [
      candidate("Italian", "italian"),
      candidate("Japanese", "japanese"),
    ];
    expect(scoreCandidates(pool, baseline, signals, target, 5000)[0].id).toBe(
      "Italian",
    );
    expect(scoreCandidates(pool, p, signals, target, 5000)[0].id).toBe(
      "Japanese",
    );
  });
  it("retrieves the requested cuisine and budget instead of only historical spending", () => {
    const p = buildTasteProfile(ratings, [], [], [], null, {
      preferences: prefs({ cuisines: ["Japanese"], prices: [1] }),
    });
    const queries = buildCandidateQueries(p, target);
    expect(queries[0].text).toContain("Japanese");
    expect(queries[0].priceLevels).toEqual([1]);
    expect(
      scoreCandidates(
        [candidate("cheap", "japanese", 1)],
        p,
        signals,
        target,
        5000,
        { enforcePriceBand: true },
      ),
    ).toHaveLength(1);
  });
  it("lets tonight’s explicit budget override the saved default in retrieval", () => {
    const p = buildTasteProfile(ratings, [], [], [], null, {
      preferences: prefs({ prices: [1] }),
    });
    expect(
      buildCandidateQueries(p, target, { priceTiers: [3] })[0].priceLevels,
    ).toEqual([3]);
  });
  it("lets the current budget and cuisine override defaults without saving them", () => {
    const saved = prefs({ prices: [1], avoidCuisines: ["Japanese"] });
    const p = buildTasteProfile([], [], [], [], null, { preferences: saved });
    const tonight = withPreferenceOverrides(p, [4], ["Japanese"]);
    expect(tonight.preferences?.prices).toEqual([4]);
    expect(tonight.preferences?.avoidCuisines).toEqual([]);
    expect(p.preferences).toEqual(saved);
    expect(saved.prices).toEqual([1]);
    const pool = [
      candidate("cheap", "japanese", 1),
      candidate("celebration", "japanese", 4),
    ];
    expect(scoreCandidates(pool, tonight, signals, target, 5000)[0].id).toBe(
      "celebration",
    );
  });
  it("uses atmosphere and dietary preferences to retrieve options", () => {
    const p = buildTasteProfile([], [], [], [], null, {
      preferences: prefs({ atmosphere: "quiet outdoor", dietary: ["Vegan"] }),
    });
    expect(buildCandidateQueries(p, target)[0].text).toContain(
      "quiet outdoor Vegan",
    );
  });
  it("does not put preference edits in an earned-profile build", () => {
    const baseline = buildTasteProfile(ratings, [], [], []);
    expect(buildTasteSummary(baseline, null).statedPreferences).toBeUndefined();
  });
});
describe("cooking and assistant defaults", () => {
  it("boosts matching cuisines and known time budgets without inventing missing metadata", () => {
    const p = prefs({ cuisines: ["Thai"], cookingMinutes: 30 });
    expect(
      recipePreferenceScore(p, {
        cuisine: "Thai",
        prepTimeMinutes: 10,
        cookTimeMinutes: 15,
      }),
    ).toBeGreaterThan(
      recipePreferenceScore(p, {
        cuisine: "Italian",
        prepTimeMinutes: 10,
        cookTimeMinutes: 60,
      }),
    );
    expect(recipePreferenceScore(p, { cuisine: "Italian" })).toBe(0);
  });
  it("prioritizes guide titles matching stated cuisines", () => {
    const p = prefs({ cuisines: ["Italian"] });
    expect(
      guidePreferenceScore(p, {
        title: "Our Italian favorites",
        type: "restaurant",
      }),
    ).toBeGreaterThan(
      guidePreferenceScore(p, {
        title: "Our Thai favorites",
        type: "restaurant",
      }),
    );
  });
  it("provides separate stated context for AI, including notes", () => {
    const p = prefs({ notes: "Mild spice", goal: "cooking" });
    const summary = buildTasteSummary(
      buildTasteProfile(ratings, [], [], [], null, { preferences: p }),
      null,
    );
    expect(summary.statedPreferences).toContain("Mild spice");
    expect(summary.ratingCount).toBe(30);
    expect(tastePreferenceText(p)).toContain("cooking");
  });
});
