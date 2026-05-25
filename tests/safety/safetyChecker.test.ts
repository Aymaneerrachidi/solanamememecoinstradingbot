import { describe, it, expect } from "vitest";
import { checkToken } from "../../src/safety/safetyChecker.js";

const thresholds = { minMarketCapUsd: 10000, maxMarketCapUsd: 0 };

const deps = {
  dex: async () => ({ liquidityUsd: 50000, volume24hUsd: 100000, ageMinutes: 60, found: true, marketCapUsd: 250000, symbol: "WIF", name: "Dogwifhat" }),
  rug: async () => ({ lpBurnedOrLocked: true, found: true }),
  chain: async () => ({
    mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 60, holderCount: 8,
  }),
};

describe("checkToken", () => {
  it("passes when MC is in range and rug-killers are clean", async () => {
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

  it("fails on low market cap", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, dex: async () => ({ liquidityUsd: 50000, volume24hUsd: 100000, ageMinutes: 60, found: true, marketCapUsd: 1000 }) });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("marketCapLow");
  });

  it("fails on a missing rug-killer (LP not locked)", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, rug: async () => ({ lpBurnedOrLocked: false, found: true }) });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("lpLock");
  });
});
