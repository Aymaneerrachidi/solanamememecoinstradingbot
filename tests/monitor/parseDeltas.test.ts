import { describe, it, expect } from "vitest";
import { parseDeltasFromParsedTx, type ParsedTxLike } from "../../src/monitor/walletMonitor.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function tx(
  post: { mint: string; owner: string; amount: string }[],
  pre: { mint: string; owner: string; amount: string }[] = []
): ParsedTxLike {
  return {
    blockTime: 1700000000,
    transaction: { signatures: ["sig"] },
    meta: {
      preTokenBalances: pre.map((b) => ({ mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount } })),
      postTokenBalances: post.map((b) => ({ mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount } })),
    },
  };
}

describe("parseDeltasFromParsedTx", () => {
  it("detects a sell when balance decreases (and ignores stablecoin flows)", () => {
    const t = tx(
      [
        { mint: "TOKEN", owner: "w", amount: "100" },
        { mint: USDC, owner: "w", amount: "500" }, // KOL got USDC from the sell — ignored
      ],
      [
        { mint: "TOKEN", owner: "w", amount: "1000" },
        { mint: USDC, owner: "w", amount: "0" },
      ]
    );
    const d = parseDeltasFromParsedTx(t, "w", "S");
    expect(d.buys).toHaveLength(0);
    expect(d.sells).toHaveLength(1);
    expect(d.sells[0]).toMatchObject({ kolWallet: "w", tokenMint: "TOKEN" });
  });

  it("detects a buy and a sell in the same transaction (token swap)", () => {
    const t = tx(
      [
        { mint: "NEW", owner: "w", amount: "5000" },
        { mint: "OLD", owner: "w", amount: "0" },
      ],
      [
        { mint: "NEW", owner: "w", amount: "0" },
        { mint: "OLD", owner: "w", amount: "200" },
      ]
    );
    const d = parseDeltasFromParsedTx(t, "w", "A");
    expect(d.buys.map((b) => b.tokenMint)).toEqual(["NEW"]);
    expect(d.sells.map((s) => s.tokenMint)).toEqual(["OLD"]);
  });

  it("ignores deltas for other wallets", () => {
    const t = tx([{ mint: "TOK", owner: "other", amount: "100" }], [{ mint: "TOK", owner: "other", amount: "500" }]);
    const d = parseDeltasFromParsedTx(t, "w", "B");
    expect(d.buys).toHaveLength(0);
    expect(d.sells).toHaveLength(0);
  });
});
