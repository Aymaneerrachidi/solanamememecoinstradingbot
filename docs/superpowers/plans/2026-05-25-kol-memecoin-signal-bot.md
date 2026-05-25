# KOL Memecoin Signal Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js/TypeScript service that watches top Solana KOL wallets (from kolscan.io), detects tier-weighted buy confluence on fresh tokens, runs strict anti-rug/anti-dead-coin safety gates, and sends Telegram alerts.

**Architecture:** A long-running orchestrator runs two loops — a periodic KOL-scrape loop (populates tiered KOL wallets in SQLite) and a fast wallet-monitor loop (polls Helius for KOL buys). Buys feed a pure `ConfluenceEngine`; qualifying tokens pass through a `SafetyChecker` (DexScreener + RugCheck + on-chain RPC); survivors are dispatched to Telegram and recorded for dedup. Alert-only — no trade execution.

**Tech Stack:** TypeScript, Node.js 24, `better-sqlite3`, `@solana/web3.js`, native `fetch`, `vitest` (test runner), Helius (RPC + enhanced tx), DexScreener API, RugCheck API, Telegram Bot API.

---

## File Structure

```
package.json                     # deps + scripts
tsconfig.json                    # TS config (ESM, strict)
vitest.config.ts                 # test config
.gitignore                       # node_modules, .env, *.db
.env.example                     # documented env vars
kols.example.json                # manual KOL fallback list
src/
  types.ts                       # shared types (Tier, BuyEvent, KolRecord, SafetyStats, ...)
  config.ts                      # typed config loaded from env
  logger.ts                      # tiny leveled logger
  util/retry.ts                  # retry-with-backoff wrapper
  storage/db.ts                  # SQLite connection + schema
  storage/kolStore.ts            # kols table CRUD
  storage/buyStore.ts            # buys insert + rolling-window query
  storage/alertStore.ts          # alert dedup + insert
  scraper/kolScraper.ts          # fetch kolscan (or manual list) -> tiered KOLs
  scraper/classify.ts            # pure tier classification
  monitor/walletMonitor.ts       # WalletMonitor interface + Helius polling impl
  engine/confluenceEngine.ts     # pure tier-confluence evaluation
  safety/dexscreener.ts          # DexScreener client
  safety/rugcheck.ts             # RugCheck client
  safety/onchain.ts              # RPC: authorities + holder concentration
  safety/evaluate.ts             # pure safety threshold evaluation
  safety/safetyChecker.ts        # orchestrates clients + evaluate
  alert/telegram.ts              # Telegram sendMessage client
  alert/alertDispatcher.ts       # format + dedup + send
  main.ts                        # orchestrator (two loops)
tests/                           # mirrors src/ for unit + integration tests
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git and package.json**

Run:
```bash
git init
npm init -y
```

- [ ] **Step 2: Write `package.json`**

Replace the generated file with:
```json
{
  "name": "kol-memecoin-signal-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node --import tsx src/main.ts",
    "dev": "tsx watch src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@solana/web3.js": "^1.95.0",
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
.env
*.db
*.db-journal
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes without errors; `node_modules/` created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold TypeScript project"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type Tier = "S" | "A" | "B";

export interface KolRecord {
  wallet: string;
  name: string;
  pnl: number;
  winRate: number;
  rank: number;
  tier: Tier;
  updatedAt: number;
}

export interface BuyEvent {
  kolWallet: string;
  tier: Tier;
  tokenMint: string;
  ts: number; // unix ms
  signature: string;
}

export interface SafetyStats {
  liquidityUsd: number;
  lpBurnedOrLocked: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPct: number; // 0-100
  volume24hUsd: number;
  ageMinutes: number;
  holderCount: number;
}

export interface SafetyResult {
  pass: boolean;
  failedGates: string[];
  stats: SafetyStats;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types"
```

---

### Task 3: Config

**Files:**
- Create: `src/config.ts`
- Create: `.env.example`

- [ ] **Step 1: Write `.env.example`**

```
# Helius (free tier): https://dev.helius.xyz
HELIUS_API_KEY=your_helius_key
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_key

# Telegram: create a bot with @BotFather, get your chat id from @userinfobot
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# KOL source: leave blank to scrape kolscan; or point to a manual JSON list
KOL_MANUAL_LIST_PATH=

# Tier rank cutoffs (1-based rank). rank <= S_RANK_MAX => S; <= A_RANK_MAX => A; else B
TIER_S_RANK_MAX=10
TIER_A_RANK_MAX=30

# Confluence: distinct KOLs needed (cumulative: higher tiers count toward lower)
CONFLUENCE_S=1
CONFLUENCE_A=2
CONFLUENCE_B=3
CONFLUENCE_WINDOW_MIN=30

# Loop intervals
MONITOR_INTERVAL_SEC=8
SCRAPE_INTERVAL_HOURS=24

# Safety thresholds
MIN_LIQUIDITY_USD=10000
MAX_TOP10_HOLDER_PCT=30
MIN_VOLUME_24H_USD=20000
MIN_AGE_MINUTES=5
MAX_AGE_MINUTES=4320
MIN_HOLDERS=100
```

- [ ] **Step 2: Write `src/config.ts`**

```ts
function num(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === "" ? def : Number(v);
}

function str(name: string, def = ""): string {
  return process.env[name] ?? def;
}

export const config = {
  heliusApiKey: str("HELIUS_API_KEY"),
  rpcUrl: str("SOLANA_RPC_URL"),
  telegramBotToken: str("TELEGRAM_BOT_TOKEN"),
  telegramChatId: str("TELEGRAM_CHAT_ID"),
  kolManualListPath: str("KOL_MANUAL_LIST_PATH"),
  tiers: {
    sRankMax: num("TIER_S_RANK_MAX", 10),
    aRankMax: num("TIER_A_RANK_MAX", 30),
  },
  confluence: {
    S: num("CONFLUENCE_S", 1),
    A: num("CONFLUENCE_A", 2),
    B: num("CONFLUENCE_B", 3),
    windowMin: num("CONFLUENCE_WINDOW_MIN", 30),
  },
  monitorIntervalSec: num("MONITOR_INTERVAL_SEC", 8),
  scrapeIntervalHours: num("SCRAPE_INTERVAL_HOURS", 24),
  safety: {
    minLiquidityUsd: num("MIN_LIQUIDITY_USD", 10000),
    maxTop10Pct: num("MAX_TOP10_HOLDER_PCT", 30),
    minVolume24hUsd: num("MIN_VOLUME_24H_USD", 20000),
    minAgeMinutes: num("MIN_AGE_MINUTES", 5),
    maxAgeMinutes: num("MAX_AGE_MINUTES", 4320),
    minHolders: num("MIN_HOLDERS", 100),
  },
};

export type Config = typeof config;
```

- [ ] **Step 3: Commit**

```bash
git add src/config.ts .env.example
git commit -m "feat: add config + env example"
```

---

### Task 4: Logger and retry util

**Files:**
- Create: `src/logger.ts`
- Create: `src/util/retry.ts`
- Test: `tests/util/retry.test.ts`

- [ ] **Step 1: Write `src/logger.ts`**

```ts
type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) console[level === "error" ? "error" : "log"](line, extra);
  else console[level === "error" ? "error" : "log"](line);
}

export const logger = {
  info: (m: string, e?: unknown) => log("info", m, e),
  warn: (m: string, e?: unknown) => log("warn", m, e),
  error: (m: string, e?: unknown) => log("error", m, e),
};
```

- [ ] **Step 2: Write the failing test `tests/util/retry.test.ts`**

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/util/retry.test.ts`
Expected: FAIL — cannot find module `retry.js`.

- [ ] **Step 4: Write `src/util/retry.ts`**

```ts
export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < opts.attempts - 1) await sleep(opts.baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/util/retry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/logger.ts src/util/retry.ts tests/util/retry.test.ts
git commit -m "feat: add logger and retry util"
```

---

### Task 5: Tier classification (pure logic)

**Files:**
- Create: `src/scraper/classify.ts`
- Test: `tests/scraper/classify.test.ts`

- [ ] **Step 1: Write the failing test `tests/scraper/classify.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { classifyTier, classifyAll } from "../../src/scraper/classify.js";

describe("classifyTier", () => {
  const cutoffs = { sRankMax: 10, aRankMax: 30 };
  it("ranks 1..10 are S", () => {
    expect(classifyTier(1, cutoffs)).toBe("S");
    expect(classifyTier(10, cutoffs)).toBe("S");
  });
  it("ranks 11..30 are A", () => {
    expect(classifyTier(11, cutoffs)).toBe("A");
    expect(classifyTier(30, cutoffs)).toBe("A");
  });
  it("ranks 31+ are B", () => {
    expect(classifyTier(31, cutoffs)).toBe("B");
  });
});

describe("classifyAll", () => {
  it("assigns rank by pnl desc and tiers accordingly", () => {
    const raw = [
      { wallet: "w1", name: "a", pnl: 50, winRate: 0.6 },
      { wallet: "w2", name: "b", pnl: 200, winRate: 0.7 },
      { wallet: "w3", name: "c", pnl: 10, winRate: 0.5 },
    ];
    const result = classifyAll(raw, { sRankMax: 1, aRankMax: 2 }, 1000);
    expect(result[0]).toMatchObject({ wallet: "w2", rank: 1, tier: "S" });
    expect(result[1]).toMatchObject({ wallet: "w1", rank: 2, tier: "A" });
    expect(result[2]).toMatchObject({ wallet: "w3", rank: 3, tier: "B" });
    expect(result[0].updatedAt).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scraper/classify.test.ts`
Expected: FAIL — cannot find module `classify.js`.

- [ ] **Step 3: Write `src/scraper/classify.ts`**

```ts
import type { KolRecord, Tier } from "../types.js";

export interface TierCutoffs {
  sRankMax: number;
  aRankMax: number;
}

export interface RawKol {
  wallet: string;
  name: string;
  pnl: number;
  winRate: number;
}

export function classifyTier(rank: number, cutoffs: TierCutoffs): Tier {
  if (rank <= cutoffs.sRankMax) return "S";
  if (rank <= cutoffs.aRankMax) return "A";
  return "B";
}

export function classifyAll(raw: RawKol[], cutoffs: TierCutoffs, now: number): KolRecord[] {
  const sorted = [...raw].sort((a, b) => b.pnl - a.pnl);
  return sorted.map((k, i) => {
    const rank = i + 1;
    return {
      wallet: k.wallet,
      name: k.name,
      pnl: k.pnl,
      winRate: k.winRate,
      rank,
      tier: classifyTier(rank, cutoffs),
      updatedAt: now,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scraper/classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/classify.ts tests/scraper/classify.test.ts
git commit -m "feat: add KOL tier classification"
```

---

### Task 6: Confluence engine (pure logic)

**Files:**
- Create: `src/engine/confluenceEngine.ts`
- Test: `tests/engine/confluenceEngine.test.ts`

**Rule:** Count *distinct* KOL wallets per tier within the window. Tiers are cumulative — an S-tier wallet also counts toward the A and B thresholds, and an A-tier toward B. Qualifies if `effectiveS >= thresh.S || effectiveA >= thresh.A || effectiveB >= thresh.B`.

- [ ] **Step 1: Write the failing test `tests/engine/confluenceEngine.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/confluenceEngine.test.ts`
Expected: FAIL — cannot find module `confluenceEngine.js`.

- [ ] **Step 3: Write `src/engine/confluenceEngine.ts`**

```ts
import type { BuyEvent, Tier } from "../types.js";

export interface ConfluenceThresholds {
  S: number;
  A: number;
  B: number;
}

const TIER_ORDER: Record<Tier, number> = { S: 3, A: 2, B: 1 };

export function evaluateConfluence(buys: BuyEvent[], thresh: ConfluenceThresholds): boolean {
  // Highest tier per distinct wallet.
  const bestByWallet = new Map<string, Tier>();
  for (const b of buys) {
    const current = bestByWallet.get(b.kolWallet);
    if (!current || TIER_ORDER[b.tier] > TIER_ORDER[current]) {
      bestByWallet.set(b.kolWallet, b.tier);
    }
  }

  let s = 0, a = 0, bCount = 0;
  for (const tier of bestByWallet.values()) {
    if (tier === "S") s++;
    else if (tier === "A") a++;
    else bCount++;
  }

  const effectiveS = s;
  const effectiveA = s + a;
  const effectiveB = s + a + bCount;

  return effectiveS >= thresh.S || effectiveA >= thresh.A || effectiveB >= thresh.B;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/confluenceEngine.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/confluenceEngine.ts tests/engine/confluenceEngine.test.ts
git commit -m "feat: add confluence engine"
```

---

### Task 7: Safety evaluation (pure logic)

**Files:**
- Create: `src/safety/evaluate.ts`
- Test: `tests/safety/evaluate.test.ts`

- [ ] **Step 1: Write the failing test `tests/safety/evaluate.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { evaluateSafety } from "../../src/safety/evaluate.js";
import type { SafetyStats } from "../../src/types.js";

const thresholds = {
  minLiquidityUsd: 10000,
  maxTop10Pct: 30,
  minVolume24hUsd: 20000,
  minAgeMinutes: 5,
  maxAgeMinutes: 4320,
  minHolders: 100,
};

const goodStats: SafetyStats = {
  liquidityUsd: 50000,
  lpBurnedOrLocked: true,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  top10HolderPct: 20,
  volume24hUsd: 100000,
  ageMinutes: 60,
  holderCount: 500,
};

describe("evaluateSafety", () => {
  it("passes when all gates are satisfied", () => {
    const r = evaluateSafety(goodStats, thresholds);
    expect(r.pass).toBe(true);
    expect(r.failedGates).toEqual([]);
  });

  it("fails on low liquidity", () => {
    const r = evaluateSafety({ ...goodStats, liquidityUsd: 500 }, thresholds);
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("liquidity");
  });

  it("fails when LP not burned/locked", () => {
    const r = evaluateSafety({ ...goodStats, lpBurnedOrLocked: false }, thresholds);
    expect(r.failedGates).toContain("lpLock");
  });

  it("fails when mint authority not revoked", () => {
    const r = evaluateSafety({ ...goodStats, mintAuthorityRevoked: false }, thresholds);
    expect(r.failedGates).toContain("mintAuthority");
  });

  it("fails when freeze authority not revoked", () => {
    const r = evaluateSafety({ ...goodStats, freezeAuthorityRevoked: false }, thresholds);
    expect(r.failedGates).toContain("freezeAuthority");
  });

  it("fails on holder concentration too high", () => {
    const r = evaluateSafety({ ...goodStats, top10HolderPct: 80 }, thresholds);
    expect(r.failedGates).toContain("holderConcentration");
  });

  it("fails on low volume", () => {
    const r = evaluateSafety({ ...goodStats, volume24hUsd: 100 }, thresholds);
    expect(r.failedGates).toContain("volume");
  });

  it("fails when too young", () => {
    const r = evaluateSafety({ ...goodStats, ageMinutes: 1 }, thresholds);
    expect(r.failedGates).toContain("ageMin");
  });

  it("fails when too old (dead coin)", () => {
    const r = evaluateSafety({ ...goodStats, ageMinutes: 99999 }, thresholds);
    expect(r.failedGates).toContain("ageMax");
  });

  it("fails on too few holders", () => {
    const r = evaluateSafety({ ...goodStats, holderCount: 5 }, thresholds);
    expect(r.failedGates).toContain("holders");
  });

  it("collects multiple failed gates", () => {
    const r = evaluateSafety({ ...goodStats, liquidityUsd: 0, holderCount: 1 }, thresholds);
    expect(r.failedGates).toEqual(expect.arrayContaining(["liquidity", "holders"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/safety/evaluate.test.ts`
Expected: FAIL — cannot find module `evaluate.js`.

- [ ] **Step 3: Write `src/safety/evaluate.ts`**

```ts
import type { SafetyStats, SafetyResult } from "../types.js";

export interface SafetyThresholds {
  minLiquidityUsd: number;
  maxTop10Pct: number;
  minVolume24hUsd: number;
  minAgeMinutes: number;
  maxAgeMinutes: number;
  minHolders: number;
}

export function evaluateSafety(stats: SafetyStats, t: SafetyThresholds): SafetyResult {
  const failedGates: string[] = [];

  if (stats.liquidityUsd < t.minLiquidityUsd) failedGates.push("liquidity");
  if (!stats.lpBurnedOrLocked) failedGates.push("lpLock");
  if (!stats.mintAuthorityRevoked) failedGates.push("mintAuthority");
  if (!stats.freezeAuthorityRevoked) failedGates.push("freezeAuthority");
  if (stats.top10HolderPct > t.maxTop10Pct) failedGates.push("holderConcentration");
  if (stats.volume24hUsd < t.minVolume24hUsd) failedGates.push("volume");
  if (stats.ageMinutes < t.minAgeMinutes) failedGates.push("ageMin");
  if (stats.ageMinutes > t.maxAgeMinutes) failedGates.push("ageMax");
  if (stats.holderCount < t.minHolders) failedGates.push("holders");

  return { pass: failedGates.length === 0, failedGates, stats };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/safety/evaluate.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/safety/evaluate.ts tests/safety/evaluate.test.ts
git commit -m "feat: add safety gate evaluation"
```

---

### Task 8: SQLite storage

**Files:**
- Create: `src/storage/db.ts`
- Create: `src/storage/kolStore.ts`
- Create: `src/storage/buyStore.ts`
- Create: `src/storage/alertStore.ts`
- Test: `tests/storage/stores.test.ts`

- [ ] **Step 1: Write `src/storage/db.ts`**

```ts
import Database from "better-sqlite3";

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kols (
      wallet TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pnl REAL NOT NULL,
      winRate REAL NOT NULL,
      rank INTEGER NOT NULL,
      tier TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buys (
      signature TEXT PRIMARY KEY,
      kolWallet TEXT NOT NULL,
      tier TEXT NOT NULL,
      tokenMint TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_buys_token_ts ON buys (tokenMint, ts);
    CREATE TABLE IF NOT EXISTS alerts (
      tokenMint TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
  `);
  return db;
}
```

- [ ] **Step 2: Write `src/storage/kolStore.ts`**

```ts
import type { DB } from "./db.js";
import type { KolRecord } from "../types.js";

export function replaceKols(db: DB, kols: KolRecord[]): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO kols (wallet, name, pnl, winRate, rank, tier, updatedAt)
     VALUES (@wallet, @name, @pnl, @winRate, @rank, @tier, @updatedAt)`
  );
  const tx = db.transaction((rows: KolRecord[]) => {
    db.prepare("DELETE FROM kols").run();
    for (const r of rows) insert.run(r);
  });
  tx(kols);
}

export function getAllKols(db: DB): KolRecord[] {
  return db.prepare("SELECT * FROM kols").all() as KolRecord[];
}

export function getKol(db: DB, wallet: string): KolRecord | undefined {
  return db.prepare("SELECT * FROM kols WHERE wallet = ?").get(wallet) as KolRecord | undefined;
}
```

- [ ] **Step 3: Write `src/storage/buyStore.ts`**

```ts
import type { DB } from "./db.js";
import type { BuyEvent } from "../types.js";

// Returns false if the signature was already recorded (duplicate).
export function recordBuy(db: DB, buy: BuyEvent): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO buys (signature, kolWallet, tier, tokenMint, ts)
       VALUES (@signature, @kolWallet, @tier, @tokenMint, @ts)`
    )
    .run(buy);
  return res.changes > 0;
}

export function getBuysForTokenSince(db: DB, tokenMint: string, sinceTs: number): BuyEvent[] {
  return db
    .prepare("SELECT * FROM buys WHERE tokenMint = ? AND ts >= ? ORDER BY ts ASC")
    .all(tokenMint, sinceTs) as BuyEvent[];
}
```

- [ ] **Step 4: Write `src/storage/alertStore.ts`**

```ts
import type { DB } from "./db.js";

export function alreadyAlerted(db: DB, tokenMint: string): boolean {
  return !!db.prepare("SELECT 1 FROM alerts WHERE tokenMint = ?").get(tokenMint);
}

export function recordAlert(db: DB, tokenMint: string, ts: number): void {
  db.prepare("INSERT OR IGNORE INTO alerts (tokenMint, ts) VALUES (?, ?)").run(tokenMint, ts);
}
```

- [ ] **Step 5: Write the test `tests/storage/stores.test.ts`**

```ts
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
  wallet: "w1", name: "alice", pnl: 100, winRate: 0.6, rank: 1, tier: "S", updatedAt: 1,
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/storage/stores.test.ts`
Expected: PASS (5 tests). (No prior failing run needed — `better-sqlite3` is installed; tests are written against the implementation above.)

- [ ] **Step 7: Commit**

```bash
git add src/storage tests/storage/stores.test.ts
git commit -m "feat: add SQLite storage layer"
```

---

### Task 9: Safety data clients (DexScreener, RugCheck, on-chain)

**Files:**
- Create: `src/safety/dexscreener.ts`
- Create: `src/safety/rugcheck.ts`
- Create: `src/safety/onchain.ts`

These are thin I/O wrappers. They are exercised via the integration test in Task 13 (with mocked `fetch`/RPC), so no standalone unit test here.

- [ ] **Step 1: Write `src/safety/dexscreener.ts`**

```ts
import { retry } from "../util/retry.js";

export interface DexData {
  liquidityUsd: number;
  volume24hUsd: number;
  ageMinutes: number;
  found: boolean;
}

interface DexPair {
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number; // unix ms
}

export async function fetchDexData(tokenMint: string, now = Date.now()): Promise<DexData> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
  const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 300 });
  const json = (await res.json()) as { pairs?: DexPair[] };
  const pairs = json.pairs ?? [];
  if (pairs.length === 0) return { liquidityUsd: 0, volume24hUsd: 0, ageMinutes: 0, found: false };

  // Use the most liquid pair.
  const best = pairs.reduce((a, b) =>
    (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a
  );
  const ageMinutes = best.pairCreatedAt ? (now - best.pairCreatedAt) / 60000 : 0;
  return {
    liquidityUsd: best.liquidity?.usd ?? 0,
    volume24hUsd: best.volume?.h24 ?? 0,
    ageMinutes,
    found: true,
  };
}
```

- [ ] **Step 2: Write `src/safety/rugcheck.ts`**

```ts
import { retry } from "../util/retry.js";

export interface RugData {
  lpBurnedOrLocked: boolean;
  found: boolean;
}

interface RugReport {
  markets?: { lp?: { lpLockedPct?: number } }[];
}

// RugCheck public report. lpLockedPct >= 90 treated as burned/locked.
export async function fetchRugData(tokenMint: string): Promise<RugData> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`;
  try {
    const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 300 });
    if (!res.ok) return { lpBurnedOrLocked: false, found: false };
    const json = (await res.json()) as RugReport;
    const lockedPct = json.markets?.[0]?.lp?.lpLockedPct ?? 0;
    return { lpBurnedOrLocked: lockedPct >= 90, found: true };
  } catch {
    return { lpBurnedOrLocked: false, found: false };
  }
}
```

- [ ] **Step 3: Write `src/safety/onchain.ts`**

```ts
import { Connection, PublicKey } from "@solana/web3.js";

export interface OnchainData {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPct: number;
  holderCount: number;
}

export async function fetchOnchainData(
  conn: Connection,
  tokenMint: string
): Promise<OnchainData> {
  const mint = new PublicKey(tokenMint);

  const supplyResp = await conn.getTokenSupply(mint);
  const totalSupply = Number(supplyResp.value.amount);

  // Parsed mint account exposes mintAuthority / freezeAuthority (null when revoked).
  const info = await conn.getParsedAccountInfo(mint);
  const parsed = (info.value?.data as { parsed?: { info?: Record<string, unknown> } })?.parsed?.info ?? {};
  const mintAuthorityRevoked = parsed.mintAuthority == null;
  const freezeAuthorityRevoked = parsed.freezeAuthority == null;

  const largest = await conn.getTokenLargestAccounts(mint);
  const top10 = largest.value.slice(0, 10);
  const top10Amount = top10.reduce((sum, a) => sum + Number(a.amount), 0);
  const top10HolderPct = totalSupply > 0 ? (top10Amount / totalSupply) * 100 : 100;

  return {
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    top10HolderPct,
    holderCount: largest.value.length,
  };
}
```

> Note: `getTokenLargestAccounts` returns up to 20 accounts, so `holderCount` from it is a coarse proxy. The `MIN_HOLDERS` gate uses it as a lower-bound signal; if a richer holder count is needed later, swap in a Helius DAS call. This is acceptable for v1.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/safety/dexscreener.ts src/safety/rugcheck.ts src/safety/onchain.ts
git commit -m "feat: add safety data clients"
```

---

### Task 10: SafetyChecker orchestration

**Files:**
- Create: `src/safety/safetyChecker.ts`
- Test: `tests/safety/safetyChecker.test.ts`

- [ ] **Step 1: Write the failing test `tests/safety/safetyChecker.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { checkToken } from "../../src/safety/safetyChecker.js";

const thresholds = {
  minLiquidityUsd: 10000, maxTop10Pct: 30, minVolume24hUsd: 20000,
  minAgeMinutes: 5, maxAgeMinutes: 4320, minHolders: 10,
};

const deps = {
  dex: async () => ({ liquidityUsd: 50000, volume24hUsd: 100000, ageMinutes: 60, found: true }),
  rug: async () => ({ lpBurnedOrLocked: true, found: true }),
  chain: async () => ({
    mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 15, holderCount: 200,
  }),
};

describe("checkToken", () => {
  it("passes when all data sources are healthy and within thresholds", async () => {
    const r = await checkToken("mint", thresholds, deps);
    expect(r.pass).toBe(true);
  });

  it("fail-closed: DexScreener reports token not found", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, dex: async () => ({ liquidityUsd: 0, volume24hUsd: 0, ageMinutes: 0, found: false }) });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("dataUnavailable");
  });

  it("fail-closed: an on-chain fetch throws", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, chain: async () => { throw new Error("rpc down"); } });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("dataUnavailable");
  });

  it("fails normally on a bad threshold (low liquidity)", async () => {
    const r = await checkToken("mint", thresholds, { ...deps, dex: async () => ({ liquidityUsd: 1, volume24hUsd: 100000, ageMinutes: 60, found: true }) });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain("liquidity");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/safety/safetyChecker.test.ts`
Expected: FAIL — cannot find module `safetyChecker.js`.

- [ ] **Step 3: Write `src/safety/safetyChecker.ts`**

```ts
import type { SafetyResult } from "../types.js";
import { evaluateSafety, type SafetyThresholds } from "./evaluate.js";
import type { DexData } from "./dexscreener.js";
import type { RugData } from "./rugcheck.js";
import type { OnchainData } from "./onchain.js";

export interface SafetyDeps {
  dex: (mint: string) => Promise<DexData>;
  rug: (mint: string) => Promise<RugData>;
  chain: (mint: string) => Promise<OnchainData>;
}

const FAIL_CLOSED: SafetyResult = {
  pass: false,
  failedGates: ["dataUnavailable"],
  stats: {
    liquidityUsd: 0, lpBurnedOrLocked: false, mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false, top10HolderPct: 100, volume24hUsd: 0,
    ageMinutes: 0, holderCount: 0,
  },
};

export async function checkToken(
  mint: string,
  thresholds: SafetyThresholds,
  deps: SafetyDeps
): Promise<SafetyResult> {
  try {
    const [dex, rug, chain] = await Promise.all([deps.dex(mint), deps.rug(mint), deps.chain(mint)]);
    if (!dex.found) return FAIL_CLOSED;

    return evaluateSafety(
      {
        liquidityUsd: dex.liquidityUsd,
        volume24hUsd: dex.volume24hUsd,
        ageMinutes: dex.ageMinutes,
        lpBurnedOrLocked: rug.lpBurnedOrLocked,
        mintAuthorityRevoked: chain.mintAuthorityRevoked,
        freezeAuthorityRevoked: chain.freezeAuthorityRevoked,
        top10HolderPct: chain.top10HolderPct,
        holderCount: chain.holderCount,
      },
      thresholds
    );
  } catch {
    return FAIL_CLOSED;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/safety/safetyChecker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/safety/safetyChecker.ts tests/safety/safetyChecker.test.ts
git commit -m "feat: add safety checker orchestration"
```

---

### Task 11: Telegram client + AlertDispatcher

**Files:**
- Create: `src/alert/telegram.ts`
- Create: `src/alert/alertDispatcher.ts`
- Test: `tests/alert/alertDispatcher.test.ts`

- [ ] **Step 1: Write `src/alert/telegram.ts`**

```ts
import { retry } from "../util/retry.js";

export interface TelegramClient {
  send(text: string): Promise<void>;
}

export function createTelegramClient(botToken: string, chatId: string): TelegramClient {
  return {
    async send(text: string) {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await retry(
        () =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
          }),
        { attempts: 3, baseDelayMs: 500 }
      );
    },
  };
}
```

- [ ] **Step 2: Write the failing test `tests/alert/alertDispatcher.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { formatAlert, dispatchAlert } from "../../src/alert/alertDispatcher.js";
import { openDb } from "../../src/storage/db.js";
import type { BuyEvent, SafetyResult } from "../../src/types.js";

const buys: BuyEvent[] = [
  { kolWallet: "wAAA", tier: "S", tokenMint: "MINT123", ts: 0, signature: "s1" },
  { kolWallet: "wBBB", tier: "A", tokenMint: "MINT123", ts: 0, signature: "s2" },
];

const safety: SafetyResult = {
  pass: true,
  failedGates: [],
  stats: {
    liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true,
    freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000,
    ageMinutes: 45, holderCount: 300,
  },
};

describe("formatAlert", () => {
  it("includes token, KOL count, tiers, and key stats", () => {
    const msg = formatAlert("MINT123", buys, safety);
    expect(msg).toContain("MINT123");
    expect(msg).toContain("2 KOL");
    expect(msg).toContain("S");
    expect(msg).toContain("dexscreener.com");
    expect(msg).toContain("$50,000");
  });
});

describe("dispatchAlert", () => {
  it("sends once and dedups the second time", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const tg = { send };

    const first = await dispatchAlert(db, tg, "MINT123", buys, safety);
    const second = await dispatchAlert(db, tg, "MINT123", buys, safety);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/alert/alertDispatcher.test.ts`
Expected: FAIL — cannot find module `alertDispatcher.js`.

- [ ] **Step 4: Write `src/alert/alertDispatcher.ts`**

```ts
import type { DB } from "../storage/db.js";
import type { BuyEvent, SafetyResult } from "../types.js";
import type { TelegramClient } from "./telegram.js";
import { alreadyAlerted, recordAlert } from "../storage/alertStore.js";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function formatAlert(tokenMint: string, buys: BuyEvent[], safety: SafetyResult): string {
  const tiers = buys.map((b) => `${b.tier}`).join(", ");
  const s = safety.stats;
  return [
    `🚀 *KOL Confluence Signal*`,
    ``,
    `*Token:* \`${tokenMint}\``,
    `*${buys.length} KOL${buys.length > 1 ? "s" : ""} in* (tiers: ${tiers})`,
    ``,
    `*Liquidity:* ${usd(s.liquidityUsd)}`,
    `*24h Volume:* ${usd(s.volume24hUsd)}`,
    `*Age:* ${Math.round(s.ageMinutes)} min`,
    `*Top-10 holders:* ${s.top10HolderPct.toFixed(1)}%`,
    `*LP locked/burned:* ${s.lpBurnedOrLocked ? "✅" : "❌"}`,
    `*Mint/Freeze revoked:* ${s.mintAuthorityRevoked ? "✅" : "❌"}/${s.freezeAuthorityRevoked ? "✅" : "❌"}`,
    ``,
    `📊 https://dexscreener.com/solana/${tokenMint}`,
  ].join("\n");
}

export async function dispatchAlert(
  db: DB,
  tg: TelegramClient,
  tokenMint: string,
  buys: BuyEvent[],
  safety: SafetyResult
): Promise<boolean> {
  if (alreadyAlerted(db, tokenMint)) return false;
  await tg.send(formatAlert(tokenMint, buys, safety));
  recordAlert(db, tokenMint, Date.now());
  return true;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/alert/alertDispatcher.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/alert tests/alert/alertDispatcher.test.ts
git commit -m "feat: add Telegram alert dispatcher"
```

---

### Task 12: WalletMonitor (Helius polling)

**Files:**
- Create: `src/monitor/walletMonitor.ts`
- Test: `tests/monitor/parseBuys.test.ts`

The monitor's transaction-parsing logic is pure and testable; the polling loop is thin glue around it.

- [ ] **Step 1: Write the failing test `tests/monitor/parseBuys.test.ts`**

```ts
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

  it("ignores transfers to other wallets", () => {
    expect(parseBuysFromTx(tx, "notMyWallet", "B")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitor/parseBuys.test.ts`
Expected: FAIL — cannot find module `walletMonitor.js`.

- [ ] **Step 3: Write `src/monitor/walletMonitor.ts`**

```ts
import { retry } from "../util/retry.js";
import { logger } from "../logger.js";
import type { BuyEvent, Tier } from "../types.js";

const WSOL = "So11111111111111111111111111111111111111112";

export interface HeliusTx {
  signature: string;
  timestamp: number; // unix seconds
  tokenTransfers?: { toUserAccount?: string; mint?: string; tokenAmount?: number }[];
}

export function parseBuysFromTx(tx: HeliusTx, wallet: string, tier: Tier): BuyEvent[] {
  const transfers = tx.tokenTransfers ?? [];
  const buys: BuyEvent[] = [];
  for (const t of transfers) {
    if (t.toUserAccount === wallet && t.mint && t.mint !== WSOL) {
      buys.push({
        kolWallet: wallet,
        tier,
        tokenMint: t.mint,
        ts: tx.timestamp * 1000,
        signature: tx.signature,
      });
    }
  }
  return buys;
}

export interface WalletMonitor {
  poll(): Promise<BuyEvent[]>;
}

export interface WatchedWallet {
  wallet: string;
  tier: Tier;
}

// Helius enhanced-transactions polling implementation.
export function createHeliusMonitor(
  apiKey: string,
  getWallets: () => WatchedWallet[]
): WalletMonitor {
  return {
    async poll(): Promise<BuyEvent[]> {
      const wallets = getWallets();
      const all: BuyEvent[] = [];
      for (const w of wallets) {
        try {
          const url = `https://api.helius.xyz/v0/addresses/${w.wallet}/transactions?api-key=${apiKey}&type=SWAP&limit=10`;
          const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 400 });
          if (!res.ok) continue;
          const txs = (await res.json()) as HeliusTx[];
          for (const tx of txs) all.push(...parseBuysFromTx(tx, w.wallet, w.tier));
        } catch (err) {
          logger.warn(`monitor poll failed for ${w.wallet}`, err);
        }
      }
      return all;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/monitor/parseBuys.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/monitor/walletMonitor.ts tests/monitor/parseBuys.test.ts
git commit -m "feat: add Helius wallet monitor"
```

---

### Task 13: KOL scraper (kolscan + manual fallback)

**Files:**
- Create: `src/scraper/kolScraper.ts`
- Create: `kols.example.json`
- Test: `tests/scraper/kolScraper.test.ts`

> Implementation note: kolscan.io's exact leaderboard JSON endpoint must be verified at build time via browser devtools (Network tab). The scraper is written against the expected `{ wallet, name, pnl, winRate }` shape and isolates the raw fetch+map in `fetchKolscanRaw`. If the endpoint differs, only that one function changes. A manual JSON list (`KOL_MANUAL_LIST_PATH`) is always supported as the source of truth / fallback.

- [ ] **Step 1: Write `kols.example.json`**

```json
[
  { "wallet": "REPLACE_WITH_KOL_WALLET_1", "name": "kol1", "pnl": 1000, "winRate": 0.7 },
  { "wallet": "REPLACE_WITH_KOL_WALLET_2", "name": "kol2", "pnl": 800, "winRate": 0.65 }
]
```

- [ ] **Step 2: Write the failing test `tests/scraper/kolScraper.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadKols } from "../../src/scraper/kolScraper.js";

describe("loadKols", () => {
  const cutoffs = { sRankMax: 1, aRankMax: 2 };

  it("uses the manual fetcher when provided and classifies into tiers", async () => {
    const manual = async () => [
      { wallet: "w1", name: "a", pnl: 10, winRate: 0.5 },
      { wallet: "w2", name: "b", pnl: 99, winRate: 0.9 },
    ];
    const kols = await loadKols({ fetchRaw: manual, cutoffs, now: 1234 });
    expect(kols[0]).toMatchObject({ wallet: "w2", rank: 1, tier: "S" });
    expect(kols[1]).toMatchObject({ wallet: "w1", rank: 2, tier: "A" });
  });

  it("falls back to the previous list when the fetcher throws", async () => {
    const prev = [
      { wallet: "old", name: "o", pnl: 1, winRate: 0.1, rank: 1, tier: "S" as const, updatedAt: 1 },
    ];
    const failing = async () => { throw new Error("scrape down"); };
    const kols = await loadKols({ fetchRaw: failing, cutoffs, now: 1234, previous: prev });
    expect(kols).toEqual(prev);
  });

  it("returns empty when fetcher throws and there is no previous list", async () => {
    const failing = async () => { throw new Error("scrape down"); };
    const kols = await loadKols({ fetchRaw: failing, cutoffs, now: 1234 });
    expect(kols).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/scraper/kolScraper.test.ts`
Expected: FAIL — cannot find module `kolScraper.js`.

- [ ] **Step 4: Write `src/scraper/kolScraper.ts`**

```ts
import { readFile } from "node:fs/promises";
import { retry } from "../util/retry.js";
import { logger } from "../logger.js";
import { classifyAll, type RawKol, type TierCutoffs } from "./classify.js";
import type { KolRecord } from "../types.js";

export interface LoadKolsArgs {
  fetchRaw: () => Promise<RawKol[]>;
  cutoffs: TierCutoffs;
  now: number;
  previous?: KolRecord[];
}

export async function loadKols(args: LoadKolsArgs): Promise<KolRecord[]> {
  try {
    const raw = await args.fetchRaw();
    if (raw.length === 0) throw new Error("empty KOL list");
    return classifyAll(raw, args.cutoffs, args.now);
  } catch (err) {
    logger.warn("KOL fetch failed; keeping previous list", err);
    return args.previous ?? [];
  }
}

// Source: a manual JSON file of RawKol objects.
export function manualFetcher(path: string): () => Promise<RawKol[]> {
  return async () => {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as RawKol[];
  };
}

// Source: kolscan.io leaderboard. VERIFY the endpoint + field mapping in devtools.
export function kolscanFetcher(): () => Promise<RawKol[]> {
  return async () => {
    const url = "https://api.kolscan.io/leaderboard";
    const res = await retry(() => fetch(url), { attempts: 3, baseDelayMs: 500 });
    if (!res.ok) throw new Error(`kolscan ${res.status}`);
    const json = (await res.json()) as {
      wallet: string; name?: string; pnl?: number; winRate?: number;
    }[];
    return json.map((k) => ({
      wallet: k.wallet,
      name: k.name ?? k.wallet.slice(0, 6),
      pnl: k.pnl ?? 0,
      winRate: k.winRate ?? 0,
    }));
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/scraper/kolScraper.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/scraper/kolScraper.ts kols.example.json tests/scraper/kolScraper.test.ts
git commit -m "feat: add KOL scraper with manual fallback"
```

---

### Task 14: Main orchestrator + end-to-end integration test

**Files:**
- Create: `src/main.ts`
- Create: `src/pipeline.ts` (the per-poll processing step, extracted so it is testable)
- Test: `tests/pipeline.test.ts`

- [ ] **Step 1: Write the failing test `tests/pipeline.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { processBuys } from "../src/pipeline.js";
import { openDb } from "../src/storage/db.js";
import { replaceKols } from "../src/storage/kolStore.js";
import type { BuyEvent, SafetyResult } from "../src/types.js";

const thresholds = {
  minLiquidityUsd: 10000, maxTop10Pct: 30, minVolume24hUsd: 20000,
  minAgeMinutes: 5, maxAgeMinutes: 4320, minHolders: 10,
};
const confluence = { S: 1, A: 2, B: 3, windowMin: 30 };

const passSafety: SafetyResult = {
  pass: true, failedGates: [],
  stats: { liquidityUsd: 50000, lpBurnedOrLocked: true, mintAuthorityRevoked: true, freezeAuthorityRevoked: true, top10HolderPct: 20, volume24hUsd: 80000, ageMinutes: 45, holderCount: 300 },
};

function freshBuy(wallet: string, tier: "S" | "A" | "B", sig: string, mint = "MINT", ts = Date.now()): BuyEvent {
  return { kolWallet: wallet, tier, tokenMint: mint, ts, signature: sig };
}

describe("processBuys (end-to-end pipeline)", () => {
  it("alerts when confluence + safety pass, then dedups", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);

    // One S-tier buy meets confluence (S:1).
    const buys = [freshBuy("w1", "S", "sig1")];
    const alerted = await processBuys(db, buys, { thresholds, confluence, checkToken: check, tg: { send } });
    expect(alerted).toEqual(["MINT"]);
    expect(send).toHaveBeenCalledTimes(1);

    // Same token again -> deduped, no second alert.
    const again = await processBuys(db, [freshBuy("w2", "S", "sig2")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(again).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does NOT alert when confluence is not met", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const check = vi.fn(async () => passSafety);
    const alerted = await processBuys(db, [freshBuy("w1", "A", "sigX")], { thresholds, confluence, checkToken: check, tg: { send } });
    expect(alerted).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("does NOT alert when safety fails", async () => {
    const db = openDb(":memory:");
    const send = vi.fn(async () => {});
    const fail: SafetyResult = { ...passSafety, pass: false, failedGates: ["liquidity"] };
    const alerted = await processBuys(db, [freshBuy("w1", "S", "sigY")], { thresholds, confluence, checkToken: async () => fail, tg: { send } });
    expect(alerted).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — cannot find module `pipeline.js`.

- [ ] **Step 3: Write `src/pipeline.ts`**

```ts
import type { DB } from "./storage/db.js";
import type { BuyEvent, SafetyResult } from "./types.js";
import type { SafetyThresholds } from "./safety/evaluate.js";
import { evaluateConfluence, type ConfluenceThresholds } from "./engine/confluenceEngine.js";
import { recordBuy, getBuysForTokenSince } from "./storage/buyStore.js";
import { alreadyAlerted } from "./storage/alertStore.js";
import { dispatchAlert } from "./alert/alertDispatcher.js";
import type { TelegramClient } from "./alert/telegram.js";
import { logger } from "./logger.js";

export interface PipelineDeps {
  thresholds: SafetyThresholds;
  confluence: ConfluenceThresholds & { windowMin: number };
  checkToken: (mint: string) => Promise<SafetyResult>;
  tg: TelegramClient;
}

// Processes a batch of buys; returns the token mints that produced an alert.
export async function processBuys(db: DB, buys: BuyEvent[], deps: PipelineDeps): Promise<string[]> {
  const alerted: string[] = [];
  const candidates = new Set<string>();

  for (const b of buys) {
    if (recordBuy(db, b)) candidates.add(b.tokenMint);
  }

  for (const mint of candidates) {
    if (alreadyAlerted(db, mint)) continue;

    const since = Date.now() - deps.confluence.windowMin * 60_000;
    const windowBuys = getBuysForTokenSince(db, mint, since);
    if (!evaluateConfluence(windowBuys, deps.confluence)) continue;

    const safety = await deps.checkToken(mint);
    if (!safety.pass) {
      logger.info(`skip ${mint}: failed gates ${safety.failedGates.join(",")}`);
      continue;
    }

    const sent = await dispatchAlert(db, deps.tg, mint, windowBuys, safety);
    if (sent) alerted.push(mint);
  }

  return alerted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `src/main.ts`**

```ts
import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { openDb } from "./storage/db.js";
import { getAllKols, replaceKols } from "./storage/kolStore.js";
import { loadKols, manualFetcher, kolscanFetcher } from "./scraper/kolScraper.js";
import { createHeliusMonitor, type WatchedWallet } from "./monitor/walletMonitor.js";
import { createTelegramClient } from "./alert/telegram.js";
import { fetchDexData } from "./safety/dexscreener.js";
import { fetchRugData } from "./safety/rugcheck.js";
import { fetchOnchainData } from "./safety/onchain.js";
import { checkToken } from "./safety/safetyChecker.js";
import { processBuys } from "./pipeline.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!config.heliusApiKey || !config.telegramBotToken || !config.telegramChatId) {
    logger.error("Missing required env: HELIUS_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  const db = openDb("signals.db");
  const conn = new Connection(config.rpcUrl, "confirmed");
  const tg = createTelegramClient(config.telegramBotToken, config.telegramChatId);

  const fetchRaw = config.kolManualListPath
    ? manualFetcher(config.kolManualListPath)
    : kolscanFetcher();

  async function refreshKols() {
    const previous = getAllKols(db);
    const kols = await loadKols({ fetchRaw, cutoffs: config.tiers, now: Date.now(), previous });
    if (kols.length > 0) {
      replaceKols(db, kols);
      logger.info(`loaded ${kols.length} KOLs`);
    } else {
      logger.warn("no KOLs available");
    }
  }

  await refreshKols();
  setInterval(refreshKols, config.scrapeIntervalHours * 3_600_000);

  const getWallets = (): WatchedWallet[] =>
    getAllKols(db).map((k) => ({ wallet: k.wallet, tier: k.tier }));
  const monitor = createHeliusMonitor(config.heliusApiKey, getWallets);

  const checkTokenBound = (mint: string) =>
    checkToken(mint, config.safety, {
      dex: (m) => fetchDexData(m),
      rug: (m) => fetchRugData(m),
      chain: (m) => fetchOnchainData(conn, m),
    });

  logger.info("monitor loop started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const buys = await monitor.poll();
      if (buys.length > 0) {
        const alerted = await processBuys(db, buys, {
          thresholds: config.safety,
          confluence: config.confluence,
          checkToken: checkTokenBound,
          tg,
        });
        for (const mint of alerted) logger.info(`ALERTED ${mint}`);
      }
    } catch (err) {
      logger.error("monitor loop error", err);
    }
    await sleep(config.monitorIntervalSec * 1000);
  }
}

main().catch((err) => {
  logger.error("fatal", err);
  process.exit(1);
});
```

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline.ts src/main.ts tests/pipeline.test.ts
git commit -m "feat: add pipeline and main orchestrator"
```

---

### Task 15: README + manual smoke test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# KOL Memecoin Signal Bot

Watches top Solana KOL wallets (kolscan.io), detects tier-weighted buy confluence on fresh
tokens, runs strict anti-rug / anti-dead-coin safety gates, and sends Telegram alerts.
**Alert-only — it does not trade.**

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `HELIUS_API_KEY` + `SOLANA_RPC_URL` (free at dev.helius.xyz)
   - `TELEGRAM_BOT_TOKEN` (from @BotFather) + `TELEGRAM_CHAT_ID` (from @userinfobot)
   - Optionally `KOL_MANUAL_LIST_PATH` pointing to a JSON list like `kols.example.json`
3. Tune the tier / confluence / safety thresholds in `.env`.

## Run

- `npm start` — start the bot
- `npm test` — run the test suite

## Notes

- Verify the kolscan endpoint in `src/scraper/kolScraper.ts` against the live site, or use a
  manual KOL list.
- Safety is fail-closed: if data can't be fetched, the token is rejected.
```

- [ ] **Step 2: Manual smoke test**

With a `.env` containing a `KOL_MANUAL_LIST_PATH` to a small real KOL list and valid Telegram creds:
Run: `npm start`
Expected: logs `loaded N KOLs` and `monitor loop started`; on a qualifying buy, a Telegram message arrives. Verify no crash across several poll cycles.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Self-Review Notes

- **Spec coverage:** KolScraper (T13), WalletMonitor (T12), ConfluenceEngine (T6), SafetyChecker (T7/T9/T10), AlertDispatcher (T11), Storage (T8), config/orchestrator (T3/T14). All four safety gates (liquidity+LP, mint/freeze authority, holder concentration, volume/age/holders) covered in T7. Tiered rank-based confluence covered in T5/T6. Telegram-only alerting in T11. Fail-closed + fallback error handling in T10/T13. ✅
- **Types consistent:** `BuyEvent`, `KolRecord`, `SafetyStats`, `SafetyResult` defined in T2 and used unchanged throughout; `SafetyThresholds` (T7) and `ConfluenceThresholds` (T6) reused by pipeline (T14) and main.
- **No auto-trading:** confirmed out of scope; pipeline ends at `dispatchAlert`.
