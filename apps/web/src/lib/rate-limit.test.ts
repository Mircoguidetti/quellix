import { expect, it } from "vitest";
import { rateLimited } from "./rate-limit";

it("limits after max hits inside the window and recovers afterwards", () => {
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) expect(rateLimited("k1", 3, 1000, t + i)).toBe(false);
  expect(rateLimited("k1", 3, 1000, t + 10)).toBe(true);
  expect(rateLimited("k1", 3, 1000, t + 5000)).toBe(false);
});
