import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../logger.js";
import type { BuyEvent, Tier } from "../types.js";

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

// A "buy" = a token whose balance for this wallet increased over the transaction.
export function parseBuysFromParsedTx(tx: ParsedTxLike, wallet: string, tier: Tier): BuyEvent[] {
  const meta = tx.meta;
  const signature = tx.transaction?.signatures?.[0];
  if (!meta || !signature) return [];

  const ts = (tx.blockTime ?? 0) * 1000;
  const before = new Map<string, number>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner === wallet && b.mint) before.set(b.mint, Number(b.uiTokenAmount?.amount ?? 0));
  }

  const buys: BuyEvent[] = [];
  const seen = new Set<string>();
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner !== wallet || !b.mint || EXCLUDED_MINTS.has(b.mint) || seen.has(b.mint)) continue;
    const after = Number(b.uiTokenAmount?.amount ?? 0);
    if (after > (before.get(b.mint) ?? 0)) {
      seen.add(b.mint);
      buys.push({ kolWallet: wallet, tier, tokenMint: b.mint, ts, signature });
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

// Standard-RPC polling: per wallet, fetch recent signatures, then BATCH-fetch the parsed
// transactions for the new+recent ones in a single request. Spacing requests by `gapMs`
// keeps us under the RPC rate limit (≈2 calls per wallet instead of 1-per-signature).
export function createRpcMonitor(
  conn: Connection,
  getWallets: () => WatchedWallet[],
  gapMs = 250,
  lookbackMs = 10 * 60_000
): WalletMonitor {
  const lastSig = new Map<string, string>();
  return {
    async poll(): Promise<BuyEvent[]> {
      const all: BuyEvent[] = [];
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

          // Collect only new (unseen), successful, recent signatures.
          const toFetch: string[] = [];
          for (const s of sigs) {
            if (s.signature === prevTop) break; // reached already-processed history
            if (s.err) continue;
            if ((s.blockTime ?? 0) * 1000 < cutoff) continue; // too old to care about
            toFetch.push(s.signature);
          }
          if (toFetch.length === 0) continue;

          // One batched request for all new signatures of this wallet.
          const txs = await conn.getParsedTransactions(toFetch, { maxSupportedTransactionVersion: 0 });
          for (const tx of txs) {
            if (tx) all.push(...parseBuysFromParsedTx(tx as ParsedTxLike, w.wallet, w.tier));
          }
          if (gapMs > 0) await sleep(gapMs);
        } catch (err) {
          logger.warn(`monitor poll failed for ${w.wallet}`, err);
        }
      }
      return all;
    },
  };
}
