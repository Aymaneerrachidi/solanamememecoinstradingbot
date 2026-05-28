import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../../src/storage/db.js";
import { replaceKols, getAllKols, getKol } from "../../src/storage/kolStore.js";
import { recordBuy, getBuysForTokenSince } from "../../src/storage/buyStore.js";
import { alreadyAlerted, recordAlert } from "../../src/storage/alertStore.js";
import type { KolRecord, BuyEvent } from "../../src/types.js";

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
});

const kol: KolRecord = {
  wallet: "w1", name: "alice", pnl: 100, winRate: 0.6, rank: 1, tier: "S",
  appearances: 5, qualityScore: 0.5, updatedAt: 1,
};

describe("kolStore", () => {
  it("replaces and reads kols", () => {
    replaceKols(db, [kol]);
    expect(getAllKols(db)).toHaveLength(1);
    expect(getKol(db, "w1")?.tier).toBe("S");
  });
  it("replaceKols clears previous rows", () => {
    replaceKols(db, [kol]);
    replaceKols(db, [{ ...kol, wallet: "w2" }]);
    expect(getAllKols(db)).toHaveLength(1);
    expect(getKol(db, "w1")).toBeUndefined();
  });
});

describe("buyStore", () => {
  const buy: BuyEvent = { signature: "sig1", kolWallet: "w1", tier: "S", tokenMint: "m1", ts: 1000 };
  it("records a buy once and dedups by signature", () => {
    expect(recordBuy(db, buy)).toBe(true);
    expect(recordBuy(db, buy)).toBe(false);
  });
  it("returns buys for a token within the time window", () => {
    recordBuy(db, buy);
    recordBuy(db, { ...buy, signature: "sig2", ts: 500 });
    expect(getBuysForTokenSince(db, "m1", 800)).toHaveLength(1);
    expect(getBuysForTokenSince(db, "m1", 100)).toHaveLength(2);
  });
});

describe("alertStore", () => {
  it("dedups alerts by token", () => {
    expect(alreadyAlerted(db, "m1")).toBe(false);
    recordAlert(db, "m1", 1);
    expect(alreadyAlerted(db, "m1")).toBe(true);
  });
});
