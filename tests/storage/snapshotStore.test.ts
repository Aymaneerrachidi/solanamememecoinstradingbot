import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/storage/db.js";
import { recordSnapshot, getSnapshotsSince, pruneSnapshots, epochDay } from "../../src/storage/snapshotStore.js";
import type { RawKol } from "../../src/scraper/classify.js";

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

const board: RawKol[] = [
  { wallet: "w1", name: "Cented", pnl: 200, winRate: 0.6 },
  { wallet: "w2", name: "Doji", pnl: 150, winRate: 0.5 },
];

describe("snapshotStore", () => {
  it("records leaderboard order as rank for a day", () => {
    recordSnapshot(db, board, 100);
    const rows = getSnapshotsSince(db, 100);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.wallet === "w1")).toMatchObject({ rank: 1, day: 100 });
    expect(rows.find((r) => r.wallet === "w2")).toMatchObject({ rank: 2 });
  });

  it("overwrites the same day's snapshot on re-run", () => {
    recordSnapshot(db, board, 100);
    recordSnapshot(db, [{ wallet: "w1", name: "Cented", pnl: 999, winRate: 0.9 }], 100);
    const rows = getSnapshotsSince(db, 100);
    expect(rows.filter((r) => r.day === 100 && r.wallet === "w1")).toHaveLength(1);
  });

  it("filters by day and prunes old rows", () => {
    recordSnapshot(db, board, 90);
    recordSnapshot(db, board, 100);
    expect(getSnapshotsSince(db, 95)).toHaveLength(2); // only day 100
    pruneSnapshots(db, 95);
    expect(getSnapshotsSince(db, 0)).toHaveLength(2); // day 90 pruned
  });

  it("epochDay converts ms to UTC day number", () => {
    expect(epochDay(0)).toBe(0);
    expect(epochDay(86_400_000)).toBe(1);
  });
});
