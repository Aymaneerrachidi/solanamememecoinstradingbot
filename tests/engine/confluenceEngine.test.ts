import { describe, it, expect } from "vitest";
import { evaluateConfluence } from "../../src/engine/confluenceEngine.js";
import type { BuyEvent } from "../../src/types.js";

const thresh = { S: 1, A: 2, B: 3 };

function buy(wallet: string, tier: "S" | "A" | "B"): BuyEvent {
  return { kolWallet: wallet, tier, tokenMint: "mint", ts: 0, signature: wallet };
}

describe("evaluateConfluence", () => {
  it("a single S-tier qualifies", () => {
    expect(evaluateConfluence([buy("w1", "S")], thresh)).toBe(true);
  });

  it("a single A-tier does not qualify", () => {
    expect(evaluateConfluence([buy("w1", "A")], thresh)).toBe(false);
  });

  it("two distinct A-tier qualify", () => {
    expect(evaluateConfluence([buy("w1", "A"), buy("w2", "A")], thresh)).toBe(true);
  });

  it("the same A-tier wallet twice does NOT qualify (distinct only)", () => {
    expect(evaluateConfluence([buy("w1", "A"), buy("w1", "A")], thresh)).toBe(false);
  });

  it("one A + one B does not qualify, but three Bs do", () => {
    expect(evaluateConfluence([buy("w1", "A"), buy("w2", "B")], thresh)).toBe(false);
    expect(evaluateConfluence([buy("w1", "B"), buy("w2", "B"), buy("w3", "B")], thresh)).toBe(true);
  });

  it("cumulative: one S + one A meets the A threshold of 2", () => {
    expect(evaluateConfluence([buy("w1", "S"), buy("w2", "A")], thresh)).toBe(true);
  });

  it("if a wallet appears as both A and B, its highest tier is used", () => {
    // w1 highest = A, w2 = B, w3 = B -> effectiveB = 3 -> qualifies
    expect(
      evaluateConfluence([buy("w1", "B"), buy("w1", "A"), buy("w2", "B"), buy("w3", "B")], thresh)
    ).toBe(true);
  });
});
