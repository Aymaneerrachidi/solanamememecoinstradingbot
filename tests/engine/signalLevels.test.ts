import { describe, it, expect } from "vitest";
import { detectSignalLevel, type SignalLevel } from "../../src/engine/signalLevels.js";

const levels: SignalLevel[] = [
  { level: 1, label: "🟢 GOOD", minKols: 2, windowMin: 5 },
  { level: 2, label: "🔵 STRONG", minKols: 4, windowMin: 15 },
  { level: 3, label: "🟠 VERY STRONG", minKols: 4, windowMin: 5 },
  { level: 4, label: "🔴 EXTREME", minKols: 6, windowMin: 15 },
];

// Helper: fixed distinct counts per window.
const within = (counts: Record<number, number>) => (w: number) => counts[w] ?? 0;

describe("detectSignalLevel", () => {
  it("returns null when nothing qualifies", () => {
    expect(detectSignalLevel(levels, within({ 5: 1, 15: 1 }))).toBeNull();
  });

  it("fires GOOD for 2 KOLs in 5 min", () => {
    expect(detectSignalLevel(levels, within({ 5: 2, 15: 2 }))?.label).toBe("🟢 GOOD");
  });

  it("fires STRONG for 4 KOLs in 15 min (but not 5 min)", () => {
    expect(detectSignalLevel(levels, within({ 5: 2, 15: 4 }))?.label).toBe("🔵 STRONG");
  });

  it("upgrades to VERY STRONG when the 4 KOLs landed within 5 min", () => {
    expect(detectSignalLevel(levels, within({ 5: 4, 15: 4 }))?.label).toBe("🟠 VERY STRONG");
  });

  it("fires EXTREME for 6 KOLs in 15 min", () => {
    expect(detectSignalLevel(levels, within({ 5: 4, 15: 6 }))?.label).toBe("🔴 EXTREME");
  });

  it("always returns the strongest matching level", () => {
    // qualifies for GOOD, STRONG, VERY STRONG, and EXTREME — must pick EXTREME.
    expect(detectSignalLevel(levels, within({ 5: 6, 15: 8 }))?.level).toBe(4);
  });
});
