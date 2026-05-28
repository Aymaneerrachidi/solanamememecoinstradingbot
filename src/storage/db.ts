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
  `);
  return db;
}
