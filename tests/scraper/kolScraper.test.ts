import { describe, it, expect } from "vitest";
import { loadKols, parseKolscanHtml } from "../../src/scraper/kolScraper.js";

const SAMPLE_ROW = `<a style="display:flex" href="/account/CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o?timeframe=1"><div></div><h1 style="font-size:20px;line-height:1;font-weight:550">Cented</h1></a><p class="cursor-pointer remove-mobile">CyaE1V</p><div class="remove-mobile" style="x"><p style="color:var(--buy-color);margin-right:2px">115</p>/<p style="color:var(--sell-color);margin-left:2px">98</p></div><div class="leaderboard_totalProfitNum__HzfFO" style="color:var(--buy-color)"><h1>+286.63<!-- --> Sol</h1><h1>(<!-- -->$24,329.5<!-- -->)</h1></div>`;

describe("parseKolscanHtml", () => {
  it("extracts wallet, name, signed SOL pnl, and win rate from a row", () => {
    const kols = parseKolscanHtml(SAMPLE_ROW);
    expect(kols).toHaveLength(1);
    expect(kols[0]).toEqual({
      wallet: "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o",
      name: "Cented",
      pnl: 286.63,
      winRate: 0.54, // 115 / (115 + 98)
    });
  });

  it("returns empty array when the HTML has no rows", () => {
    expect(parseKolscanHtml("<html>nothing here</html>")).toEqual([]);
  });
});

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
