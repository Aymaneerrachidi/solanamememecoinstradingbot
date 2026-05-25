import type { SafetyStats, SafetyResult } from "../types.js";

export interface SafetyThresholds {
  minLiquidityUsd: number;
  maxTop10Pct: number;
  minVolume24hUsd: number;
  minAgeMinutes: number;
  maxAgeMinutes: number;
  minHolders: number;
}

export function evaluateSafety(stats: SafetyStats, t: SafetyThresholds): SafetyResult {
  const failedGates: string[] = [];

  if (stats.liquidityUsd < t.minLiquidityUsd) failedGates.push("liquidity");
  if (!stats.lpBurnedOrLocked) failedGates.push("lpLock");
  if (!stats.mintAuthorityRevoked) failedGates.push("mintAuthority");
  if (!stats.freezeAuthorityRevoked) failedGates.push("freezeAuthority");
  if (stats.top10HolderPct > t.maxTop10Pct) failedGates.push("holderConcentration");
  if (stats.volume24hUsd < t.minVolume24hUsd) failedGates.push("volume");
  if (stats.ageMinutes < t.minAgeMinutes) failedGates.push("ageMin");
  if (stats.ageMinutes > t.maxAgeMinutes) failedGates.push("ageMax");
  if (stats.holderCount < t.minHolders) failedGates.push("holders");

  return { pass: failedGates.length === 0, failedGates, stats };
}
