import { describe, it, expect } from "vitest";
import { checkToken } from "../../src/safety/safetyChecker.js";

const thresholds = {
  minLiquidityUsd: 10000, maxTop10Pct: 30, minVolume24hUsd: 20000,
  minAgeMinutes: 5, maxAgeMinutes: 4320, minHolders: 10,
};

const deps = {
  dex: async () => ({ liquidityUsd: 50000, volume24hUsd: 100000, ageMinutes: 60, found: true }),
  rug: async () => ({ lpBurnedOrLocked: true, found: true }),
  chain: async () => ({
    mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 15, holderCount: 200,
  }),
};

describe("checkToken", () => {
  it("passes when all data sources are healthy and within thresholds", async () => {
    const r = await checkToken("mint", thresholds, deps);
    expect(r.pass).toBe(true);
  });

  it("fail-closed: DexScreener reports token not found", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, dex: async () => ({ liquidityUsd: 0, volume24hUsd: 0, ageMinutes: 0, found: false }) });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("dataUnavailable");
  });

  it("fail-closed: an on-chain fetch throws", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, chain: async () => { throw new Error("rpc down"); } });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("dataUnavailable");
  });

  it("fails normally on a bad threshold (low liquidity)", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, dex: async () => ({ liquidityUsd: 1, volume24hUsd: 100000, ageMinutes: 60, found: true }) });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("liquidity");
  });
});
