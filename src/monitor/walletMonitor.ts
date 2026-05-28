import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../logger.js";
import { recordFailure } from "../health/health.js";
import type { BuyEvent, SellEvent, Tier } from "../types.js";

// Tokens that don't represent a memecoin "buy" — receiving these usually means the KOL
// SOLD a token (got SOL/stablecoins back), so they must not count as buys.
const EXCLUDED_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minimal shape of a parsed transaction's token-balance metadata (subset of web3.js types).
interface TokenBalance {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
}
export interface ParsedTxLike {
  blockTime?: number | null;
  transaction?: { signatures?: string[] };
  meta?: {
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null;
}

interface BalanceDelta {
  buys: BuyEvent[];
  sells: SellEvent[];
}

// Walks pre/post token balances for a wallet; "buy" = balance up, "sell" = balance down.
export function parseDeltasFromParsedTx(tx: ParsedTxLike, wallet: string, tier: Tier): BalanceDelta {
  const result: BalanceDelta = { buys: [], sells: [] };
  const meta = tx.meta;
  const signature = tx.transaction?.signatures?.[0];
  if (!meta || !signature) return result;

  const ts = (tx.blockTime ?? 0) * 1000;
  const before = new Map<string, number>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner === wallet && b.mint) before.set(b.mint, Number(b.uiTokenAmount?.amount ?? 0));
  }

  // Walk post-balances for increases (buys) and pre-balances for decreases (sells).
  const seenBuys = new Set<string>();
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner !== wallet || !b.mint || EXCLUDED_MINTS.has(b.mint) || seenBuys.has(b.mint)) continue;
    const after = Number(b.uiTokenAmount?.amount ?? 0);
    if (after > (before.get(b.mint) ?? 0)) {
      seenBuys.add(b.mint);
      result.buys.push({ kolWallet: wallet, tier, tokenMint: b.mint, ts, signature });
    }
  }
  const postByMint = new Map<string, number>();
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner === wallet && b.mint) postByMint.set(b.mint, Number(b.uiTokenAmount?.amount ?? 0));
  }
  const seenSells = new Set<string>();
  for (const [mint, beforeAmt] of before) {
    if (EXCLUDED_MINTS.has(mint) || seenSells.has(mint)) continue;
    const afterAmt = postByMint.get(mint) ?? 0;
    if (afterAmt < beforeAmt) {
      seenSells.add(mint);
      result.sells.push({ kolWallet: wallet, tier, tokenMint: mint, ts, signature });
    }
  }
  return result;
}

// Kept for back-compat with existing callers/tests.
export function parseBuysFromParsedTx(tx: ParsedTxLike, wallet: string, tier: Tier): BuyEvent[] {
  return parseDeltasFromParsedTx(tx, wallet, tier).buys;
}

export interface PollResult {
  buys: BuyEvent[];
  sells: SellEvent[];
}

export interface WalletMonitor {
  poll(): Promise<PollResult>;
}

export interface WatchedWallet {
  wallet: string;
  tier: Tier;
}

// Standard-RPC polling: per wallet, fetch recent signatures, then fetch the parsed
// transaction for each new+recent one (single calls — batch RPC is paid-only on Helius).
// Seeding on first poll avoids a startup burst; `gapMs` spaces requests for rate limits.
export function createRpcMonitor(
  conn: Connection,
  getWallets: () => WatchedWallet[],
  gapMs = 200,
  lookbackMs = 10 * 60_000
): WalletMonitor {
  const lastSig = new Map<string, string>();
  return {
    async poll(): Promise<PollResult> {
      const buys: BuyEvent[] = [];
      const sells: SellEvent[] = [];
      const cutoff = Date.now() - lookbackMs;
      for (const w of getWallets()) {
        try {
          const pubkey = new PublicKey(w.wallet);
          const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 10 });
          if (gapMs > 0) await sleep(gapMs);

          const prevTop = lastSig.get(w.wallet);
          if (sigs.length > 0) lastSig.set(w.wallet, sigs[0].signature);

          // First time we see this wallet: seed its latest signature and skip the historical
          // backfill (avoids a large request burst on startup). React to new buys from here on.
          if (prevTop === undefined) continue;

          for (const s of sigs) {
            if (s.signature === prevTop) break; // reached already-processed history
            if (s.err) continue;
            if ((s.blockTime ?? 0) * 1000 < cutoff) continue; // too old to care about

            const tx = await conn.getParsedTransaction(s.signature, {
              maxSupportedTransactionVersion: 0,
            });
            if (tx) {
              const d = parseDeltasFromParsedTx(tx as ParsedTxLike, w.wallet, w.tier);
              buys.push(...d.buys);
              sells.push(...d.sells);
            }
            if (gapMs > 0) await sleep(gapMs);
          }
        } catch (err) {
          recordFailure("rpc");
          logger.warn(`monitor poll failed for ${w.wallet}`, err);
        }
      }
      return { buys, sells };
    },
  };
}
