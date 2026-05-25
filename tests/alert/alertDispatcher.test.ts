import { describe, it, expect, vi } from "vitest";
import {
  formatBuy,
  formatStrongAlert,
  dispatchStrong,
  type KolView,
} from "../../src/alert/alertDispatcher.js";
import { openDb } from "../../src/storage/db.js";
import type { SafetyResult } from "../../src/types.js";
import type { DexData } from "../../src/safety/dexscreener.js";

const cented: KolView = { name: "Cented", rank: 1, tier: "S" };
const doji: KolView = { name: "Doji", rank: 12, tier: "A" };
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const info: DexData = {
  found: true, liquidityUsd: 50000, volume24hUsd: 80000, ageMinutes: 45,
  name: "Dogwifhat", symbol: "WIF", marketCapUsd: 1_200_000, priceUsd: 0.001,
};

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
  it("shows KOL, token symbol, market cap, and a copyable contract", () => {
    const msg = formatBuy(MINT, cented, info);
    expect(msg).toContain("Cented");
    expect(msg).toContain("#1");
    expect(msg).toContain("WIF");
    expect(msg).toContain("$1.20M"); // market cap, compact
    expect(msg).toContain(`<code>${MINT}</code>`); // tap-to-copy CA
    expect(msg).toContain("dexscreener.com");
  });

  it("falls back to a short mint when token is not indexed yet", () => {
    const msg = formatBuy(MINT, cented, { found: false, liquidityUsd: 0, volume24hUsd: 0, ageMinutes: 0 });
    expect(msg).toContain(MINT.slice(0, 8));
    expect(msg).toContain(`<code>${MINT}</code>`);
  });
});

describe("formatStrongAlert", () => {
  it("lists all KOLs, the label, MC, and stats", () => {
    const msg = formatStrongAlert(MINT, [cented, doji], "1 S + 1 A", safety, info);
    expect(msg).toContain("STRONG");
    expect(msg).toContain("1 S + 1 A");
    expect(msg).toContain("Cented");
    expect(msg).toContain("Doji");
    expect(msg).toContain("$1.20M");
    expect(msg).toContain(`<code>${MINT}</code>`);
  });

  it("escapes HTML-special characters in names", () => {
    const evil: KolView = { name: "a<b>&c", rank: 5, tier: "B" };
    const msg = formatStrongAlert(MINT, [evil], "1 B", safety, info);
    expect(msg).toContain("a&lt;b&gt;&amp;c");
  });
});

describe("dispatchStrong", () => {
  it("sends once and dedups the second time", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const tg = { send };

    const first = await dispatchStrong(db, tg, MINT, [cented, doji], "1 S + 1 A", safety, info);
    const second = await dispatchStrong(db, tg, MINT, [cented, doji], "1 S + 1 A", safety, info);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
