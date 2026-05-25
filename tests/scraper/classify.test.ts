import { describe, it, expect } from "vitest";
import { classifyTier, classifyAll } from "../../src/scraper/classify.js";

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

describe("classifyAll", () => {
  it("assigns rank by pnl desc and tiers accordingly", () => {
    const raw = [
      { wallet: "w1", name: "a", pnl: 50, winRate: 0.6 },
      { wallet: "w2", name: "b", pnl: 200, winRate: 0.7 },
      { wallet: "w3", name: "c", pnl: 10, winRate: 0.5 },
    ];
    const result = classifyAll(raw, { sRankMax: 1, aRankMax: 2 }, 1000);
    expect(result[0]).toMatchObject({ wallet: "w2", rank: 1, tier: "S" });
    expect(result[1]).toMatchObject({ wallet: "w1", rank: 2, tier: "A" });
    expect(result[2]).toMatchObject({ wallet: "w3", rank: 3, tier: "B" });
    expect(result[0].updatedAt).toBe(1000);
  });
});
