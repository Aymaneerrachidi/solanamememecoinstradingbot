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
  winRate: number; // 0-1
  pnl: number; // SOL
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

function formatPrice(p?: number): string {
  if (!p || Number.isNaN(p)) return "—";
  if (p >= 1) return "$" + p.toFixed(3);
  if (p >= 0.0001) return "$" + p.toFixed(6);
  return "$" + p.toPrecision(3); // tiny prices keep significant figures
}

function pct(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  return ` (24h ${n >= 0 ? "+" : ""}${n.toFixed(0)}%)`;
}

function tokenLabel(tokenMint: string, info: DexData): string {
  if (info.symbol) {
    const name = info.name && info.name !== info.symbol ? ` — ${esc(info.name)}` : "";
    return `<b>$${esc(info.symbol)}</b>${name}`;
  }
  return `<code>${tokenMint.slice(0, 8)}…</code>`;
}

const tierEmoji: Record<Tier, string> = { S: "🥇", A: "🥈", B: "🥉" };
const wr = (w: number) => `${Math.round((w ?? 0) * 100)}% WR`;
const sol = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)} SOL`;

// Quick-action link rows (chart / trade / explorer).
function linkRows(mint: string): string[] {
  return [
    `🔗 <a href="https://dexscreener.com/solana/${mint}">DexScreener</a> · ` +
      `<a href="https://gmgn.ai/sol/token/${mint}">GMGN</a> · ` +
      `<a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>`,
    `🛒 <a href="https://axiom.trade/t/${mint}">Axiom</a> · ` +
      `<a href="https://pump.fun/${mint}">Pump.fun</a> · ` +
      `<a href="https://solscan.io/token/${mint}">Solscan</a>`,
  ];
}

function tokenStatsLines(info: DexData, s: SafetyResult["stats"]): string[] {
  return [
    `💵 ${formatPrice(info.priceUsd)}${pct(info.priceChangeH24)}`,
    `💰 MC ${compactUsd(s.marketCapUsd || info.marketCapUsd)}  ·  💧 Liq ${compactUsd(s.liquidityUsd)}`,
    `📈 Vol 24h ${compactUsd(s.volume24hUsd)}  ·  🎂 ${Math.round(s.ageMinutes)}m  ·  👑 Top10 ${s.top10HolderPct.toFixed(0)}%`,
    `🔒 LP ${s.lpBurnedOrLocked ? "✅" : "❌"}  ·  Mint ${s.mintAuthorityRevoked ? "✅" : "❌"}  ·  Freeze ${s.freezeAuthorityRevoked ? "✅" : "❌"}`,
  ];
}

// A single KOL buy — sent the first time a KOL buys a token. No safety filtering.
export function formatBuy(tokenMint: string, kol: KolView, info: DexData): string {
  return [
    `🟢 <b>KOL BUY</b> · ${tierEmoji[kol.tier]} ${kol.tier}-tier`,
    ``,
    `👤 <b>${esc(kol.name)}</b> · #${kol.rank} · ${wr(kol.winRate)} · ${sol(kol.pnl)}`,
    `🪙 ${tokenLabel(tokenMint, info)}`,
    `💵 ${formatPrice(info.priceUsd)}${pct(info.priceChangeH24)}`,
    `💰 MC ${compactUsd(info.marketCapUsd)}  ·  💧 Liq ${compactUsd(info.liquidityUsd)}  ·  📈 Vol ${compactUsd(info.volume24hUsd)}`,
    `🎂 ${Math.round(info.ageMinutes)}m old`,
    ``,
    `📋 <b>Contract</b> (tap to copy):`,
    `<code>${tokenMint}</code>`,
    ``,
    ...linkRows(tokenMint),
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
  const who = kols
    .map((k) => ` • <b>${esc(k.name)}</b> (#${k.rank} · ${k.tier} · ${wr(k.winRate)})`)
    .join("\n");
  return [
    `${level.label} <b>SIGNAL</b>`,
    `⚡ ${kols.length} KOLs bought within ${level.windowMin} min`,
    ``,
    `🪙 ${tokenLabel(tokenMint, info)}`,
    ...tokenStatsLines(info, safety.stats),
    ``,
    `👥 <b>KOLs in (${kols.length}):</b>`,
    who,
    ``,
    `📋 <b>Contract</b> (tap to copy):`,
    `<code>${tokenMint}</code>`,
    ``,
    ...linkRows(tokenMint),
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
