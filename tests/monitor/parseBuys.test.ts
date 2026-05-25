import { describe, it, expect } from "vitest";
import { parseBuysFromParsedTx, type ParsedTxLike } from "../../src/monitor/walletMonitor.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function tx(post: { mint: string; owner: string; amount: string }[], pre: { mint: string; owner: string; amount: string }[] = []): ParsedTxLike {
  return {
    blockTime: 1700000000,
    transaction: { signatures: ["sigABC"] },
    meta: {
      preTokenBalances: pre.map((b) => ({ mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount } })),
      postTokenBalances: post.map((b) => ({ mint: b.mint, owner: b.owner, uiTokenAmount: { amount: b.amount } })),
    },
  };
}

describe("parseBuysFromParsedTx", () => {
  it("detects a buy when the wallet's token balance increases from zero", () => {
    const buys = parseBuysFromParsedTx(tx([{ mint: "TOKENMINT", owner: "myWallet", amount: "1000" }]), "myWallet", "S");
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({
      kolWallet: "myWallet", tier: "S", tokenMint: "TOKENMINT", signature: "sigABC", ts: 1700000000000,
    });
  });

  it("detects a buy when balance increases from a non-zero amount", () => {
    const buys = parseBuysFromParsedTx(
      tx([{ mint: "TOKENMINT", owner: "myWallet", amount: "1500" }], [{ mint: "TOKENMINT", owner: "myWallet", amount: "1000" }]),
      "myWallet", "A"
    );
    expect(buys).toHaveLength(1);
  });

  it("ignores a sell (balance decreases)", () => {
    const buys = parseBuysFromParsedTx(
      tx([{ mint: "TOKENMINT", owner: "myWallet", amount: "200" }], [{ mint: "TOKENMINT", owner: "myWallet", amount: "1000" }]),
      "myWallet", "B"
    );
    expect(buys).toHaveLength(0);
  });

  it("ignores WSOL and stablecoin inflows", () => {
    expect(parseBuysFromParsedTx(tx([{ mint: WSOL, owner: "myWallet", amount: "5" }]), "myWallet", "A")).toHaveLength(0);
    expect(parseBuysFromParsedTx(tx([{ mint: USDC, owner: "myWallet", amount: "5" }]), "myWallet", "A")).toHaveLength(0);
  });

  it("ignores balance changes for other wallets", () => {
    expect(parseBuysFromParsedTx(tx([{ mint: "TOKENMINT", owner: "someoneElse", amount: "1000" }]), "myWallet", "B")).toHaveLength(0);
  });

  it("returns empty when meta is missing", () => {
    expect(parseBuysFromParsedTx({ transaction: { signatures: ["s"] }, meta: null }, "myWallet", "S")).toHaveLength(0);
  });
});
