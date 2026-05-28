import { describe, it, expect } from "vitest";
import { scoreConsistency, buildKolList } from "../../src/engine/consistency.js";
import type { Snapshot } from "../../src/storage/snapshotStore.js";

function snap(wallet: string, rank: number, day: number, pnl = 100, winRate = 0.5, timeframe: "daily" | "weekly" | "monthly" = "daily"): Snapshot {
  return { wallet, name: wallet, pnl, winRate, rank, day, timeframe };
}

describe("scoreConsistency", () => {
  it("an elite KOL on ALL 3 timeframes outscores a daily-only one-day fluke", () => {
    const elite = "elite";
    const fluke = "fluke";
    const dailyToday = snap(elite, 3, 100, 150, 0.6);
    const weekly = snap(elite, 4, 100, 700, 0.55, "weekly");
    const monthly = snap(elite, 5, 100, 3000, 0.5, "monthly");
    const flukeDaily = snap(fluke, 1, 100, 200, 0.5);
    const dailyHistory: Snapshot[] = [
      dailyToday, snap(elite, 3, 99, 140), snap(elite, 4, 98, 130), snap(elite, 5, 97, 125),
      flukeDaily, // only one day
    ];
    const scored = scoreConsistency({
      dailySnapshots: dailyHistory,
      latestDaily: [dailyToday, flukeDaily],
      latestWeekly: [weekly],
      latestMonthly: [monthly],
    });
    expect(scored[0].wallet).toBe(elite);
    expect(scored[0].qualityScore).toBeGreaterThan(scored.find((s) => s.wallet === fluke)!.qualityScore);
  });

  it("a single timeframe with low PnL scores low; presence bonus + multi-timeframe wins", () => {
    const a = scoreConsistency({
      dailySnapshots: [snap("a", 25, 100, 20)],
      latestDaily: [snap("a", 25, 100, 20)],
      latestWeekly: [snap("a", 25, 100, 100, 0.5, "weekly")],
      latestMonthly: [snap("a", 25, 100, 500, 0.5, "monthly")],
    });
    const b = scoreConsistency({
      dailySnapshots: [snap("b", 25, 100, 20)],
      latestDaily: [snap("b", 25, 100, 20)],
      latestWeekly: [],
      latestMonthly: [],
    });
    expect(a[0].qualityScore).toBeGreaterThan(b[0].qualityScore);
  });
});

describe("buildKolList", () => {
  it("assigns rank + tier by qualityScore order and caps at maxKols", () => {
    const scored = [
      { wallet: "a", name: "a", pnl: 9, winRate: 0.5, qualityScore: 0.9, appearances: 5 },
      { wallet: "b", name: "b", pnl: 8, winRate: 0.5, qualityScore: 0.5, appearances: 4 },
      { wallet: "c", name: "c", pnl: 7, winRate: 0.5, qualityScore: 0.2, appearances: 3 },
    ];
    const list = buildKolList(scored, { sRankMax: 1, aRankMax: 2 }, 1000, 2);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ wallet: "a", rank: 1, tier: "S", qualityScore: 0.9 });
    expect(list[1]).toMatchObject({ wallet: "b", rank: 2, tier: "A", qualityScore: 0.5 });
  });
});
