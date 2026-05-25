import type { SafetyResult } from "../types.js";
import { evaluateSafety, type SafetyThresholds } from "./evaluate.js";
import type { DexData } from "./dexscreener.js";
import type { RugData } from "./rugcheck.js";
import type { OnchainData } from "./onchain.js";

export interface SafetyDeps {
  dex: (mint: string) => Promise<DexData>;
  rug: (mint: string) => Promise<RugData>;
  chain: (mint: string) => Promise<OnchainData>;
}

const FAIL_CLOSED: SafetyResult = {
  pass: false,
  failedGates: ["dataUnavailable"],
  stats: {
    marketCapUsd: 0, liquidityUsd: 0, lpBurnedOrLocked: false, mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false, top10HolderPct: 100, volume24hUsd: 0,
    ageMinutes: 0, holderCount: 0,
  },
};

export async function checkToken(
  mint: string,
  thresholds: SafetyThresholds,
  deps: SafetyDeps
): Promise<SafetyResult> {
  try {
    const [dex, rug, chain] = await Promise.all([deps.dex(mint), deps.rug(mint), deps.chain(mint)]);
    if (!dex.found) return FAIL_CLOSED;

    return evaluateSafety(
      {
        marketCapUsd: dex.marketCapUsd ?? 0,
        liquidityUsd: dex.liquidityUsd,
        volume24hUsd: dex.volume24hUsd,
        ageMinutes: dex.ageMinutes,
        lpBurnedOrLocked: rug.lpBurnedOrLocked,
        mintAuthorityRevoked: chain.mintAuthorityRevoked,
        freezeAuthorityRevoked: chain.freezeAuthorityRevoked,
        top10HolderPct: chain.top10HolderPct,
        holderCount: chain.holderCount,
      },
      thresholds
    );
  } catch {
    return FAIL_CLOSED;
  }
}
