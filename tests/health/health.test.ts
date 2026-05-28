import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordFailure,
  failuresInWindow,
  noteBuysCycle,
  shouldAlert,
  markAlerted,
  runHealthChecks,
  _resetHealth,
} from "../../src/health/health.js";

const thresholds = {
  dexscreenerErr: 5,
  rugcheckErr: 5,
  rpcErr: 5,
  noBuysCycles: 3,
  muteMin: 60,
};

beforeEach(() => _resetHealth());

describe("failuresInWindow", () => {
  it("counts failures within the requested window only", () => {
    const t0 = 1_000_000;
    recordFailure("dexscreener", t0);
    recordFailure("dexscreener", t0 + 1_000);
    recordFailure("dexscreener", t0 + 60_000); // 1 min later
    // 30s window from t0+60s -> only the last one counts
    expect(failuresInWindow("dexscreener", 30_000, t0 + 60_000)).toBe(1);
    // 2 min window -> all 3
    expect(failuresInWindow("dexscreener", 120_000, t0 + 60_000)).toBe(3);
  });
});

describe("shouldAlert / markAlerted", () => {
  it("mutes a category for `muteMs` after an alert is sent", () => {
    const t0 = 1_000_000;
    expect(shouldAlert("rpc", 10_000, t0)).toBe(true);
    markAlerted("rpc", t0);
    expect(shouldAlert("rpc", 10_000, t0 + 5_000)).toBe(false);
    expect(shouldAlert("rpc", 10_000, t0 + 10_000)).toBe(true);
  });
});

describe("noteBuysCycle", () => {
  it("increments the streak on zero, resets on positive", () => {
    expect(noteBuysCycle(0)).toBe(1);
    expect(noteBuysCycle(0)).toBe(2);
    expect(noteBuysCycle(3)).toBe(0); // reset
    expect(noteBuysCycle(0)).toBe(1);
  });
});

describe("runHealthChecks", () => {
  it("fires when an error category crosses its threshold and mutes after", async () => {
    const send = vi.fn(async () => {});
    const tg = { send };
    for (let i = 0; i < 6; i++) recordFailure("dexscreener");
    await runHealthChecks(tg, thresholds);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("DexScreener");
    // Second call within the mute window: no second message.
    await runHealthChecks(tg, thresholds);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fires the no-buys alert when the streak crosses threshold", async () => {
    const send = vi.fn(async () => {});
    const tg = { send };
    noteBuysCycle(0); noteBuysCycle(0); noteBuysCycle(0); // streak 3 == threshold
    await runHealthChecks(tg, thresholds);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("no KOL buys");
  });

  it("does not fire when categories are below threshold", async () => {
    const send = vi.fn(async () => {});
    const tg = { send };
    recordFailure("dexscreener");
    await runHealthChecks(tg, thresholds);
    expect(send).not.toHaveBeenCalled();
  });
});
