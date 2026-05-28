import type { DB } from "./db.js";

export interface TrackedToken {
  tokenMint: string;
  symbol: string | null;
  name: string | null;
  baselineMcUsd: number;
  baselineTs: number;
  lastMilestone: number; // highest x-milestone already alerted (0 = none)
  peakMult: number; // highest multiple seen so far
}

// Starts tracking a token at its current market cap. No-op if already tracked
// (the first signal sets the baseline we measure multiples against).
export function trackToken(
  db: DB,
  t: { tokenMint: string; symbol?: string; name?: string; baselineMcUsd: number; ts: number }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO tracked_tokens (tokenMint, symbol, name, baselineMcUsd, baselineTs, lastMilestone, peakMult)
     VALUES (@tokenMint, @symbol, @name, @baselineMcUsd, @ts, 0, 1)`
  ).run({
    tokenMint: t.tokenMint,
    symbol: t.symbol ?? null,
    name: t.name ?? null,
    baselineMcUsd: t.baselineMcUsd,
    ts: t.ts,
  });
}

export function getTrackedTokens(db: DB): TrackedToken[] {
  return db.prepare("SELECT * FROM tracked_tokens").all() as TrackedToken[];
}

export function updateTrackProgress(db: DB, tokenMint: string, lastMilestone: number, peakMult: number): void {
  db.prepare("UPDATE tracked_tokens SET lastMilestone = ?, peakMult = ? WHERE tokenMint = ?").run(
    lastMilestone,
    peakMult,
    tokenMint
  );
}

export function untrackToken(db: DB, tokenMint: string): void {
  db.prepare("DELETE FROM tracked_tokens WHERE tokenMint = ?").run(tokenMint);
}
