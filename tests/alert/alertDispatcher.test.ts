import { describe, it, expect, vi } from "vitest";
import {
  formatBuy,
  formatStrongAlert,
  dispatchStrong,
  type KolView,
} from "../../src/alert/alertDispatcher.js";
import { openDb } from "../../src/storage/db.js";
import type { SafetyResult } from "../../src/types.js";

const cented: KolView = { name: "Cented", rank: 1, tier: "S" };
const doji: KolView = { name: "Doji", rank: 12, tier: "A" };

const safety: SafetyResult = {
  pass: true,
  failedGates: [],
  stats: {
    liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000,
    ageMinutes: 45, holderCount: 300,
  },
};

describe("formatBuy", () => {
  it("shows the KOL name, rank, tier, and token", () => {
    const msg = formatBuy("MINT123", cented);
    expect(msg).toContain("Cented");
    expect(msg).toContain("#1");
    expect(msg).toContain("S-tier");
    expect(msg).toContain("MINT123");
    expect(msg).toContain("dexscreener.com");
  });
});

describe("formatStrongAlert", () => {
  it("lists all KOLs with ranks, the label, and key stats", () => {
    const msg = formatStrongAlert("MINT123", [cented, doji], "1 S + 1 A", safety);
    expect(msg).toContain("STRONG");
    expect(msg).toContain("1 S + 1 A");
    expect(msg).toContain("Cented (#1 S)");
    expect(msg).toContain("Doji (#12 A)");
    expect(msg).toContain("$50,000");
  });
});

describe("dispatchStrong", () => {
  it("sends once and dedups the second time", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const tg = { send };

    const first = await dispatchStrong(db, tg, "MINT123", [cented, doji], "1 S + 1 A", safety);
    const second = await dispatchStrong(db, tg, "MINT123", [cented, doji], "1 S + 1 A", safety);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
