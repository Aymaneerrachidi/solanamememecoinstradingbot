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

// Each leaderboard row is an /account/<wallet> link whose anchor ends with the display
// name, followed by buy/sell trade counts and a signed SOL profit figure.
const ROW_RE =
  /\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})\?timeframe=1"[\s\S]*?font-weight:550">([^<]+)<\/h1><\/a>[\s\S]*?buy-color\)[^>]*>(\d+)<\/p>\/<p[^>]*sell-color\)[^>]*>(\d+)<\/p>[\s\S]*?totalProfitNum__[^>]*>[\s\S]*?<h1>([+-]?[\d,.]+)<!-- --> Sol<\/h1>/g;

export function parseKolscanHtml(html: string): RawKol[] {
  const kols: RawKol[] = [];
  const re = new RegExp(ROW_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, wallet, name, buys, sells] = m;
    const wins = Number(buys);
    const losses = Number(sells);
    kols.push({
      wallet,
      name: name.trim(),
      pnl: Number(m[5].replace(/,/g, "")),
      winRate: wins + losses > 0 ? +(wins / (wins + losses)).toFixed(3) : 0,
    });
  }
  return kols;
}

// Source: kolscan.io leaderboard (server-rendered HTML; parsed by row).
export function kolscanFetcher(): () => Promise<RawKol[]> {
  return async () => {
    const url = "https://kolscan.io/leaderboard";
    const res = await retry(() => fetch(url, { headers: { "user-agent": "Mozilla/5.0" } }), {
      attempts: 3,
      baseDelayMs: 500,
    });
    if (!res.ok) throw new Error(`kolscan ${res.status}`);
    const kols = parseKolscanHtml(await res.text());
    if (kols.length === 0) throw new Error("kolscan: parsed 0 KOLs (page structure may have changed)");
    return kols;
  };
}
