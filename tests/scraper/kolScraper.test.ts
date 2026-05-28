import { describe, it, expect } from "vitest";
import { parseKolscanHtml } from "../../src/scraper/kolScraper.js";

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
