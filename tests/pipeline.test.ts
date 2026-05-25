import { describe, it, expect, vi } from "vitest";
import { processBuys } from "../src/pipeline.js";
import { openDb } from "../src/storage/db.js";
import { replaceKols } from "../src/storage/kolStore.js";
import type { BuyEvent, KolRecord, SafetyResult } from "../src/types.js";

const thresholds = {
  minLiquidityUsd: 10000, maxTop10Pct: 30, minVolume24hUsd: 20000,
  minAgeMinutes: 5, maxAgeMinutes: 4320, minHolders: 10,
};
const confluence = { S: 1, A: 2, B: 3, windowMin: 30 };

const passSafety: SafetyResult = {
  pass: true, failedGates: [],
  stats: { liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000, ageMinutes: 45, holderCount: 300 },
};

const kols: KolRecord[] = [
  { wallet: "w1", name: "Cented", pnl: 100, winRate: 0.6, rank: 1, tier: "S", updatedAt: 1 },
  { wallet: "w2", name: "Doji", pnl: 80, winRate: 0.5, rank: 12, tier: "A", updatedAt: 1 },
  { wallet: "w3", name: "Bull", pnl: 5, winRate: 0.4, rank: 40, tier: "B", updatedAt: 1 },
];

function seed() {
  const db = openDb(":memory:");
  replaceKols(db, kols);
  return db;
}

function buy(wallet: string, tier: "S" | "A" | "B", sig: string, mint = "MINT", ts = Date.now()): BuyEvent {
  return { kolWallet: wallet, tier, tokenMint: mint, ts, signature: sig };
}

describe("processBuys", () => {
  it("sends a message for every new buy and dedups by signature", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);

    const r1 = await processBuys(db, [buy("w1", "S", "sig1")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(r1.buysSent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("Cented");
    expect(send.mock.calls[0][0]).toContain("#1");

    // Same signature again -> not re-sent.
    const r2 = await processBuys(db, [buy("w1", "S", "sig1")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(r2.buysSent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a single S-tier buy notifies but does NOT fire a strong alert", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);

    const r = await processBuys(db, [buy("w1", "S", "sig1")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(r.buysSent).toBe(1);
    expect(r.strongSent).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("fires a strong alert when 2 KOLs converge (1 S + 1 A) and safety passes", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);

    const r = await processBuys(
      db,
      [buy("w1", "S", "sig1"), buy("w2", "A", "sig2")],
      { thresholds, confluence, checkToken: check, tg: { send } }
    );
    expect(r.buysSent).toBe(2);
    expect(r.strongSent).toEqual(["MINT"]);
    // 2 buy messages + 1 strong alert
    expect(send).toHaveBeenCalledTimes(3);
    const strongMsg = send.mock.calls[2][0];
    expect(strongMsg).toContain("STRONG");
    expect(strongMsg).toContain("1 S + 1 A");
    expect(strongMsg).toContain("Cented");
    expect(strongMsg).toContain("Doji");
  });

  it("does NOT fire strong when converged but safety fails", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const fail: SafetyResult = { ...passSafety, pass: false, failedGates: ["liquidity"] };

    const r = await processBuys(
      db,
      [buy("w1", "S", "sig1"), buy("w2", "A", "sig2")],
      { thresholds, confluence, checkToken: async () => fail, tg: { send } }
    );
    expect(r.buysSent).toBe(2);
    expect(r.strongSent).toEqual([]);
  });

  it("does NOT fire strong when 2 distinct KOLs do not meet the threshold (2 B-tier)", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);

    const r = await processBuys(
      db,
      [buy("w3", "B", "sig1"), buy("w3b", "B", "sig2")],
      { thresholds, confluence, checkToken: check, tg: { send } }
    );
    expect(r.strongSent).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("dedups the strong alert per token", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);
    const deps = { thresholds, confluence, checkToken: check, tg: { send } };

    const r1 = await processBuys(db, [buy("w1", "S", "sig1"), buy("w2", "A", "sig2")], deps);
    expect(r1.strongSent).toEqual(["MINT"]);

    // Another A-tier buys the same token -> buy message sent, but no second strong alert.
    const r2 = await processBuys(db, [buy("w2b", "A", "sig3")], deps);
    expect(r2.buysSent).toBe(1);
    expect(r2.strongSent).toEqual([]);
  });
});
