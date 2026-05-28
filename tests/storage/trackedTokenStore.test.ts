import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/storage/db.js";
import {
  trackToken,
  getTrackedTokens,
  updateTrackProgress,
  untrackToken,
} from "../../src/storage/trackedTokenStore.js";

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("trackedTokenStore", () => {
  it("tracks a token once (first signal sets the baseline)", () => {
    trackToken(db, { tokenMint: "m1", symbol: "WIF", name: "Dogwifhat", baselineMcUsd: 50000, ts: 100 });
    trackToken(db, { tokenMint: "m1", symbol: "WIF", name: "Dogwifhat", baselineMcUsd: 999999, ts: 200 });
    const tracked = getTrackedTokens(db);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({ tokenMint: "m1", baselineMcUsd: 50000, lastMilestone: 0, peakMult: 1 });
  });

  it("updates milestone + peak progress", () => {
    trackToken(db, { tokenMint: "m1", baselineMcUsd: 50000, ts: 100 });
    updateTrackProgress(db, "m1", 10, 12.4);
    expect(getTrackedTokens(db)[0]).toMatchObject({ lastMilestone: 10, peakMult: 12.4 });
  });

  it("untracks a token", () => {
    trackToken(db, { tokenMint: "m1", baselineMcUsd: 50000, ts: 100 });
    untrackToken(db, "m1");
    expect(getTrackedTokens(db)).toHaveLength(0);
  });
});
