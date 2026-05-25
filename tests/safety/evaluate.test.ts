import { describe, it, expect } from "vitest";
import { evaluateSafety } from "../../src/safety/evaluate.js";
import type { SafetyStats } from "../../src/types.js";

const thresholds = { minMarketCapUsd: 10000, maxMarketCapUsd: 0 };

const goodStats: SafetyStats = {
  marketCapUsd: 50000,
  liquidityUsd: 50000,
  lpBurnedOrLocked: true,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  top10HolderPct: 60, // not gated anymore
  volume24hUsd: 100, // not gated anymore
  ageMinutes: 60,
  holderCount: 5, // not gated anymore
};

describe("evaluateSafety", () => {
  it("passes on MC + rug-killers, ignoring liquidity/volume/holders/concentration", () => {
    const r = evaluateSafety(goodStats, thresholds);
    expect(r.pass).toBe(true);
    expect(r.failedGates).toEqual([]);
  });

  it("fails when market cap is below the minimum", () => {
    const r = evaluateSafety({ ...goodStats, marketCapUsd: 500 }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("marketCapLow");
  });

  it("enforces a max market cap only when one is set", () => {
    expect(evaluateSafety({ ...goodStats, marketCapUsd: 9_000_000 }, thresholds).pass).toBe(true);
    const capped = evaluateSafety({ ...goodStats, marketCapUsd: 9_000_000 }, { minMarketCapUsd: 10000, maxMarketCapUsd: 5_000_000 });
    expect(capped.failedGates).toContain("marketCapHigh");
  });

  it("fails when LP is not locked/burned", () => {
    expect(evaluateSafety({ ...goodStats, lpBurnedOrLocked: false }, thresholds).failedGates).toContain("lpLock");
  });

  it("fails when mint authority is not revoked", () => {
    expect(evaluateSafety({ ...goodStats, mintAuthorityRevoked: false }, thresholds).failedGates).toContain("mintAuthority");
  });

  it("fails when freeze authority is not revoked", () => {
    expect(evaluateSafety({ ...goodStats, freezeAuthorityRevoked: false }, thresholds).failedGates).toContain("freezeAuthority");
  });
});
