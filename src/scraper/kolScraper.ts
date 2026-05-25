import { readFile } from "node:fs/promises";
import { retry } from "../util/retry.js";
import { logger } from "../logger.js";
import { classifyAll, type RawKol, type TierCutoffs } from "./classify.js";
import type { KolRecord } from "../types.js";

export interface LoadKolsArgs {
  fetchRaw: () => Promise<RawKol[]>;
  cutoffs: TierCutoffs;
  now: number;
  previous?: KolRecord[];
}

export async function loadKols(args: LoadKolsArgs): Promise<KolRecord[]> {
  try {
    const raw = await args.fetchRaw();
    if (raw.length === 0) throw new Error("empty KOL list");
    return classifyAll(raw, args.cutoffs, args.now);
  } catch (err) {
    logger.warn("KOL fetch failed; keeping previous list", err);
    return args.previous ?? [];
  }
}

// Source: a manual JSON file of RawKol objects.
export function manualFetcher(path: string): () => Promise<RawKol[]> {
  return async () => {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as RawKol[];
  };
}

// Source: kolscan.io leaderboard. VERIFY the endpoint + field mapping in devtools.
export function kolscanFetcher(): () => Promise<RawKol[]> {
  return async () => {
    const url = "https://api.kolscan.io/leaderboard";
    const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 500 });
    if (!res.ok) throw new Error(`kolscan ${res.status}`);
    const json = (await res.json()) as {
      wallet: string; name?: string; pnl?: number; winRate?: number;
    }[];
    return json.map((k) => ({
      wallet: k.wallet,
      name: k.name ?? k.wallet.slice(0, 6),
      pnl: k.pnl ?? 0,
      winRate: k.winRate ?? 0,
    }));
  };
}
