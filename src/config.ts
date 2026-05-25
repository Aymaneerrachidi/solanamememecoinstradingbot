function num(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === "" ? def : Number(v);
}

function str(name: string, def = ""): string {
  return process.env[name] ?? def;
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
  monitorIntervalSec: num("MONITOR_INTERVAL_SEC", 8),
  scrapeIntervalHours: num("SCRAPE_INTERVAL_HOURS", 24),
  safety: {
    minLiquidityUsd: num("MIN_LIQUIDITY_USD", 10000),
    maxTop10Pct: num("MAX_TOP10_HOLDER_PCT", 30),
    minVolume24hUsd: num("MIN_VOLUME_24H_USD", 20000),
    minAgeMinutes: num("MIN_AGE_MINUTES", 5),
    maxAgeMinutes: num("MAX_AGE_MINUTES", 4320),
    minHolders: num("MIN_HOLDERS", 100),
  },
};

export type Config = typeof config;
