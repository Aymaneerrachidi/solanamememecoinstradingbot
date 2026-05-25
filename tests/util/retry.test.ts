import { describe, it, expect } from "vitest";
import { retry } from "../../src/util/retry.js";

describe("retry", () => {
  it("returns the result on first success", async () => {
    const result = await retry(async () => 42, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe(42);
  });

  it("retries until success", async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("fail");
        return "ok";
      },
      { attempts: 5, baseDelayMs: 1 }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws after exhausting attempts", async () => {
    await expect(
      retry(async () => { throw new Error("always"); }, { attempts: 2, baseDelayMs: 1 })
    ).rejects.toThrow("always");
  });
});
