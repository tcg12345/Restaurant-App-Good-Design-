import { describe, it, expect, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase: {} }));
import { normalizeGroupPreferences, swipeVote, tiedPlaces, type GroupRoom } from "./group-swipe";
import { groupRoomPath } from "./group-room-link";
import { buildTasteProfile, scoreCandidates } from "./recommendations";
import {
  buildTasteProfile as edgeProfile,
  scoreCandidates as edgeScore,
  aggregateGroup,
} from "../../supabase/functions/group-swipe/scorer.js";
import { readFileSync } from "node:fs";
describe("Group Swipe", () => {
  it("opens the mood form for empty create/join preferences and absent snapshots", () => {
    for (const response of [{}, undefined, null]) {
      const mood = normalizeGroupPreferences(response);
      expect(mood).toEqual({ cuisines: [], prices: [], dietary: [], notes: "" });
      expect(mood.cuisines.includes("Italian")).toBe(false);
    }
  });
  it("preserves saved choices and fills missing preference fields without mutating the response", () => {
    const saved = { cuisines: ["Italian"], prices: [2], dietary: ["vegan"], notes: "A quiet patio" };
    const mood = normalizeGroupPreferences(saved);
    expect(mood).toEqual(saved);
    mood.cuisines.push("Japanese");
    expect(saved.cuisines).toEqual(["Italian"]);
    expect(normalizeGroupPreferences({ notes: "Something spicy" })).toEqual({ cuisines: [], prices: [], dietary: [], notes: "Something spicy" });
    expect(normalizeGroupPreferences({ cuisines: null, prices: [0, 2, "3"], dietary: "vegan", notes: 1 })).toEqual({ cuisines: [], prices: [2], dietary: [], notes: "" });
  });
  it("distinguishes intentional gestures from scrolling and diagonal noise", () => {
    expect(swipeVote(110, 20)).toBe("yes");
    expect(swipeVote(-110, 10)).toBe("no");
    expect(swipeVote(20, 130)).toBe("veto");
    expect(swipeVote(10, -150)).toBeNull();
    expect(swipeVote(80, 95)).toBeNull();
  });
  it("accepts only valid app/web room links", () => {
    expect(
      groupRoomPath("com.tylergorin.restaurantapp://decide?code=abcd1234"),
    ).toBe("/decide?code=ABCD1234");
    expect(groupRoomPath("https://goodeats.test/decide?code=ABCD1234")).toBe(
      "/decide?code=ABCD1234",
    );
    expect(groupRoomPath("javascript:alert(1)")).toBeNull();
    expect(groupRoomPath("https://x.test/admin?code=ABCD1234")).toBeNull();
    expect(groupRoomPath("https://x.test/decide?code=../../bad")).toBeNull();
  });
  it("finds tied results without treating predicted fit as a vote", () => {
    expect(
      tiedPlaces({
        results: [
          { score: 60, fit: 90 },
          { score: 60, fit: 75 },
          { score: 30, fit: 99 },
        ],
      } as GroupRoom),
    ).toHaveLength(2);
  });
  it("runs the exact same taste scorer on the server", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1790000000000);
    const ratings = Array.from({ length: 12 }, (_, i) => ({
      restaurantId: `r${i}`,
      name: `Place ${i}`,
      cuisine: i < 8 ? "Italian" : "Japanese",
      score: i < 8 ? 9 : 5,
      price: "$$",
      tags: [],
      address: "Westport, CT",
      createdAt: Date.now(),
      photos: [],
      listIds: [],
      friendIds: [],
    }));
    const quiz = { cuisines: ["Italian"], pricePrimary: 2 };
    const a = buildTasteProfile(ratings as any, [], [], [], quiz);
    const b = edgeProfile(ratings, [], [], [], quiz);
    const signals = {
      expertUserIds: new Set<string>(),
      followedExpertIds: new Set<string>(),
      friendUserIds: new Set<string>(),
      communityByRestaurant: new Map(),
      expertRecRestaurantIds: new Set<string>(),
    };
    const candidates = ["italian_restaurant", "japanese_restaurant"].map(
      (t, i) => ({
        id: `p${i}`,
        name: t,
        types: [t, "restaurant"],
        lat: 41,
        lng: -73,
        address: "Westport, CT",
        fullAddress: "Westport, CT",
        rating: 4.5,
        priceLevel: 2,
        userRatingCount: 100,
        photoUrl: null,
      }),
    );
    expect(
      edgeScore(candidates, b, signals, { lat: 41, lng: -73 }, 5000),
    ).toEqual(
      scoreCandidates(
        candidates,
        a,
        signals,
        { lat: 41, lng: -73, label: "Westport" },
        5000,
      ),
    );
    expect(
      aggregateGroup([{ userId: "a" }, { userId: "b" }], [10, 4]).group,
    ).toBeCloseTo(5.8);
    clock.mockRestore();
  });
  it("does not ship browser clients or keys to the Edge scorer", () => {
    const source = readFileSync(
      "supabase/functions/group-swipe/scorer.js",
      "utf8",
    );
    expect(source).not.toMatch(/createClient\(|localStorage|import\.meta/);
  });
});
