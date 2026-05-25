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
