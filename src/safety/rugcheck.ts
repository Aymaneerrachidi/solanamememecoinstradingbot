import { retry } from "../util/retry.js";

export interface RugData {
  lpBurnedOrLocked: boolean;
  found: boolean;
}

interface RugReport {
  markets?: { lp?: { lpLockedPct?: number } }[];
}

// RugCheck public report. lpLockedPct >= 90 treated as burned/locked.
export async function fetchRugData(tokenMint: string): Promise<RugData> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`;
  try {
    const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 300 });
    if (!res.ok) return { lpBurnedOrLocked: false, found: false };
    const json = (await res.json()) as RugReport;
    const lockedPct = json.markets?.[0]?.lp?.lpLockedPct ?? 0;
    return { lpBurnedOrLocked: lockedPct >= 90, found: true };
  } catch {
    return { lpBurnedOrLocked: false, found: false };
  }
}
