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
