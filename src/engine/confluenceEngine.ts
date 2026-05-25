import type { BuyEvent, Tier } from "../types.js";

export interface ConfluenceThresholds {
  S: number;
  A: number;
  B: number;
}

export interface TierCounts {
  S: number;
  A: number;
  B: number;
}

const TIER_ORDER: Record<Tier, number> = { S: 3, A: 2, B: 1 };

// Distinct KOL wallets per tier (highest tier kept when a wallet appears more than once).
export function countDistinctByTier(buys: BuyEvent[]): TierCounts {
  const bestByWallet = new Map<string, Tier>();
  for (const b of buys) {
    const current = bestByWallet.get(b.kolWallet);
    if (!current || TIER_ORDER[b.tier] > TIER_ORDER[current]) {
      bestByWallet.set(b.kolWallet, b.tier);
    }
  }
  const counts: TierCounts = { S: 0, A: 0, B: 0 };
  for (const tier of bestByWallet.values()) counts[tier]++;
  return counts;
}

export function distinctCount(c: TierCounts): number {
  return c.S + c.A + c.B;
}

export function evaluateConfluence(buys: BuyEvent[], thresh: ConfluenceThresholds): boolean {
  const c = countDistinctByTier(buys);
  // Cumulative: higher tiers also count toward lower-tier thresholds.
  const effectiveS = c.S;
  const effectiveA = c.S + c.A;
  const effectiveB = c.S + c.A + c.B;
  return effectiveS >= thresh.S || effectiveA >= thresh.A || effectiveB >= thresh.B;
}

// Human-readable summary, e.g. "1 S + 1 A".
export function summarizeTiers(c: TierCounts): string {
  const parts: string[] = [];
  if (c.S) parts.push(`${c.S} S`);
  if (c.A) parts.push(`${c.A} A`);
  if (c.B) parts.push(`${c.B} B`);
  return parts.join(" + ") || "none";
}
