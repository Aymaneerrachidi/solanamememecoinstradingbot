import Database from "better-sqlite3";

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kols (
      wallet TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pnl REAL NOT NULL,
      winRate REAL NOT NULL,
      rank INTEGER NOT NULL,
      tier TEXT NOT NULL,
      appearances INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buys (
      signature TEXT PRIMARY KEY,
      kolWallet TEXT NOT NULL,
      tier TEXT NOT NULL,
      tokenMint TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_buys_token_ts ON buys (tokenMint, ts);
    CREATE TABLE IF NOT EXISTS alerts (
      tokenMint TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kol_snapshots (
      wallet TEXT NOT NULL,
      name TEXT NOT NULL,
      pnl REAL NOT NULL,
      winRate REAL NOT NULL,
      rank INTEGER NOT NULL,
      day INTEGER NOT NULL,
      PRIMARY KEY (wallet, day)
    );
    CREATE INDEX IF NOT EXISTS idx_snap_day ON kol_snapshots (day);
    CREATE TABLE IF NOT EXISTS tracked_tokens (
      tokenMint TEXT PRIMARY KEY,
      symbol TEXT,
      name TEXT,
      baselineMcUsd REAL NOT NULL,
      baselineTs INTEGER NOT NULL,
      lastMilestone REAL NOT NULL DEFAULT 0,
      peakMult REAL NOT NULL DEFAULT 1
    );
    -- Structured outcomes per fired signal: baseline + peak + rug + marker snapshots.
    CREATE TABLE IF NOT EXISTS signal_outcomes (
      signalKey TEXT PRIMARY KEY,        -- "mint#level"
      tokenMint TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      signalTs INTEGER NOT NULL,
      signalLevel INTEGER NOT NULL,
      signalLabel TEXT NOT NULL,
      kolCount INTEGER NOT NULL,
      baselineMcUsd REAL NOT NULL,
      baselineLiqUsd REAL,
      baselinePriceUsd REAL,
      peakMcUsd REAL NOT NULL,
      peakMcTs INTEGER NOT NULL,
      ruggedAt INTEGER,                  -- nullable: ts when rug detected
      mc5m REAL, liq5m REAL, mult5m REAL, fetched5m INTEGER NOT NULL DEFAULT 0,
      mc15m REAL, liq15m REAL, mult15m REAL, fetched15m INTEGER NOT NULL DEFAULT 0,
      mc1h REAL, liq1h REAL, mult1h REAL, fetched1h INTEGER NOT NULL DEFAULT 0,
      mc6h REAL, liq6h REAL, mult6h REAL, fetched6h INTEGER NOT NULL DEFAULT 0,
      mc24h REAL, liq24h REAL, mult24h REAL, fetched24h INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_outcomes_token ON signal_outcomes (tokenMint);
    -- KOL sells of tokens we're tracking (used for exit alerts + post-mortem analysis).
    CREATE TABLE IF NOT EXISTS kol_sells (
      signature TEXT PRIMARY KEY,
      kolWallet TEXT NOT NULL,
      tokenMint TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sells_token_ts ON kol_sells (tokenMint, ts);
    -- Dedup: which (tokenMint, sellerCount) exit alerts we've already sent.
    CREATE TABLE IF NOT EXISTS exit_alerts (
      key TEXT PRIMARY KEY,              -- "mint#sellerCount"
      ts INTEGER NOT NULL
    );
  `);

  // Migration: add `appearances` to kols tables created before that column existed.
  const kolCols = db.prepare("PRAGMA table_info(kols)").all() as { name: string }[];
  if (!kolCols.some((c) => c.name === "appearances")) {
    db.exec("ALTER TABLE kols ADD COLUMN appearances INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}
