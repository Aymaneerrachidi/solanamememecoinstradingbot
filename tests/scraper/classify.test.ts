import { describe, it, expect } from "vitest";
import { classifyTier } from "../../src/scraper/classify.js";

describe("classifyTier", () => {
  const cutoffs = { sRankMax: 10, aRankMax: 30 };
  it("ranks 1..10 are S", () => {
    expect(classifyTier(1, cutoffs)).toBe("S");
    expect(classifyTier(10, cutoffs)).toBe("S");
  });
  it("ranks 11..30 are A", () => {
    expect(classifyTier(11, cutoffs)).toBe("A");
    expect(classifyTier(30, cutoffs)).toBe("A");
  });
  it("ranks 31+ are B", () => {
    expect(classifyTier(31, cutoffs)).toBe("B");
  });
});
