import type { Tier } from "./types.js";

function num(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === "" ? def : Number(v);
}

function str(name: string, def = ""): string {
  return process.env[name] ?? def;
}

// Parse a comma-separated tier list (e.g. "S,A") into a Set. Empty = no tiers.
function tierSet(name: string): Set<Tier> {
  const s = new Set<Tier>();
  for (const part of str(name).split(",").map((x) => x.trim().toUpperCase())) {
    if (part === "S" || part === "A" || part === "B") s.add(part);
  }
  return s;
}

export const config = {
  heliusApiKey: str("HELIUS_API_KEY"),
  rpcUrl: str("SOLANA_RPC_URL"),
  telegramBotToken: str("TELEGRAM_BOT_TOKEN"),
  telegramChatId: str("TELEGRAM_CHAT_ID"),
  kolManualListPath: str("KOL_MANUAL_LIST_PATH"),
  tiers: {
    sRankMax: num("TIER_S_RANK_MAX", 10),
    aRankMax: num("TIER_A_RANK_MAX", 30),
  },
  confluence: {
    S: num("CONFLUENCE_S", 1),
    A: num("CONFLUENCE_A", 2),
    B: num("CONFLUENCE_B", 3),
    windowMin: num("CONFLUENCE_WINDOW_MIN", 30),
  },
  // Signal ladder: a token fires the STRONGEST level it qualifies for (distinct KOLs within
  // the window). Each level alerts once per token, so a coin can re-alert as it climbs.
  // Edit freely — order doesn't matter, `level` decides strength.
  signalLevels: [
    { level: 1, label: "🟢 GOOD", minKols: 2, windowMin: 5 },
    { level: 2, label: "🔵 STRONG", minKols: 4, windowMin: 15 },
    { level: 3, label: "🟠 VERY STRONG", minKols: 4, windowMin: 5 },
    { level: 4, label: "🔴 EXTREME", minKols: 6, windowMin: 15 },
  ],
  // Which tiers send a message on EVERY individual buy. Blank = off (only ladder signals).
  // e.g. "S" = ping only on top-tier whale buys; "S,A,B" = every buy.
  individualBuyTiers: tierSet("INDIVIDUAL_BUY_TIERS"),
  monitorIntervalSec: num("MONITOR_INTERVAL_SEC", 8),
  // Gap between per-wallet Helius requests to stay under the free-tier rate limit.
  monitorRequestGapMs: num("MONITOR_REQUEST_GAP_MS", 150),
  // Only notify for buys seen within this many minutes (shows recent activity on launch).
  buyLookbackMin: num("BUY_LOOKBACK_MIN", 10),
  scrapeIntervalHours: num("SCRAPE_INTERVAL_HOURS", 24),
  safety: {
    minMarketCapUsd: num("MIN_MARKET_CAP_USD", 10000),
    maxMarketCapUsd: num("MAX_MARKET_CAP_USD", 0), // 0 = no upper cap
  },
};

export type Config = typeof config;
