import { describe, it, expect, vi } from "vitest";
import { processSells, type SellDeps } from "../src/pipeline.js";
import { openDb } from "../src/storage/db.js";
import { replaceKols } from "../src/storage/kolStore.js";
import { trackToken } from "../src/storage/trackedTokenStore.js";
import type { KolRecord, SellEvent } from "../src/types.js";
import type { DexData } from "../src/safety/dexscreener.js";

const dexInfo: DexData = {
  found: true, liquidityUsd: 50000, volume24hUsd: 80000, ageMinutes: 45,
  name: "WIF", symbol: "WIF", marketCapUsd: 1_200_000, priceUsd: 0.001,
};

const kols: KolRecord[] = [
  { wallet: "w1", name: "Cented", pnl: 100, winRate: 0.6, rank: 1, tier: "S", appearances: 20, updatedAt: 1 },
  { wallet: "w2", name: "Doji", pnl: 80, winRate: 0.5, rank: 12, tier: "A", appearances: 15, updatedAt: 1 },
];

function seed() {
  const db = openDb(":memory:");
  replaceKols(db, kols);
  trackToken(db, { tokenMint: "MINT", baselineMcUsd: 50000, ts: 1000 });
  return db;
}

function sell(wallet: string, sig: string, mint = "MINT", ts = 2000): SellEvent {
  return { kolWallet: wallet, tier: "S", tokenMint: mint, ts, signature: sig };
}

const deps = (send: () => Promise<void>, threshold = 2): SellDeps => ({
  tokenInfo: async () => dexInfo,
  tg: { send },
  exitSellerThreshold: threshold,
});

describe("processSells", () => {
  it("ignores sells of tokens that were not signaled", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const r = await processSells(db, [sell("w1", "s1", "OTHER_MINT")], deps(send));
    expect(r.sellsSeen).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("records sells but only fires an exit alert when distinct sellers crosses the threshold", async () => {
    const db = seed();
    const send = vi.fn(async () => {});

    const r1 = await processSells(db, [sell("w1", "s1")], deps(send));
    expect(r1.sellsSeen).toBe(1);
    expect(r1.exitsSent).toEqual([]);
    expect(send).not.toHaveBeenCalled();

    const r2 = await processSells(db, [sell("w2", "s2")], deps(send));
    expect(r2.sellsSeen).toBe(1);
    expect(r2.exitsSent).toEqual(["MINT#2"]);
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0];
    expect(msg).toContain("EXITED");
    expect(msg).toContain("Cented");
    expect(msg).toContain("Doji");
  });

  it("dedups: doesn't re-alert at the same seller count", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const d = deps(send);
    await processSells(db, [sell("w1", "s1"), sell("w2", "s2")], d); // fires
    const r = await processSells(db, [sell("w2", "s3")], d); // same wallet, count unchanged
    expect(r.exitsSent).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
