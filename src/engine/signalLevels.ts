export interface SignalLevel {
  level: number; // higher = stronger; used for ordering and dedup
  label: string; // e.g. "🟢 GOOD"
  minKols: number; // distinct KOLs required
  windowMin: number; // within this many minutes
}

// Returns the strongest level whose threshold (>= minKols distinct KOLs within windowMin) is
// satisfied, or null if none. `distinctWithin(windowMin)` yields the distinct KOL count for
// buys of the token within the last `windowMin` minutes.
export function detectSignalLevel(
  levels: SignalLevel[],
  distinctWithin: (windowMin: number) => number
): SignalLevel | null {
  let best: SignalLevel | null = null;
  for (const lv of levels) {
    if (distinctWithin(lv.windowMin) >= lv.minKols) {
      if (!best || lv.level > best.level) best = lv;
    }
  }
  return best;
}
