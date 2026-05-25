import type { DB } from "./db.js";

export function alreadyAlerted(db: DB, tokenMint: string): boolean {
  return !!db.prepare("SELECT 1 FROM alerts WHERE tokenMint = ?").get(tokenMint);
}

export function recordAlert(db: DB, tokenMint: string, ts: number): void {
  db.prepare("INSERT OR IGNORE INTO alerts (tokenMint, ts) VALUES (?, ?)").run(tokenMint, ts);
}
