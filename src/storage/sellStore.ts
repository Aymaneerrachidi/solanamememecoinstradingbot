import type { DB } from "./db.js";
import type { SellEvent } from "../types.js";

// Returns false if the signature was already recorded.
export function recordSell(db: DB, sell: SellEvent): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO kol_sells (signature, kolWallet, tokenMint, ts)
       VALUES (@signature, @kolWallet, @tokenMint, @ts)`
    )
    .run(sell);
  return res.changes > 0;
}

export function countDistinctSellersForToken(db: DB, tokenMint: string): number {
  const row = db
    .prepare("SELECT COUNT(DISTINCT kolWallet) AS c FROM kol_sells WHERE tokenMint = ?")
    .get(tokenMint) as { c: number };
  return row.c;
}

export function getDistinctSellerWallets(db: DB, tokenMint: string): string[] {
  const rows = db
    .prepare("SELECT DISTINCT kolWallet FROM kol_sells WHERE tokenMint = ?")
    .all(tokenMint) as { kolWallet: string }[];
  return rows.map((r) => r.kolWallet);
}

// Exit-alert dedup (per token + seller-count threshold).
export function alreadyExitAlerted(db: DB, key: string): boolean {
  return !!db.prepare("SELECT 1 FROM exit_alerts WHERE key = ?").get(key);
}

export function recordExitAlert(db: DB, key: string, ts: number): void {
  db.prepare("INSERT OR IGNORE INTO exit_alerts (key, ts) VALUES (?, ?)").run(key, ts);
}
