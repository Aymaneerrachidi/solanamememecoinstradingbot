import { readFile } from "node:fs/promises";
import { retry } from "../util/retry.js";
import type { RawKol } from "./classify.js";

// Source: a manual JSON file of RawKol objects.
export function manualFetcher(path: string): () => Promise<RawKol[]> {
  return async () => {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as RawKol[];
  };
}

// kolscan embeds all THREE timeframes (daily/weekly/monthly) in the same HTML payload.
// Each row's account link carries `timeframe=1` (daily), `timeframe=7` (weekly), or
// `timeframe=30` (monthly), and the row's PnL/win-rate values differ per timeframe.
export type Timeframe = "daily" | "weekly" | "monthly";

const TIMEFRAME_PARAM: Record<Timeframe, string> = {
  daily: "1",
  weekly: "7",
  monthly: "30",
};

// kolscan embeds the full leaderboard payload as JSON objects inside an RSC chunk:
//   {"wallet_address":"...","name":"...","telegram":...,"twitter":"...","profit":N,"wins":N,"losses":N,"timeframe":N}
// Quotes are JS-escaped (\"). All three timeframes (1=daily, 7=weekly, 30=monthly) appear
// in the same payload — we filter by the `timeframe` field.
const KOL_JSON_RE =
  /\\"wallet_address\\":\\"([1-9A-HJ-NP-Za-km-z]{32,44})\\"[^}]*?\\"name\\":\\"([^"\\]+)\\"[^}]*?\\"profit\\":([+-]?[\d.]+)[^}]*?\\"wins\\":(\d+)[^}]*?\\"losses\\":(\d+)[^}]*?\\"timeframe\\":(\d+)/g;

export function parseKolscanHtml(html: string, timeframe: Timeframe = "daily"): RawKol[] {
  const tfNum = TIMEFRAME_PARAM[timeframe];
  const kols: RawKol[] = [];
  const re = new RegExp(KOL_JSON_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, wallet, name, profit, winsStr, lossesStr, tf] = m;
    if (tf !== tfNum) continue;
    const wins = Number(winsStr);
    const losses = Number(lossesStr);
    kols.push({
      wallet,
      name: name.trim(),
      pnl: Number(profit),
      winRate: wins + losses > 0 ? +(wins / (wins + losses)).toFixed(3) : 0,
    });
  }
  // Order by pnl descending (rank 1 = highest profit) so snapshot rank reflects leaderboard rank.
  return kols.sort((a, b) => b.pnl - a.pnl);
}

export interface KolscanBoards {
  daily: RawKol[];
  weekly: RawKol[];
  monthly: RawKol[];
}

// One HTTP fetch, three datasets — they're all baked into kolscan's SSR payload.
export async function fetchKolscanBoards(): Promise<KolscanBoards> {
  const url = "https://kolscan.io/leaderboard";
  const res = await retry(() => fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }), {
    attempts: 3,
    baseDelayMs: 500,
  });
  if (!res.ok) throw new Error(`kolscan ${res.status}`);
  const html = await res.text();
  const daily = parseKolscanHtml(html, "daily");
  const weekly = parseKolscanHtml(html, "weekly");
  const monthly = parseKolscanHtml(html, "monthly");
  if (daily.length === 0 && weekly.length === 0 && monthly.length === 0) {
    throw new Error("kolscan: parsed 0 KOLs across all timeframes (page structure may have changed)");
  }
  return { daily, weekly, monthly };
}

// Back-compat: the manual-list path still returns a flat RawKol[].
export function kolscanFetcher(): () => Promise<RawKol[]> {
  return async () => {
    const boards = await fetchKolscanBoards();
    if (boards.daily.length === 0) throw new Error("kolscan: parsed 0 daily KOLs");
    return boards.daily;
  };
}
