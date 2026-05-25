import type { KolRecord, Tier } from "../types.js";

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

export function classifyAll(raw: RawKol[], cutoffs: TierCutoffs, now: number): KolRecord[] {
  const sorted = [...raw].sort((a, b) => b.pnl - a.pnl);
  return sorted.map((k, i) => {
    const rank = i + 1;
    return {
      wallet: k.wallet,
      name: k.name,
      pnl: k.pnl,
      winRate: k.winRate,
      rank,
      tier: classifyTier(rank, cutoffs),
      updatedAt: now,
    };
  });
}
