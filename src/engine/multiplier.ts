// Given a coin's current vs baseline market cap, returns the highest x-milestone newly
// reached (greater than the last one alerted), or null. Milestones e.g. [2,5,10,25,50,100].
export function detectMultiplierMilestone(
  currentMcUsd: number,
  baselineMcUsd: number,
  lastMilestone: number,
  milestones: number[]
): number | null {
  if (baselineMcUsd <= 0 || currentMcUsd <= 0) return null;
  const mult = currentMcUsd / baselineMcUsd;
  let hit: number | null = null;
  for (const m of milestones) {
    if (mult >= m && m > lastMilestone && (hit === null || m > hit)) hit = m;
  }
  return hit;
}
