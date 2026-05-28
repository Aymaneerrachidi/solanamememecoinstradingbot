import type { DB } from "./db.js";
import type { KolRecord } from "../types.js";

export function replaceKols(db: DB, kols: KolRecord[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO kols (wallet, name, pnl, winRate, rank, tier, appearances, qualityScore, updatedAt)
     VALUES (@wallet, @name, @pnl, @winRate, @rank, @tier, @appearances, @qualityScore, @updatedAt)`
  );
  const tx = db.transaction((rows: KolRecord[]) => {
    db.prepare("DELETE FROM kols").run();
    for (const r of rows) insert.run(r);
  });
  tx(kols);
}

export function getAllKols(db: DB): KolRecord[] {
  return db.prepare("SELECT * FROM kols").all() as KolRecord[];
}

export function getKol(db: DB, wallet: string): KolRecord | undefined {
  return db.prepare("SELECT * FROM kols WHERE wallet = ?").get(wallet) as KolRecord | undefined;
}
