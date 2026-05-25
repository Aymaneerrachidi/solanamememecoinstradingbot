import { describe, it, expect } from "vitest";
import { loadKols } from "../../src/scraper/kolScraper.js";

describe("loadKols", () => {
  const cutoffs = { sRankMax: 1, aRankMax: 2 };

  it("uses the manual fetcher when provided and classifies into tiers", async () => {
    const manual = async () => [
      { wallet: "w1", name: "a", pnl: 10, winRate: 0.5 },
      { wallet: "w2", name: "b", pnl: 99, winRate: 0.9 },
    ];
    const kols = await loadKols({ fetchRaw: manual, cutoffs, now: 1234 });
    expect(kols[0]).toMatchObject({ wallet: "w2", rank: 1, tier: "S" });
    expect(kols[1]).toMatchObject({ wallet: "w1", rank: 2, tier: "A" });
  });

  it("falls back to the previous list when the fetcher throws", async () => {
    const prev = [
      { wallet: "old", name: "o", pnl: 1, winRate: 0.1, rank: 1, tier: "S" as const, updatedAt: 1 },
    ];
    const failing = async () => { throw new Error("scrape down"); };
    const kols = await loadKols({ fetchRaw: failing, cutoffs, now: 1234, previous: prev });
    expect(kols).toEqual(prev);
  });

  it("returns empty when fetcher throws and there is no previous list", async () => {
    const failing = async () => { throw new Error("scrape down"); };
    const kols = await loadKols({ fetchRaw: failing, cutoffs, now: 1234 });
    expect(kols).toEqual([]);
  });
});
