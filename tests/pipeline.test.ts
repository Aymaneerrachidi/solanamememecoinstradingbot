import { describe, it, expect, vi } from "vitest";
import { processBuys, type PipelineDeps } from "../src/pipeline.js";
import { openDb } from "../src/storage/db.js";
import { replaceKols } from "../src/storage/kolStore.js";
import type { BuyEvent, KolRecord, SafetyResult } from "../src/types.js";
import type { DexData } from "../src/safety/dexscreener.js";
import type { SignalLevel } from "../src/engine/signalLevels.js";

const signalLevels: SignalLevel[] = [
  { level: 1, label: "🟢 GOOD", minWeight: 0.6, windowMin: 5 },
  { level: 2, label: "🔴 EXTREME", minWeight: 1.2, windowMin: 5 },
];

const passSafety: SafetyResult = {
  pass: true, failedGates: [],
  stats: { marketCapUsd: 200000, liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000, ageMinutes: 45, holderCount: 300 },
};

const dexInfo: DexData = {
  found: true, liquidityUsd: 50000, volume24hUsd: 80000, ageMinutes: 45,
  name: "Dogwifhat", symbol: "WIF", marketCapUsd: 1_200_000, priceUsd: 0.001,
};

const kols: KolRecord[] = [
  { wallet: "w1", name: "Cented", pnl: 100, winRate: 0.6, rank: 1, tier: "S", appearances: 20, qualityScore: 0.7, updatedAt: 1 },
  { wallet: "w2", name: "Doji", pnl: 80, winRate: 0.5, rank: 12, tier: "A", appearances: 15, qualityScore: 0.4, updatedAt: 1 },
  { wallet: "w3", name: "Bull", pnl: 5, winRate: 0.4, rank: 40, tier: "B", appearances: 3, qualityScore: 0.15, updatedAt: 1 },
];

function seed() {
  const db = openDb(":memory:");
  replaceKols(db, kols);
  return db;
}

function deps(
  send: () => Promise<void>,
  check: () => Promise<SafetyResult>,
  individualBuyTiers: Set<"S" | "A" | "B"> = new Set(["S", "A", "B"])
): PipelineDeps {
  return { signalLevels, individualBuyTiers, checkToken: check, tokenInfo: async () => dexInfo, tg: { send } };
}

function buy(wallet: string, tier: "S" | "A" | "B", sig: string, mint = "MINT", ts = Date.now()): BuyEvent {
  return { kolWallet: wallet, tier, tokenMint: mint, ts, signature: sig };
}

describe("processBuys", () => {
  it("sends a message for every new buy and dedups by signature", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const r1 = await processBuys(db, [buy("w1", "S", "sig1")], deps(send, async () => passSafety));
    expect(r1.buysSent).toBe(1);
    expect(send.mock.calls[0][0]).toContain("Cented");
    expect(send.mock.calls[0][0]).toContain("WIF");

    const r2 = await processBuys(db, [buy("w1", "S", "sig1")], deps(send, async () => passSafety));
    expect(r2.buysSent).toBe(0);
  });

  it("notifies only once when the same KOL buys the same token multiple times", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const r = await processBuys(
      db,
      [buy("w1", "S", "sig1"), buy("w1", "S", "sig2"), buy("w1", "S", "sig3")],
      deps(send, async () => passSafety)
    );
    expect(r.buysSent).toBe(1);
  });

  it("ladder-only mode (no individual tiers): no buy messages, but signals still fire", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const ladderOnly = deps(send, async () => passSafety, new Set());

    const r = await processBuys(db, [buy("w1", "S", "sig1"), buy("w2", "A", "sig2")], ladderOnly);
    expect(r.buysSeen).toBe(2); // both recorded
    expect(r.buysSent).toBe(0); // but no individual-buy messages
    expect(r.signalsSent).toEqual(["MINT#1"]); // GOOD signal still fires
    expect(send).toHaveBeenCalledTimes(1); // only the signal message
  });

  it("a single KOL buy notifies but fires no signal", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);
    const r = await processBuys(db, [buy("w1", "S", "sig1")], deps(send, check));
    expect(r.buysSent).toBe(1);
    expect(r.signalsSent).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("fires a GOOD signal when 2 KOLs converge and safety passes", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const r = await processBuys(
      db,
      [buy("w1", "S", "sig1"), buy("w2", "A", "sig2")],
      deps(send, async () => passSafety)
    );
    expect(r.buysSent).toBe(2);
    expect(r.signalsSent).toEqual(["MINT#1"]);
    const signalMsg = send.mock.calls[2][0];
    expect(signalMsg).toContain("GOOD");
    expect(signalMsg).toContain("2 KOLs");
    expect(signalMsg).toContain("Cented");
    expect(signalMsg).toContain("Doji");
  });

  it("does NOT fire a signal when converged but safety fails", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const fail: SafetyResult = { ...passSafety, pass: false, failedGates: ["liquidity"] };
    const r = await processBuys(
      db,
      [buy("w1", "S", "sig1"), buy("w2", "A", "sig2")],
      deps(send, async () => fail)
    );
    expect(r.signalsSent).toEqual([]);
  });

  it("re-alerts when a coin climbs to a higher level", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const d = deps(send, async () => passSafety);

    const r1 = await processBuys(db, [buy("w1", "S", "s1"), buy("w2", "A", "s2")], d);
    expect(r1.signalsSent).toEqual(["MINT#1"]); // GOOD (2 KOLs)

    const r2 = await processBuys(db, [buy("w3", "B", "s3")], d);
    expect(r2.signalsSent).toEqual(["MINT#2"]); // EXTREME (3 KOLs)
  });

  it("does not repeat the same level for a token", async () => {
    const db = seed();
    const send = vi.fn(async () => {});
    const d = deps(send, async () => passSafety);

    await processBuys(db, [buy("w1", "S", "s1"), buy("w2", "A", "s2")], d); // GOOD
    // A repeat buy by an existing KOL keeps it at 2 distinct -> still GOOD -> no re-alert.
    const r2 = await processBuys(db, [buy("w1", "S", "s9")], d);
    expect(r2.signalsSent).toEqual([]);
  });
});
