import { describe, it, expect, vi } from "vitest";
import { processBuys } from "../src/pipeline.js";
import { openDb } from "../src/storage/db.js";
import type { BuyEvent, SafetyResult } from "../src/types.js";

const thresholds = {
  minLiquidityUsd: 10000, maxTop10Pct: 30, minVolume24hUsd: 20000,
  minAgeMinutes: 5, maxAgeMinutes: 4320, minHolders: 10,
};
const confluence = { S: 1, A: 2, B: 3, windowMin: 30 };

const passSafety: SafetyResult = {
  pass: true, failedGates: [],
  stats: { liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000, ageMinutes: 45, holderCount: 300 },
};

function freshBuy(wallet: string, tier: "S" | "A" | "B", sig: string, mint = "MINT", ts = Date.now()): BuyEvent {
  return { kolWallet: wallet, tier, tokenMint: mint, ts, signature: sig };
}

describe("processBuys (end-to-end pipeline)", () => {
  it("alerts when confluence + safety pass, then dedups", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);

    // One S-tier buy meets confluence (S:1).
    const buys = [freshBuy("w1", "S", "sig1")];
    const alerted = await processBuys(db, buys, { thresholds, confluence, checkToken: check, tg: { send } });
    expect(alerted).toEqual(["MINT"]);
    expect(send).toHaveBeenCalledTimes(1);

    // Same token again -> deduped, no second alert.
    const again = await processBuys(db, [freshBuy("w2", "S", "sig2")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(again).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does NOT alert when confluence is not met", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);
    const alerted = await processBuys(db, [freshBuy("w1", "A", "sigX")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(alerted).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("does NOT alert when safety fails", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const fail: SafetyResult = { ...passSafety, pass: false, failedGates: ["liquidity"] };
    const alerted = await processBuys(db, [freshBuy("w1", "S", "sigY")], { thresholds, confluence, checkToken: async () => fail, tg: { send } });
    expect(alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
