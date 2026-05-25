import { retry } from "../util/retry.js";

export interface DexData {
  liquidityUsd: number;
  volume24hUsd: number;
  ageMinutes: number;
  found: boolean;
}

interface DexPair {
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number; // unix ms
}

export async function fetchDexData(tokenMint: string, now = Date.now()): Promise<DexData> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
  const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 300 });
  const json = (await res.json()) as { pairs?: DexPair[] };
  const pairs = json.pairs ?? [];
  if (pairs.length === 0) return { liquidityUsd: 0, volume24hUsd: 0, ageMinutes: 0, found: false };

  // Use the most liquid pair.
  const best = pairs.reduce((a, b) =>
    (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a
  );
  const ageMinutes = best.pairCreatedAt ? (now - best.pairCreatedAt) / 60000 : 0;
  return {
    liquidityUsd: best.liquidity?.usd ?? 0,
    volume24hUsd: best.volume?.h24 ?? 0,
    ageMinutes,
    found: true,
  };
}
