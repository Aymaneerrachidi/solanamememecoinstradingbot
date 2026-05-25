import type { DB } from "../storage/db.js";
import type { SafetyResult, Tier } from "../types.js";
import type { TelegramClient } from "./telegram.js";
import { alreadyAlerted, recordAlert } from "../storage/alertStore.js";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export interface KolView {
  name: string;
  rank: number;
  tier: Tier;
}

// A single KOL buy — sent for every detected buy, no safety filtering.
export function formatBuy(tokenMint: string, kol: KolView): string {
  return [
    `📥 *KOL Buy* — ${kol.tier}-tier`,
    `${kol.name} (rank #${kol.rank} · ${kol.tier})`,
    `Token: \`${tokenMint}\``,
    `📊 https://dexscreener.com/solana/${tokenMint}`,
  ].join("\n");
}

// Multiple KOLs converged on the same token AND it passed safety.
export function formatStrongAlert(
  tokenMint: string,
  kols: KolView[],
  label: string,
  safety: SafetyResult
): string {
  const who = kols.map((k) => `${k.name} (#${k.rank} ${k.tier})`).join(" + ");
  const s = safety.stats;
  return [
    `🚀🚀 *STRONG SIGNAL* — ${label}`,
    ``,
    `*Token:* \`${tokenMint}\``,
    `*KOLs in:* ${who}`,
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

// Sends a per-buy notification. No dedup here — the pipeline dedups by signature.
export async function dispatchBuy(tg: TelegramClient, tokenMint: string, kol: KolView): Promise<void> {
  await tg.send(formatBuy(tokenMint, kol));
}

// Sends one strong alert per token (deduped via the alerts table).
export async function dispatchStrong(
  db: DB,
  tg: TelegramClient,
  tokenMint: string,
  kols: KolView[],
  label: string,
  safety: SafetyResult
): Promise<boolean> {
  if (alreadyAlerted(db, tokenMint)) return false;
  await tg.send(formatStrongAlert(tokenMint, kols, label, safety));
  recordAlert(db, tokenMint, Date.now());
  return true;
}
