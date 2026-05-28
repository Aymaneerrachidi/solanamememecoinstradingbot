import { describe, it, expect } from "vitest";
import { scoreConsistency, buildKolList } from "../../src/engine/consistency.js";
import type { Snapshot } from "../../src/storage/snapshotStore.js";

function snap(wallet: string, rank: number, day: number, name = wallet): Snapshot {
  return { wallet, name, pnl: 100 - rank, winRate: 0.5, rank, day };
}

describe("scoreConsistency", () => {
  it("ranks a consistent performer above a one-day fluke", () => {
    const now = 100;
    const snaps: Snapshot[] = [
      // consistent: rank ~5 on many recent days
      snap("consistent", 5, 100), snap("consistent", 6, 99), snap("consistent", 4, 98), snap("consistent", 5, 97),
      // fluke: rank 1 once, long ago
      snap("fluke", 1, 80),
    ];
    const scored = scoreConsistency(snaps, now, 50);
    expect(scored[0].wallet).toBe("consistent");
    expect(scored.find((s) => s.wallet === "consistent")!.appearances).toBe(4);
  });

  it("weights recent days more than older ones", () => {
    const now = 100;
    // same rank, but one KOL's appearances are recent, the other's are >30 days old
    const snaps: Snapshot[] = [
      snap("recent", 10, 100), snap("recent", 10, 99),
      snap("old", 10, 60), snap("old", 10, 59),
    ];
    const scored = scoreConsistency(snaps, now, 50);
    expect(scored[0].wallet).toBe("recent");
  });

  it("uses the most recent snapshot for display fields", () => {
    const snaps: Snapshot[] = [
      { wallet: "w", name: "OldName", pnl: 10, winRate: 0.3, rank: 5, day: 90 },
      { wallet: "w", name: "NewName", pnl: 50, winRate: 0.7, rank: 3, day: 99 },
    ];
    const scored = scoreConsistency(snaps, 100, 50);
    expect(scored[0]).toMatchObject({ name: "NewName", pnl: 50, winRate: 0.7 });
  });
});

describe("buildKolList", () => {
  it("assigns rank + tier by score order and caps at maxKols", () => {
    const scored = [
      { wallet: "a", name: "a", pnl: 9, winRate: 0.5, score: 300, appearances: 5 },
      { wallet: "b", name: "b", pnl: 8, winRate: 0.5, score: 200, appearances: 4 },
      { wallet: "c", name: "c", pnl: 7, winRate: 0.5, score: 100, appearances: 3 },
    ];
    const list = buildKolList(scored, { sRankMax: 1, aRankMax: 2 }, 1000, 2);
    expect(list).toHaveLength(2); // capped
    expect(list[0]).toMatchObject({ wallet: "a", rank: 1, tier: "S" });
    expect(list[1]).toMatchObject({ wallet: "b", rank: 2, tier: "A" });
  });
});
