import { describe, it, expect } from "vitest";
import { parseKolscanHtml } from "../../src/scraper/kolScraper.js";

// kolscan embeds the leaderboard payload as JSON inside an RSC chunk, with all three
// timeframes interleaved (1=daily, 7=weekly, 30=monthly). The quotes are JS-escaped.
const SAMPLE = `
... lots of preceding HTML ...
\\"wallet_address\\":\\"CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o\\",\\"name\\":\\"Cented\\",\\"telegram\\":null,\\"twitter\\":\\"https://x.com/Cented7\\",\\"profit\\":213.06,\\"wins\\":126,\\"losses\\":87,\\"timeframe\\":1},
\\"wallet_address\\":\\"5ZuV8eqkvzYFVEKbLvGBdexL2tFv7E5BCd2HZpjqbdg\\",\\"name\\":\\"Doji\\",\\"telegram\\":null,\\"twitter\\":\\"x\\",\\"profit\\":54.23,\\"wins\\":12,\\"losses\\":29,\\"timeframe\\":1},
\\"wallet_address\\":\\"CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o\\",\\"name\\":\\"Cented\\",\\"telegram\\":null,\\"twitter\\":\\"x\\",\\"profit\\":4870.57,\\"wins\\":2856,\\"losses\\":2626,\\"timeframe\\":30}
`;

describe("parseKolscanHtml", () => {
  it("extracts daily KOLs in pnl-descending order", () => {
    const kols = parseKolscanHtml(SAMPLE, "daily");
    expect(kols).toHaveLength(2);
    expect(kols[0]).toEqual({
      wallet: "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o",
      name: "Cented",
      pnl: 213.06,
      winRate: 0.592, // 126 / (126+87)
    });
    expect(kols[1].wallet).toBe("5ZuV8eqkvzYFVEKbLvGBdexL2tFv7E5BCd2HZpjqbdg");
  });

  it("filters by timeframe — monthly returns only timeframe=30 entries", () => {
    const monthly = parseKolscanHtml(SAMPLE, "monthly");
    expect(monthly).toHaveLength(1);
    expect(monthly[0].pnl).toBe(4870.57);
  });

  it("returns empty array when the HTML has no matches", () => {
    expect(parseKolscanHtml("<html>nothing here</html>", "weekly")).toEqual([]);
  });
});
