import { describe, it, expect } from "vitest";
import { evaluateSafety } from "../../src/safety/evaluate.js";
import type { SafetyStats } from "../../src/types.js";

const thresholds = {
  minLiquidityUsd: 10000,
  maxTop10Pct: 30,
  minVolume24hUsd: 20000,
  minAgeMinutes: 5,
  maxAgeMinutes: 4320,
  minHolders: 100,
};

const goodStats: SafetyStats = {
  liquidityUsd: 50000,
  lpBurnedOrLocked: true,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  top10HolderPct: 20,
  volume24hUsd: 100000,
  ageMinutes: 60,
  holderCount: 500,
};

describe("evaluateSafety", () => {
  it("passes when all gates are satisfied", () => {
    const r = evaluateSafety(goodStats, thresholds);
    expect(r.pass).toBe(true);
    expect(r.failedGates).toEqual([]);
  });

  it("fails on low liquidity", () => {
    const r = evaluateSafety({ ...goodStats, liquidityUsd: 500 }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("liquidity");
  });

  it("fails when LP not burned/locked", () => {
    const r = evaluateSafety({ ...goodStats, lpBurnedOrLocked: false }, thresholds);
    expect(r.failedGates).toContain("lpLock");
  });

  it("fails when mint authority not revoked", () => {
    const r = evaluateSafety({ ...goodStats, mintAuthorityRevoked: false }, thresholds);
    expect(r.failedGates).toContain("mintAuthority");
  });

  it("fails when freeze authority not revoked", () => {
    const r = evaluateSafety({ ...goodStats, freezeAuthorityRevoked: false }, thresholds);
    expect(r.failedGates).toContain("freezeAuthority");
  });

  it("fails on holder concentration too high", () => {
    const r = evaluateSafety({ ...goodStats, top10HolderPct: 80 }, thresholds);
    expect(r.failedGates).toContain("holderConcentration");
  });

  it("fails on low volume", () => {
    const r = evaluateSafety({ ...goodStats, volume24hUsd: 100 }, thresholds);
    expect(r.failedGates).toContain("volume");
  });

  it("fails when too young", () => {
    const r = evaluateSafety({ ...goodStats, ageMinutes: 1 }, thresholds);
    expect(r.failedGates).toContain("ageMin");
  });

  it("fails when too old (dead coin)", () => {
    const r = evaluateSafety({ ...goodStats, ageMinutes: 99999 }, thresholds);
    expect(r.failedGates).toContain("ageMax");
  });

  it("fails on too few holders", () => {
    const r = evaluateSafety({ ...goodStats, holderCount: 5 }, thresholds);
    expect(r.failedGates).toContain("holders");
  });

  it("collects multiple failed gates", () => {
    const r = evaluateSafety({ ...goodStats, liquidityUsd: 0, holderCount: 1 }, thresholds);
    expect(r.failedGates).toEqual(expect.arrayContaining(["liquidity", "holders"]));
  });
});
