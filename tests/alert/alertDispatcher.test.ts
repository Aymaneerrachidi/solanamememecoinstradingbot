import { describe, it, expect, vi } from "vitest";
import {
  formatBuy,
  formatSignal,
  dispatchSignal,
  type KolView,
} from "../../src/alert/alertDispatcher.js";
import { openDb } from "../../src/storage/db.js";
import type { SafetyResult } from "../../src/types.js";
import type { DexData } from "../../src/safety/dexscreener.js";
import type { SignalLevel } from "../../src/engine/signalLevels.js";

const cented: KolView = { name: "Cented", rank: 1, tier: "S", winRate: 0.6, pnl: 286, appearances: 20, qualityScore: 0.92 };
const doji: KolView = { name: "Doji", rank: 12, tier: "A", winRate: 0.43, pnl: 120, appearances: 15, qualityScore: 0.47 };
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const level: SignalLevel = { level: 1, label: "🟢 GOOD", minKols: 2, windowMin: 5 };

const info: DexData = {
  found: true, liquidityUsd: 50000, volume24hUsd: 80000, ageMinutes: 45,
  name: "Dogwifhat", symbol: "WIF", marketCapUsd: 1_200_000, priceUsd: 0.001,
  priceChangeH24: 45,
};

const safety: SafetyResult = {
  pass: true, failedGates: [],
  stats: {
    marketCapUsd: 200000, liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true,
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
    expect(msg).toContain("$1.20M");
    expect(msg).toContain("60% WR"); // KOL win rate
    expect(msg).toContain("24h +45%"); // price change
    expect(msg).toContain("gmgn.ai"); // trade link
    expect(msg).toContain(`<code>${MINT}</code>`);
    expect(msg).toContain("dexscreener.com");
  });
});

describe("formatSignal", () => {
  it("shows the level, KOL count, window, KOLs, MC, and copyable CA", () => {
    const msg = formatSignal(MINT, [cented, doji], level, safety, info);
    expect(msg).toContain("GOOD");
    expect(msg).toContain("2 KOLs");
    expect(msg).toContain("within 5 min");
    expect(msg).toContain("Cented");
    expect(msg).toContain("Doji");
    expect(msg).toContain("60% WR"); // per-KOL win rate
    expect(msg).toContain("$200.0K"); // market cap from safety stats
    expect(msg).toContain("gmgn.ai"); // quick links
    expect(msg).toContain(`<code>${MINT}</code>`);
  });

  it("escapes HTML-special characters in names", () => {
    const evil: KolView = { name: "a<b>&c", rank: 5, tier: "B", winRate: 0.2, pnl: 3, appearances: 1, qualityScore: 0.15 };
    const msg = formatSignal(MINT, [evil], level, safety, info);
    expect(msg).toContain("a&lt;b&gt;&amp;c");
  });
});

describe("dispatchSignal", () => {
  it("sends once per (token, level) and dedups a repeat of the same level", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const tg = { send };

    const first = await dispatchSignal(db, tg, MINT, [cented, doji], level, safety, info);
    const second = await dispatchSignal(db, tg, MINT, [cented, doji], level, safety, info);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fires again for the same token at a higher level", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const tg = { send };
    const higher: SignalLevel = { level: 2, label: "🔴 EXTREME", minKols: 3, windowMin: 5 };

    await dispatchSignal(db, tg, MINT, [cented, doji], level, safety, info);
    const upgraded = await dispatchSignal(db, tg, MINT, [cented, doji], higher, safety, info);
    expect(upgraded).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
