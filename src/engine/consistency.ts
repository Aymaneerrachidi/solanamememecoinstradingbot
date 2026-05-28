import type { Snapshot } from "../storage/snapshotStore.js";
import type { KolRecord } from "../types.js";
import { classifyTier, type TierCutoffs } from "../scraper/classify.js";

export interface ScoredKol {
  wallet: string;
  name: string;
  pnl: number; // most-recent snapshot pnl (for display)
  winRate: number;
  score: number;
  appearances: number; // distinct days on the board within the window
}

// Recency weighting: this week counts most, then this month, then older.
// Captures "daily / weekly / monthly" in one score — frequent + recent + high-ranked wins.
function recencyWeight(ageDays: number): number {
  if (ageDays <= 7) return 3; // weekly form
  if (ageDays <= 30) return 1.5; // monthly consistency
  return 1;
}

// Higher rank (smaller number) earns more points; never negative.
function rankPoints(rank: number, listSize: number): number {
  return Math.max(1, listSize - rank + 1);
}

// Combines daily snapshots into a consistency ranking. A KOL on the board many days scores
// far above a one-day fluke, with recent days weighted heaviest.
export function scoreConsistency(snaps: Snapshot[], nowDay: number, listSize = 50): ScoredKol[] {
  const byWallet = new Map<string, Snapshot[]>();
  for (const s of snaps) {
    const arr = byWallet.get(s.wallet);
    if (arr) arr.push(s);
    else byWallet.set(s.wallet, [s]);
  }

  const scored: ScoredKol[] = [];
  for (const [wallet, list] of byWallet) {
    let score = 0;
    for (const s of list) {
      score += rankPoints(s.rank, listSize) * recencyWeight(nowDay - s.day);
    }
    const latest = list.reduce((a, b) => (b.day > a.day ? b : a));
    scored.push({
      wallet,
      name: latest.name,
      pnl: latest.pnl,
      winRate: latest.winRate,
      score,
      appearances: list.length,
    });
  }

  return scored.sort((a, b) => b.score - a.score);
}

// Turns the consistency-ranked list into tracked KOL records (rank = position, tier by cutoff),
// capped at `maxKols` to bound monitoring load.
export function buildKolList(
  scored: ScoredKol[],
  cutoffs: TierCutoffs,
  now: number,
  maxKols: number
): KolRecord[] {
  return scored.slice(0, maxKols).map((k, i) => {
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
