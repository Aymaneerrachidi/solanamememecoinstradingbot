import type { SafetyStats, SafetyResult } from "../types.js";

export interface SafetyThresholds {
  minMarketCapUsd: number;
  maxMarketCapUsd: number; // 0 = no upper cap
}

// Lean safety for the KOL-ladder mechanism: market cap range + the three anti-rug checks.
// (Liquidity, volume, age, holders and concentration are shown in alerts but not gated on.)
export function evaluateSafety(stats: SafetyStats, t: SafetyThresholds): SafetyResult {
  const failedGates: string[] = [];

  if (stats.marketCapUsd < t.minMarketCapUsd) failedGates.push("marketCapLow");
  if (t.maxMarketCapUsd > 0 && stats.marketCapUsd > t.maxMarketCapUsd) failedGates.push("marketCapHigh");
  if (!stats.lpBurnedOrLocked) failedGates.push("lpLock");
  if (!stats.mintAuthorityRevoked) failedGates.push("mintAuthority");
  if (!stats.freezeAuthorityRevoked) failedGates.push("freezeAuthority");

  return { pass: failedGates.length === 0, failedGates, stats };
}
