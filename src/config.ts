import type { Tier } from "./types.js";

function num(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === "" ? def : Number(v);
}

function str(name: string, def = ""): string {
  return process.env[name] ?? def;
}

// Parse a comma-separated number list, falling back to a default.
function numList(name: string, def: number[]): number[] {
  const v = str(name);
  if (!v) return def;
  const parsed = v.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n) && n > 0);
  return parsed.length ? parsed.sort((a, b) => a - b) : def;
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
  // After a coin fires a signal, track it and ping when its market cap hits these multiples
  // of the market cap at flag time. Stops tracking after `multiplierTrackDays`.
  multiplierMilestones: numList("MULTIPLIER_MILESTONES", [2, 5, 10, 25, 50, 100]),
  multiplierTrackDays: num("MULTIPLIER_TRACK_DAYS", 7),
  // Exit alert: distinct KOLs that must have sold a signaled coin before we ping.
  exitSellerThreshold: num("EXIT_SELLER_THRESHOLD", 2),
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
  // KOL list is built from accumulated daily snapshots over this window (weekly+monthly
  // consistency), capped to the strongest `maxKols` to bound monitoring load.
  kolHistoryDays: num("KOL_HISTORY_DAYS", 30),
  maxKols: num("MAX_KOLS", 75),
  monitorIntervalSec: num("MONITOR_INTERVAL_SEC", 8),
  // Gap between RPC requests to stay under the free-tier rate limit. Raise if you see 429s.
  monitorRequestGapMs: num("MONITOR_REQUEST_GAP_MS", 200),
  // Only notify for buys seen within this many minutes (shows recent activity on launch).
  buyLookbackMin: num("BUY_LOOKBACK_MIN", 10),
  scrapeIntervalHours: num("SCRAPE_INTERVAL_HOURS", 24),
  safety: {
    minMarketCapUsd: num("MIN_MARKET_CAP_USD", 10000),
    maxMarketCapUsd: num("MAX_MARKET_CAP_USD", 0), // 0 = no upper cap
  },
};

export type Config = typeof config;
