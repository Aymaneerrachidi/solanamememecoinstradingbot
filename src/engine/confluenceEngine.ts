import type { BuyEvent, Tier } from "../types.js";

export interface ConfluenceThresholds {
  S: number;
  A: number;
  B: number;
}

const TIER_ORDER: Record<Tier, number> = { S: 3, A: 2, B: 1 };

export function evaluateConfluence(buys: BuyEvent[], thresh: ConfluenceThresholds): boolean {
  // Highest tier per distinct wallet.
  const bestByWallet = new Map<string, Tier>();
  for (const b of buys) {
    const current = bestByWallet.get(b.kolWallet);
    if (!current || TIER_ORDER[b.tier] > TIER_ORDER[current]) {
      bestByWallet.set(b.kolWallet, b.tier);
    }
  }

  let s = 0, a = 0, bCount = 0;
  for (const tier of bestByWallet.values()) {
    if (tier === "S") s++;
    else if (tier === "A") a++;
    else bCount++;
  }

  const effectiveS = s;
  const effectiveA = s + a;
  const effectiveB = s + a + bCount;

  return effectiveS >= thresh.S || effectiveA >= thresh.A || effectiveB >= thresh.B;
}
