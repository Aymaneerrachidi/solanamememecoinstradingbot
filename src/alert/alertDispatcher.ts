import type { DB } from "../storage/db.js";
import type { SafetyResult, Tier } from "../types.js";
import type { DexData } from "../safety/dexscreener.js";
import type { SignalLevel } from "../engine/signalLevels.js";
import type { TelegramClient } from "./telegram.js";
import { alreadyAlerted, recordAlert } from "../storage/alertStore.js";

export interface KolView {
  name: string;
  rank: number;
  tier: Tier;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function compactUsd(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n) || n <= 0) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n).toString();
}

function tokenLabel(tokenMint: string, info: DexData): string {
  if (info.symbol) {
    const name = info.name && info.name !== info.symbol ? ` — ${esc(info.name)}` : "";
    return `<b>$${esc(info.symbol)}</b>${name}`;
  }
  return `<code>${tokenMint.slice(0, 8)}…</code>`;
}

const chart = (mint: string) => `https://dexscreener.com/solana/${mint}`;
const tierEmoji: Record<Tier, string> = { S: "🥇", A: "🥈", B: "🥉" };

// A single KOL buy — sent the first time a KOL buys a token. No safety filtering.
export function formatBuy(tokenMint: string, kol: KolView, info: DexData): string {
  return [
    `🟢 <b>KOL BUY</b> · ${tierEmoji[kol.tier]} ${kol.tier}-tier`,
    ``,
    `👤 <b>${esc(kol.name)}</b> · rank #${kol.rank}`,
    `🪙 ${tokenLabel(tokenMint, info)}`,
    `💰 MC ${compactUsd(info.marketCapUsd)}  ·  💧 Liq ${compactUsd(info.liquidityUsd)}`,
    ``,
    `📋 <b>Contract</b> (tap to copy):`,
    `<code>${tokenMint}</code>`,
    ``,
    `📊 <a href="${chart(tokenMint)}">DexScreener chart</a>`,
  ].join("\n");
}

// Multiple KOLs converged on the same token within a window AND it passed safety.
export function formatSignal(
  tokenMint: string,
  kols: KolView[],
  level: SignalLevel,
  safety: SafetyResult,
  info: DexData
): string {
  const s = safety.stats;
  const who = kols.map((k) => ` • <b>${esc(k.name)}</b> (#${k.rank} · ${k.tier})`).join("\n");
  return [
    `${level.label} <b>SIGNAL</b>`,
    `⚡ ${kols.length} KOLs bought within ${level.windowMin} min`,
    ``,
    `🪙 ${tokenLabel(tokenMint, info)}`,
    `💰 MC ${compactUsd(info.marketCapUsd)}  ·  💧 Liq ${compactUsd(s.liquidityUsd)}`,
    `📈 Vol 24h ${compactUsd(s.volume24hUsd)}  ·  🎂 ${Math.round(s.ageMinutes)}m  ·  👑 Top10 ${s.top10HolderPct.toFixed(0)}%`,
    `🔒 LP ${s.lpBurnedOrLocked ? "✅" : "❌"}  ·  Mint ${s.mintAuthorityRevoked ? "✅" : "❌"}  ·  Freeze ${s.freezeAuthorityRevoked ? "✅" : "❌"}`,
    ``,
    `👥 <b>KOLs in (${kols.length}):</b>`,
    who,
    ``,
    `📋 <b>Contract</b> (tap to copy):`,
    `<code>${tokenMint}</code>`,
    ``,
    `📊 <a href="${chart(tokenMint)}">DexScreener chart</a>`,
  ].join("\n");
}

// Sends a per-buy notification. Dedup is handled by the pipeline.
export async function dispatchBuy(
  tg: TelegramClient,
  tokenMint: string,
  kol: KolView,
  info: DexData
): Promise<void> {
  await tg.send(formatBuy(tokenMint, kol, info));
}

// Sends one alert per (token, level) — so a coin can re-alert as it climbs the ladder,
// but never repeats the same level. Returns false if this level already fired.
export async function dispatchSignal(
  db: DB,
  tg: TelegramClient,
  tokenMint: string,
  kols: KolView[],
  level: SignalLevel,
  safety: SafetyResult,
  info: DexData
): Promise<boolean> {
  const key = `${tokenMint}#${level.level}`;
  if (alreadyAlerted(db, key)) return false;
  await tg.send(formatSignal(tokenMint, kols, level, safety, info));
  recordAlert(db, key, Date.now());
  return true;
}
