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
  appearances: number; // days on the leaderboard in the history window
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

function tokenLabel(tokenMint: string, info: DexData): string {
  if (info.symbol) {
    const name = info.name && info.name !== info.symbol ? ` — ${esc(info.name)}` : "";
    return `<b>$${esc(info.symbol)}</b>${name}`;
  }
  return `<code>${tokenMint.slice(0, 8)}…</code>`;
}

const tierEmoji: Record<Tier, string> = { S: "🥇", A: "🥈", B: "🥉" };
const sol = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}◎`;

function changePart(label: string, n?: number): string | null {
  if (n === undefined || n === null || Number.isNaN(n)) return null;
  return `${label} ${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}

// One compact line per KOL: rank, tier, win rate, PnL, days-on-board.
function kolLine(k: KolView): string {
  const days = k.appearances > 0 ? ` · 📅 ${k.appearances}d` : "";
  return ` • <b>${esc(k.name)}</b> #${k.rank}·${k.tier} · ${Math.round(k.winRate * 100)}% WR · ${sol(k.pnl)}${days}`;
}

// Quick-action link rows (chart / trade / explorer).
function linkRows(mint: string): string[] {
  return [
    `🔗 <a href="https://dexscreener.com/solana/${mint}">DexScreener</a> · ` +
      `<a href="https://gmgn.ai/sol/token/${mint}">GMGN</a> · ` +
      `<a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>`,
    `🛒 <a href="https://axiom.trade/t/${mint}">Axiom</a> · ` +
      `<a href="https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}">BullX</a> · ` +
      `<a href="https://pump.fun/${mint}">Pump.fun</a> · ` +
      `<a href="https://solscan.io/token/${mint}">Solscan</a>`,
  ];
}

function tokenStatsLines(info: DexData, s: SafetyResult["stats"]): string[] {
  const changes = [
    changePart("5m", info.priceChangeM5),
    changePart("1h", info.priceChangeH1),
    changePart("6h", info.priceChangeH6),
    changePart("24h", info.priceChangeH24),
  ].filter(Boolean);
  const txns =
    info.txns24Buys !== undefined || info.txns24Sells !== undefined
      ? `🔄 24h ${info.txns24Buys ?? 0} buys / ${info.txns24Sells ?? 0} sells`
      : null;

  return [
    `💵 ${formatPrice(info.priceUsd)}`,
    changes.length ? `📊 ${changes.join(" · ")}` : null,
    `💰 MC ${compactUsd(s.marketCapUsd || info.marketCapUsd)}  ·  💠 FDV ${compactUsd(info.fdvUsd)}`,
    `💧 Liq ${compactUsd(s.liquidityUsd)}  ·  📈 Vol24h ${compactUsd(s.volume24hUsd)}`,
    txns,
    `🎂 ${Math.round(s.ageMinutes)}m old  ·  👑 Top10 ${s.top10HolderPct.toFixed(0)}%`,
    `🔒 LP ${s.lpBurnedOrLocked ? "✅" : "❌"}  ·  Mint ${s.mintAuthorityRevoked ? "✅" : "❌"}  ·  Freeze ${s.freezeAuthorityRevoked ? "✅" : "❌"}`,
  ].filter((x): x is string => x !== null);
}

// Build a SafetyStats-like view from DexData alone (for individual buys, which skip safety).
function statsFromInfo(info: DexData): SafetyResult["stats"] {
  return {
    marketCapUsd: info.marketCapUsd ?? 0,
    liquidityUsd: info.liquidityUsd,
    lpBurnedOrLocked: false,
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    top10HolderPct: 0,
    volume24hUsd: info.volume24hUsd,
    ageMinutes: info.ageMinutes,
    holderCount: 0,
  };
}

// A single KOL buy — sent the first time a KOL buys a token. No safety filtering.
export function formatBuy(tokenMint: string, kol: KolView, info: DexData): string {
  const days = kol.appearances > 0 ? `  ·  📅 ${kol.appearances}d on board` : "";
  return [
    `🟢 <b>KOL BUY</b> · ${tierEmoji[kol.tier]} ${kol.tier}-tier`,
    ``,
    `👤 <b>${esc(kol.name)}</b> · #${kol.rank} · ${Math.round(kol.winRate * 100)}% WR · ${sol(kol.pnl)}${days}`,
    `🪙 ${tokenLabel(tokenMint, info)}`,
    ...tokenStatsLines(info, statsFromInfo(info)).filter((l) => !l.startsWith("🔒")),
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
  const who = kols.map(kolLine).join("\n");
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

// KOLs are exiting a signaled coin — sent when distinct sellers crosses a threshold.
export function formatExit(
  tokenMint: string,
  sellers: KolView[],
  info: DexData,
  peakMcUsd: number
): string {
  const who = sellers.map(kolLine).join("\n");
  const peakDelta =
    info.marketCapUsd && peakMcUsd > 0
      ? ` (peak ${compactUsd(peakMcUsd)} → now ${compactUsd(info.marketCapUsd)})`
      : "";
  return [
    `🔻 <b>${sellers.length} KOL${sellers.length > 1 ? "s" : ""} EXITED</b>${peakDelta}`,
    ``,
    `🪙 ${tokenLabel(tokenMint, info)}`,
    `💵 ${formatPrice(info.priceUsd)}`,
    `💰 MC ${compactUsd(info.marketCapUsd)}  ·  💧 Liq ${compactUsd(info.liquidityUsd)}`,
    ``,
    `👥 <b>Sold:</b>`,
    who,
    ``,
    `📋 <b>Contract</b>:`,
    `<code>${tokenMint}</code>`,
    ``,
    ...linkRows(tokenMint),
  ].join("\n");
}

export async function dispatchExit(
  tg: TelegramClient,
  tokenMint: string,
  sellers: KolView[],
  info: DexData,
  peakMcUsd: number
): Promise<void> {
  await tg.send(formatExit(tokenMint, sellers, info, peakMcUsd));
}

// A flagged coin reached a new x-milestone since it was first signalled.
export function formatMultiplier(
  tokenMint: string,
  milestone: number,
  baselineMcUsd: number,
  info: DexData
): string {
  return [
    `🚀📈 <b>${milestone}x</b> — ${tokenLabel(tokenMint, info)}`,
    `flagged at ${compactUsd(baselineMcUsd)} → now ${compactUsd(info.marketCapUsd)}`,
    ``,
    ...tokenStatsLines(info, statsFromInfo(info)).filter((l) => !l.startsWith("🔒")),
    ``,
    `📋 <b>Contract</b> (tap to copy):`,
    `<code>${tokenMint}</code>`,
    ``,
    ...linkRows(tokenMint),
  ].join("\n");
}

export async function dispatchMultiplier(
  tg: TelegramClient,
  tokenMint: string,
  milestone: number,
  baselineMcUsd: number,
  info: DexData
): Promise<void> {
  await tg.send(formatMultiplier(tokenMint, milestone, baselineMcUsd, info));
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
