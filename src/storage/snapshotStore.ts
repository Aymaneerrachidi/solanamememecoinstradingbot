import type { DB } from "./db.js";
import type { RawKol } from "../scraper/classify.js";
import type { Timeframe } from "../scraper/kolScraper.js";

export interface Snapshot {
  wallet: string;
  name: string;
  pnl: number;
  winRate: number;
  rank: number;
  day: number;
  timeframe: Timeframe;
}

export const epochDay = (ts: number): number => Math.floor(ts / 86_400_000);

// Stores one snapshot row per wallet+timeframe for the given day. Re-running on the same
// (day, timeframe) overwrites that snapshot.
export function recordSnapshot(
  db: DB,
  ordered: RawKol[],
  day: number,
  timeframe: Timeframe = "daily"
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO kol_snapshots (wallet, name, pnl, winRate, rank, day, timeframe)
     VALUES (@wallet, @name, @pnl, @winRate, @rank, @day, @timeframe)`
  );
  const tx = db.transaction((rows: RawKol[]) => {
    rows.forEach((r, i) =>
      insert.run({
        wallet: r.wallet,
        name: r.name,
        pnl: r.pnl,
        winRate: r.winRate,
        rank: i + 1,
        day,
        timeframe,
      })
    );
  });
  tx(ordered);
}

export function getSnapshotsSince(db: DB, sinceDay: number, timeframe?: Timeframe): Snapshot[] {
  if (timeframe) {
    return db
      .prepare("SELECT * FROM kol_snapshots WHERE day >= ? AND timeframe = ? ORDER BY day ASC")
      .all(sinceDay, timeframe) as Snapshot[];
  }
  return db
    .prepare("SELECT * FROM kol_snapshots WHERE day >= ? ORDER BY day ASC")
    .all(sinceDay) as Snapshot[];
}

// Most-recent snapshot per wallet for a given timeframe. Used to compute KOL quality.
export function getLatestSnapshotsByTimeframe(
  db: DB,
  timeframe: Timeframe,
  sinceDay: number
): Snapshot[] {
  return db
    .prepare(
      `SELECT s.* FROM kol_snapshots s
       JOIN (
         SELECT wallet, MAX(day) AS maxDay FROM kol_snapshots
         WHERE timeframe = ? AND day >= ?
         GROUP BY wallet
       ) m ON s.wallet = m.wallet AND s.day = m.maxDay AND s.timeframe = ?`
    )
    .all(timeframe, sinceDay, timeframe) as Snapshot[];
}

export function pruneSnapshots(db: DB, keepDay: number): void {
  db.prepare("DELETE FROM kol_snapshots WHERE day < ?").run(keepDay);
}
