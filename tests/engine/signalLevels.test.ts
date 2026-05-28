import { describe, it, expect } from "vitest";
import { detectSignalLevel, type SignalLevel } from "../../src/engine/signalLevels.js";

const levels: SignalLevel[] = [
  { level: 1, label: "🟢 GOOD", minWeight: 0.8, windowMin: 15 },
  { level: 2, label: "🔵 STRONG", minWeight: 1.5, windowMin: 15 },
  { level: 3, label: "🟠 VERY STRONG", minWeight: 1.5, windowMin: 5 },
  { level: 4, label: "🔴 EXTREME", minWeight: 2.5, windowMin: 15 },
];

// Helper: fixed weight values per window.
const weight = (per: Record<number, number>) => (w: number) => per[w] ?? 0;

describe("detectSignalLevel (weighted)", () => {
  it("returns null when nothing qualifies", () => {
    expect(detectSignalLevel(levels, weight({ 5: 0.4, 15: 0.5 }))).toBeNull();
  });

  it("fires GOOD when summed weight crosses 0.8 in 15 min", () => {
    expect(detectSignalLevel(levels, weight({ 5: 0.4, 15: 1.0 }))?.label).toBe("🟢 GOOD");
  });

  it("fires STRONG when weight 1.5 in 15 min", () => {
    expect(detectSignalLevel(levels, weight({ 5: 1.0, 15: 1.6 }))?.label).toBe("🔵 STRONG");
  });

  it("upgrades to VERY STRONG when the 1.5 weight landed within 5 min", () => {
    expect(detectSignalLevel(levels, weight({ 5: 1.6, 15: 1.6 }))?.label).toBe("🟠 VERY STRONG");
  });

  it("fires EXTREME for combined weight 2.5+ in 15 min", () => {
    expect(detectSignalLevel(levels, weight({ 5: 1.6, 15: 2.7 }))?.label).toBe("🔴 EXTREME");
  });

  it("always returns the strongest matching level", () => {
    expect(detectSignalLevel(levels, weight({ 5: 3.0, 15: 3.5 }))?.level).toBe(4);
  });
});
