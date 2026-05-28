import { describe, it, expect } from "vitest";
import { detectMultiplierMilestone } from "../../src/engine/multiplier.js";

const milestones = [2, 5, 10, 25, 50, 100];

describe("detectMultiplierMilestone", () => {
  it("returns null below the first milestone", () => {
    expect(detectMultiplierMilestone(15000, 10000, 0, milestones)).toBeNull(); // 1.5x
  });

  it("fires the milestone once a multiple is reached", () => {
    expect(detectMultiplierMilestone(20000, 10000, 0, milestones)).toBe(2); // 2x
    expect(detectMultiplierMilestone(55000, 10000, 0, milestones)).toBe(5); // 5x
  });

  it("returns the HIGHEST newly-crossed milestone on a big jump", () => {
    expect(detectMultiplierMilestone(120000, 10000, 0, milestones)).toBe(10); // 12x -> 10
    expect(detectMultiplierMilestone(300000, 10000, 0, milestones)).toBe(25); // 30x -> 25
  });

  it("does not re-fire a milestone already alerted", () => {
    expect(detectMultiplierMilestone(30000, 10000, 2, milestones)).toBeNull(); // 3x, already past 2x
    expect(detectMultiplierMilestone(60000, 10000, 5, milestones)).toBeNull(); // 6x, 5x already done
    expect(detectMultiplierMilestone(110000, 10000, 5, milestones)).toBe(10); // 11x, new 10x
  });

  it("handles invalid baselines safely", () => {
    expect(detectMultiplierMilestone(50000, 0, 0, milestones)).toBeNull();
  });
});
