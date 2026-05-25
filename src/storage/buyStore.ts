import type { DB } from "./db.js";
import type { BuyEvent } from "../types.js";

// Returns false if the signature was already recorded (duplicate).
export function recordBuy(db: DB, buy: BuyEvent): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO buys (signature, kolWallet, tier, tokenMint, ts)
       VALUES (@signature, @kolWallet, @tier, @tokenMint, @ts)`
    )
    .run(buy);
  return res.changes > 0;
}

export function getBuysForTokenSince(db: DB, tokenMint: string, sinceTs: number): BuyEvent[] {
  return db
    .prepare("SELECT * FROM buys WHERE tokenMint = ? AND ts >= ? ORDER BY ts ASC")
    .all(tokenMint, sinceTs) as BuyEvent[];
}

// How many buys this wallet has recorded for this token (used to notify only on the first).
export function countBuysByWalletToken(db: DB, kolWallet: string, tokenMint: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM buys WHERE kolWallet = ? AND tokenMint = ?")
    .get(kolWallet, tokenMint) as { c: number };
  return row.c;
}
