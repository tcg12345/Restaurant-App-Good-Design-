import { expect, it } from "vitest";
import { composeShareMessage } from "./share-message";
it("preserves a room invite with or without an accompanying message", () => {
  const invite = "Join my room: https://goodeats.test/decide?code=TACO1234";
  expect(composeShareMessage("", invite)).toBe(invite);
  expect(composeShareMessage(" Tonight? ", invite)).toBe(
    "Tonight?\n\n" + invite,
  );
  expect(composeShareMessage("Check this out")).toBe("Check this out");
});
