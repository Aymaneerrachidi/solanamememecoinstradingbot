import type { DB } from "./db.js";

export const MARKERS = [
  { key: "5m", offsetMs: 5 * 60_000 },
  { key: "15m", offsetMs: 15 * 60_000 },
  { key: "1h", offsetMs: 60 * 60_000 },
  { key: "6h", offsetMs: 6 * 60 * 60_000 },
  { key: "24h", offsetMs: 24 * 60 * 60_000 },
] as const;

export type MarkerKey = (typeof MARKERS)[number]["key"];

export interface SignalOutcome {
  signalKey: string;
  tokenMint: string;
  symbol: string | null;
  name: string | null;
  signalTs: number;
  signalLevel: number;
  signalLabel: string;
  kolCount: number;
  baselineMcUsd: number;
  baselineLiqUsd: number | null;
  baselinePriceUsd: number | null;
  peakMcUsd: number;
  peakMcTs: number;
  ruggedAt: number | null;
  // Marker columns are accessed by composed name (e.g. mc5m, fetched24h).
  [key: string]: unknown;
}

export interface RecordOutcomeArgs {
  signalKey: string;
  tokenMint: string;
  symbol?: string;
  name?: string;
  signalTs: number;
  signalLevel: number;
  signalLabel: string;
  kolCount: number;
  baselineMcUsd: number;
  baselineLiqUsd?: number;
  baselinePriceUsd?: number;
}

export function recordSignalOutcome(db: DB, a: RecordOutcomeArgs): void {
  db.prepare(
    `INSERT OR IGNORE INTO signal_outcomes (
       signalKey, tokenMint, symbol, name, signalTs, signalLevel, signalLabel, kolCount,
       baselineMcUsd, baselineLiqUsd, baselinePriceUsd, peakMcUsd, peakMcTs
     ) VALUES (
       @signalKey, @tokenMint, @symbol, @name, @signalTs, @signalLevel, @signalLabel, @kolCount,
       @baselineMcUsd, @baselineLiqUsd, @baselinePriceUsd, @baselineMcUsd, @signalTs
     )`
  ).run({
    signalKey: a.signalKey,
    tokenMint: a.tokenMint,
    symbol: a.symbol ?? null,
    name: a.name ?? null,
    signalTs: a.signalTs,
    signalLevel: a.signalLevel,
    signalLabel: a.signalLabel,
    kolCount: a.kolCount,
    baselineMcUsd: a.baselineMcUsd,
    baselineLiqUsd: a.baselineLiqUsd ?? null,
    baselinePriceUsd: a.baselinePriceUsd ?? null,
  });
}

// Outcomes that still have at least one unfilled marker AND aren't beyond the last marker.
export function getActiveOutcomes(db: DB, now: number): SignalOutcome[] {
  const cutoff = now - 25 * 60 * 60_000; // keep ~1h of grace after the 24h marker
  return db
    .prepare(
      `SELECT * FROM signal_outcomes
       WHERE signalTs >= ?
         AND (fetched5m = 0 OR fetched15m = 0 OR fetched1h = 0 OR fetched6h = 0 OR fetched24h = 0)`
    )
    .all(cutoff) as SignalOutcome[];
}

export function updateOutcomePeak(db: DB, signalKey: string, peakMcUsd: number, peakMcTs: number): void {
  db.prepare("UPDATE signal_outcomes SET peakMcUsd = ?, peakMcTs = ? WHERE signalKey = ?").run(
    peakMcUsd,
    peakMcTs,
    signalKey
  );
}

export function markRugged(db: DB, signalKey: string, ts: number): void {
  db.prepare("UPDATE signal_outcomes SET ruggedAt = COALESCE(ruggedAt, ?) WHERE signalKey = ?").run(ts, signalKey);
}

export function recordMarker(
  db: DB,
  signalKey: string,
  marker: MarkerKey,
  mcUsd: number,
  liqUsd: number,
  mult: number
): void {
  const mc = `mc${marker}`;
  const liq = `liq${marker}`;
  const m = `mult${marker}`;
  const fetched = `fetched${marker}`;
  db.prepare(
    `UPDATE signal_outcomes SET ${mc} = ?, ${liq} = ?, ${m} = ?, ${fetched} = 1 WHERE signalKey = ?`
  ).run(mcUsd, liqUsd, mult, signalKey);
}
