import type { Snapshot } from "../storage/snapshotStore.js";
import type { KolRecord } from "../types.js";
import { classifyTier, type TierCutoffs } from "../scraper/classify.js";

export interface ScoredKol {
  wallet: string;
  name: string;
  pnl: number; // most-recent DAILY pnl (for display)
  winRate: number;
  qualityScore: number; // 0..1, combines monthly/weekly/daily performance + presence
  appearances: number; // distinct daily snapshots within the history window
}

// Caps used to normalize PnL into 0..1 per timeframe (above the cap, score is 1).
const PNL_CAP = { monthly: 5000, weekly: 1000, daily: 200 } as const;

// Weights for blending the per-timeframe signals into a single 0..1 quality score.
const W = {
  monthlyPnl: 0.35,
  weeklyPnl: 0.25,
  dailyPnl: 0.15,
  winRate: 0.15,
  presence: 0.1, // bonus for being on multiple boards (1/3 per board)
} as const;

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

interface KolInputs {
  wallet: string;
  daily?: Snapshot;
  weekly?: Snapshot;
  monthly?: Snapshot;
  dailyAppearances: number;
}

function qualityScore(k: KolInputs): number {
  const monthlyN = k.monthly ? clamp01(k.monthly.pnl / PNL_CAP.monthly) : 0;
  const weeklyN = k.weekly ? clamp01(k.weekly.pnl / PNL_CAP.weekly) : 0;
  const dailyN = k.daily ? clamp01(k.daily.pnl / PNL_CAP.daily) : 0;
  const wr = k.monthly?.winRate ?? k.weekly?.winRate ?? k.daily?.winRate ?? 0;
  const presence = [k.monthly, k.weekly, k.daily].filter(Boolean).length / 3;
  return +(
    W.monthlyPnl * monthlyN +
    W.weeklyPnl * weeklyN +
    W.dailyPnl * dailyN +
    W.winRate * clamp01(wr) +
    W.presence * presence
  ).toFixed(4);
}

export interface ScoreArgs {
  dailySnapshots: Snapshot[]; // entire history window
  latestDaily: Snapshot[]; // most-recent daily snapshot per wallet
  latestWeekly: Snapshot[];
  latestMonthly: Snapshot[];
}

// Builds a ranked list of every wallet seen in any timeframe, with a combined quality score
// rewarding profitable + consistent + multi-timeframe KOLs.
export function scoreConsistency(args: ScoreArgs): ScoredKol[] {
  const dailyByWallet = new Map<string, Snapshot>();
  for (const s of args.latestDaily) dailyByWallet.set(s.wallet, s);
  const weeklyByWallet = new Map<string, Snapshot>();
  for (const s of args.latestWeekly) weeklyByWallet.set(s.wallet, s);
  const monthlyByWallet = new Map<string, Snapshot>();
  for (const s of args.latestMonthly) monthlyByWallet.set(s.wallet, s);

  const appearances = new Map<string, number>();
  for (const s of args.dailySnapshots) {
    appearances.set(s.wallet, (appearances.get(s.wallet) ?? 0) + 1);
  }

  // Union of all wallets seen.
  const all = new Set<string>([
    ...dailyByWallet.keys(),
    ...weeklyByWallet.keys(),
    ...monthlyByWallet.keys(),
  ]);

  const scored: ScoredKol[] = [];
  for (const wallet of all) {
    const daily = dailyByWallet.get(wallet);
    const weekly = weeklyByWallet.get(wallet);
    const monthly = monthlyByWallet.get(wallet);
    const inputs: KolInputs = {
      wallet,
      daily,
      weekly,
      monthly,
      dailyAppearances: appearances.get(wallet) ?? 0,
    };
    // Pick the freshest snapshot for display fields (prefer daily for current state).
    const display = daily ?? weekly ?? monthly!;
    scored.push({
      wallet,
      name: display.name,
      pnl: display.pnl,
      winRate: display.winRate,
      qualityScore: qualityScore(inputs),
      appearances: inputs.dailyAppearances,
    });
  }

  return scored.sort((a, b) => b.qualityScore - a.qualityScore);
}

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
      appearances: k.appearances,
      qualityScore: k.qualityScore,
      updatedAt: now,
    };
  });
}
