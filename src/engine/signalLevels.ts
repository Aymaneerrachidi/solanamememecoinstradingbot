export interface SignalLevel {
  level: number; // higher = stronger; used for ordering and dedup
  label: string; // e.g. "🟢 GOOD"
  minWeight: number; // sum of distinct KOL quality scores needed
  windowMin: number; // within this many minutes
}

// Returns the strongest level whose threshold (>= minWeight summed quality within windowMin)
// is satisfied, or null. `totalWeightWithin(windowMin)` returns the sum of distinct KOL
// quality scores for buys of the token within the last `windowMin` minutes.
export function detectSignalLevel(
  levels: SignalLevel[],
  totalWeightWithin: (windowMin: number) => number
): SignalLevel | null {
  let best: SignalLevel | null = null;
  for (const lv of levels) {
    if (totalWeightWithin(lv.windowMin) >= lv.minWeight) {
      if (!best || lv.level > best.level) best = lv;
    }
  }
  return best;
}
