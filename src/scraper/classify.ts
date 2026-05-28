import type { Tier } from "../types.js";

export interface TierCutoffs {
  sRankMax: number;
  aRankMax: number;
}

export interface RawKol {
  wallet: string;
  name: string;
  pnl: number;
  winRate: number;
}

export function classifyTier(rank: number, cutoffs: TierCutoffs): Tier {
  if (rank <= cutoffs.sRankMax) return "S";
  if (rank <= cutoffs.aRankMax) return "A";
  return "B";
}
