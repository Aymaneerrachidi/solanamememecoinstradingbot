import type { DB } from "./db.js";
import type { RawKol } from "../scraper/classify.js";

export interface Snapshot {
  wallet: string;
  name: string;
  pnl: number;
  winRate: number;
  rank: number; // 1-based position in that day's leaderboard
  day: number; // epoch day (UTC)
}

export const epochDay = (ts: number): number => Math.floor(ts / 86_400_000);

// Stores one snapshot row per wallet for the given day (leaderboard order = rank).
// Re-running on the same day overwrites that day's snapshot.
export function recordSnapshot(db: DB, ordered: RawKol[], day: number): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO kol_snapshots (wallet, name, pnl, winRate, rank, day)
     VALUES (@wallet, @name, @pnl, @winRate, @rank, @day)`
  );
  const tx = db.transaction((rows: RawKol[]) => {
    rows.forEach((r, i) =>
      insert.run({ wallet: r.wallet, name: r.name, pnl: r.pnl, winRate: r.winRate, rank: i + 1, day })
    );
  });
  tx(ordered);
}

export function getSnapshotsSince(db: DB, sinceDay: number): Snapshot[] {
  return db
    .prepare("SELECT * FROM kol_snapshots WHERE day >= ? ORDER BY day ASC")
    .all(sinceDay) as Snapshot[];
}

// Drops snapshots older than `keepDay` to keep the table bounded.
export function pruneSnapshots(db: DB, keepDay: number): void {
  db.prepare("DELETE FROM kol_snapshots WHERE day < ?").run(keepDay);
}
