import { describe, it, expect } from "vitest";
import { parseBuysFromTx } from "../../src/monitor/walletMonitor.js";

const WSOL = "So11111111111111111111111111111111111111112";

// Minimal shape of a Helius enhanced transaction.
const tx = {
  signature: "sigABC",
  timestamp: 1700000000, // unix seconds
  tokenTransfers: [
    { toUserAccount: "myWallet", mint: "TOKENMINT", tokenAmount: 1000 },
    { toUserAccount: "someoneElse", mint: "OTHER", tokenAmount: 5 },
  ],
};

describe("parseBuysFromTx", () => {
  it("extracts a buy when the watched wallet receives a non-SOL token", () => {
    const buys = parseBuysFromTx(tx, "myWallet", "S");
    expect(buys).toHaveLength(1);
    expect(buys[0]).toMatchObject({
      kolWallet: "myWallet", tier: "S", tokenMint: "TOKENMINT", signature: "sigABC", ts: 1700000000000,
    });
  });

  it("ignores WSOL inflows (not a memecoin buy)", () => {
    const wsolTx = { ...tx, tokenTransfers: [{ toUserAccount: "myWallet", mint: WSOL, tokenAmount: 1 }] };
    expect(parseBuysFromTx(wsolTx, "myWallet", "A")).toHaveLength(0);
  });

  it("ignores stablecoin (USDC) inflows (likely a sell, not a buy)", () => {
    const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const usdcTx = { ...tx, tokenTransfers: [{ toUserAccount: "myWallet", mint: USDC, tokenAmount: 100 }] };
    expect(parseBuysFromTx(usdcTx, "myWallet", "A")).toHaveLength(0);
  });

  it("ignores transfers to other wallets", () => {
    expect(parseBuysFromTx(tx, "notMyWallet", "B")).toHaveLength(0);
  });
});
