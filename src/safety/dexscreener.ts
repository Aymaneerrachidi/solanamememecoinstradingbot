import { retry } from "../util/retry.js";
import { recordFailure } from "../health/health.js";

export interface DexData {
  liquidityUsd: number;
  volume24hUsd: number;
  ageMinutes: number;
  found: boolean;
  // Display fields (best-effort; absent for tokens not yet indexed).
  name?: string;
  symbol?: string;
  priceUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  priceChangeM5?: number;
  priceChangeH1?: number;
  priceChangeH6?: number;
  priceChangeH24?: number;
  txns24Buys?: number;
  txns24Sells?: number;
  dexId?: string;
}

interface DexPair {
  baseToken?: { name?: string; symbol?: string };
  dexId?: string;
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number; // unix ms
}

export async function fetchDexData(tokenMint: string, now = Date.now()): Promise<DexData> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
  let res: Response;
  try {
    res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 300 });
  } catch (err) {
    recordFailure("dexscreener");
    throw err;
  }
  const json = (await res.json()) as { pairs?: DexPair[] };
  const pairs = json.pairs ?? [];
  if (pairs.length === 0) {
    return { liquidityUsd: 0, volume24hUsd: 0, ageMinutes: 0, found: false };
  }

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
    name: best.baseToken?.name,
    symbol: best.baseToken?.symbol,
    priceUsd: best.priceUsd ? Number(best.priceUsd) : undefined,
    marketCapUsd: best.marketCap ?? best.fdv,
    fdvUsd: best.fdv,
    priceChangeM5: best.priceChange?.m5,
    priceChangeH1: best.priceChange?.h1,
    priceChangeH6: best.priceChange?.h6,
    priceChangeH24: best.priceChange?.h24,
    txns24Buys: best.txns?.h24?.buys,
    txns24Sells: best.txns?.h24?.sells,
    dexId: best.dexId,
  };
}
