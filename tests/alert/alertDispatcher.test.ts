import { describe, it, expect, vi } from "vitest";
import { formatAlert, dispatchAlert } from "../../src/alert/alertDispatcher.js";
import { openDb } from "../../src/storage/db.js";
import type { BuyEvent, SafetyResult } from "../../src/types.js";

const buys: BuyEvent[] = [
  { kolWallet: "wAAA", tier: "S", tokenMint: "MINT123", ts: 0, signature: "s1" },
  { kolWallet: "wBBB", tier: "A", tokenMint: "MINT123", ts: 0, signature: "s2" },
];

const safety: SafetyResult = {
  pass: true,
  failedGates: [],
  stats: {
    liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000,
    ageMinutes: 45, holderCount: 300,
  },
};

describe("formatAlert", () => {
  it("includes token, KOL count, tiers, and key stats", () => {
    const msg = formatAlert("MINT123", buys, safety);
    expect(msg).toContain("MINT123");
    expect(msg).toContain("2 KOL");
    expect(msg).toContain("S");
    expect(msg).toContain("dexscreener.com");
    expect(msg).toContain("$50,000");
  });
});

describe("dispatchAlert", () => {
  it("sends once and dedups the second time", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const tg = { send };

    const first = await dispatchAlert(db, tg, "MINT123", buys, safety);
    const second = await dispatchAlert(db, tg, "MINT123", buys, safety);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
