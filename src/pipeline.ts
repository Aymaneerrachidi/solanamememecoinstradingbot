import type { DB } from "./storage/db.js";
import type { BuyEvent, KolRecord, SafetyResult, SellEvent, Tier } from "./types.js";
import { countDistinctByTier, distinctCount } from "./engine/confluenceEngine.js";
import { detectSignalLevel, type SignalLevel } from "./engine/signalLevels.js";
import { recordBuy, getBuysForTokenSince, countBuysByWalletToken } from "./storage/buyStore.js";
import { alreadyAlerted } from "./storage/alertStore.js";
import { getKol } from "./storage/kolStore.js";
import {
  trackToken,
  getTrackedTokens,
  updateTrackProgress,
  untrackToken,
} from "./storage/trackedTokenStore.js";
import { detectMultiplierMilestone } from "./engine/multiplier.js";
import {
  recordSignalOutcome,
  getActiveOutcomes,
  updateOutcomePeak,
  markRugged,
  recordMarker,
  MARKERS,
} from "./storage/outcomeStore.js";
import {
  recordSell,
  countDistinctSellersForToken,
  getDistinctSellerWallets,
  alreadyExitAlerted,
  recordExitAlert,
} from "./storage/sellStore.js";
import {
  dispatchBuy,
  dispatchSignal,
  dispatchMultiplier,
  dispatchExit,
  type KolView,
} from "./alert/alertDispatcher.js";
import type { TelegramClient } from "./alert/telegram.js";
import type { DexData } from "./safety/dexscreener.js";
import { logger } from "./logger.js";

export interface PipelineDeps {
  signalLevels: SignalLevel[];
  individualBuyTiers: Set<Tier>;
  checkToken: (mint: string) => Promise<SafetyResult>;
  tokenInfo: (mint: string) => Promise<DexData>;
  tg: TelegramClient;
}

export interface PipelineResult {
  buysSeen: number;
  buysSent: number;
  signalsSent: string[];
}

const TIER_ORDER: Record<Tier, number> = { S: 3, A: 2, B: 1 };

function kolView(db: DB, wallet: string, fallbackTier: Tier): KolView {
  const k = getKol(db, wallet);
  if (k) return { name: k.name, rank: k.rank, tier: k.tier, winRate: k.winRate, pnl: k.pnl, appearances: k.appearances };
  return { name: wallet.slice(0, 6), rank: 0, tier: fallbackTier, winRate: 0, pnl: 0, appearances: 0 };
}

function kolViewFromRecord(k: KolRecord): KolView {
  return { name: k.name, rank: k.rank, tier: k.tier, winRate: k.winRate, pnl: k.pnl, appearances: k.appearances };
}

export async function processBuys(
  db: DB,
  buys: BuyEvent[],
  deps: PipelineDeps
): Promise<PipelineResult> {
  const signalsSent: string[] = [];
  let buysSeen = 0;
  let buysSent = 0;
  const candidates = new Set<string>();

  // 1) Record buys; optionally notify per-buy (only configured tiers).
  for (const b of buys) {
    if (!recordBuy(db, b)) continue;
    candidates.add(b.tokenMint);
    buysSeen++;
    if (!deps.individualBuyTiers.has(b.tier)) continue;
    if (countBuysByWalletToken(db, b.kolWallet, b.tokenMint) > 1) continue;
    const info = await deps.tokenInfo(b.tokenMint);
    await dispatchBuy(deps.tg, b.tokenMint, kolView(db, b.kolWallet, b.tier), info);
    buysSent++;
  }

  // 2) Evaluate the signal ladder for each touched token.
  for (const mint of candidates) {
    const level = detectSignalLevel(deps.signalLevels, (w) => {
      const since = Date.now() - w * 60_000;
      return distinctCount(countDistinctByTier(getBuysForTokenSince(db, mint, since)));
    });
    if (!level) continue;
    if (alreadyAlerted(db, `${mint}#${level.level}`)) continue;

    const safety = await deps.checkToken(mint);
    if (!safety.pass) {
      logger.info(`${level.label} candidate ${mint} failed safety: ${safety.failedGates.join(",")}`);
      continue;
    }

    // Build sorted KOL list from the level's window.
    const windowBuys = getBuysForTokenSince(db, mint, Date.now() - level.windowMin * 60_000);
    const best = new Map<string, BuyEvent>();
    for (const b of windowBuys) {
      const cur = best.get(b.kolWallet);
      if (!cur || TIER_ORDER[b.tier] > TIER_ORDER[cur.tier]) best.set(b.kolWallet, b);
    }
    const kols = [...best.values()]
      .map((b) => kolView(db, b.kolWallet, b.tier))
      .sort((a, c) => TIER_ORDER[c.tier] - TIER_ORDER[a.tier] || a.rank - c.rank);

    const info = await deps.tokenInfo(mint);
    const sent = await dispatchSignal(db, deps.tg, mint, kols, level, safety, info);
    if (sent) {
      const signalKey = `${mint}#${level.level}`;
      const now = Date.now();
      const baselineMc = safety.stats.marketCapUsd || info.marketCapUsd || 0;
      signalsSent.push(signalKey);

      // Multiplier alerts: track baseline MC.
      trackToken(db, {
        tokenMint: mint,
        symbol: info.symbol,
        name: info.name,
        baselineMcUsd: baselineMc,
        ts: now,
      });

      // Outcome analytics: record baseline; markers fill on later progress checks.
      recordSignalOutcome(db, {
        signalKey,
        tokenMint: mint,
        symbol: info.symbol,
        name: info.name,
        signalTs: now,
        signalLevel: level.level,
        signalLabel: level.label,
        kolCount: kols.length,
        baselineMcUsd: baselineMc,
        baselineLiqUsd: safety.stats.liquidityUsd || info.liquidityUsd,
        baselinePriceUsd: info.priceUsd,
      });
    }
  }

  return { buysSeen, buysSent, signalsSent };
}

export interface SellDeps {
  tokenInfo: (mint: string) => Promise<DexData>;
  tg: TelegramClient;
  exitSellerThreshold: number; // distinct sellers needed for an exit alert
}

export interface SellResult {
  sellsSeen: number;
  exitsSent: string[];
}

// Records sells of SIGNALED tokens (anything currently in tracked_tokens) and fires an exit
// alert when distinct sellers crosses the threshold (deduped per token+seller-count).
export async function processSells(db: DB, sells: SellEvent[], deps: SellDeps): Promise<SellResult> {
  const exitsSent: string[] = [];
  let sellsSeen = 0;

  // Build a quick lookup of which mints we care about (already-signaled coins).
  const trackedMints = new Set(getTrackedTokens(db).map((t) => t.tokenMint));
  const touched = new Set<string>();

  for (const s of sells) {
    if (!trackedMints.has(s.tokenMint)) continue;
    if (!recordSell(db, s)) continue;
    sellsSeen++;
    touched.add(s.tokenMint);
  }

  for (const mint of touched) {
    const count = countDistinctSellersForToken(db, mint);
    if (count < deps.exitSellerThreshold) continue;

    const dedupKey = `${mint}#${count}`;
    if (alreadyExitAlerted(db, dedupKey)) continue;

    const sellerWallets = getDistinctSellerWallets(db, mint);
    const sellers: KolView[] = sellerWallets
      .map((w) => {
        const k = getKol(db, w);
        return k ? kolViewFromRecord(k) : null;
      })
      .filter((v): v is KolView => v !== null)
      .sort((a, c) => TIER_ORDER[c.tier] - TIER_ORDER[a.tier] || a.rank - c.rank);

    let info: DexData;
    try {
      info = await deps.tokenInfo(mint);
    } catch {
      continue;
    }
    const tracked = getTrackedTokens(db).find((t) => t.tokenMint === mint);
    const peakMc = tracked ? tracked.baselineMcUsd * tracked.peakMult : 0;

    await dispatchExit(deps.tg, mint, sellers, info, peakMc);
    recordExitAlert(db, dedupKey, Date.now());
    exitsSent.push(dedupKey);
  }

  return { sellsSeen, exitsSent };
}

export interface MultiplierDeps {
  tokenInfo: (mint: string) => Promise<DexData>;
  tg: TelegramClient;
  milestones: number[];
  trackDays: number;
}

// Unified per-cycle progress check: fetches each tracked token once, then updates BOTH the
// multiplier-tracking record (and fires x-milestone alerts) AND the signal-outcomes record
// (fills due markers, updates peak, flags rugs). One DexScreener call per token per cycle.
export async function checkMultipliers(db: DB, deps: MultiplierDeps): Promise<string[]> {
  const fired: string[] = [];
  const maxAgeMs = deps.trackDays * 86_400_000;
  const now = Date.now();
  const activeOutcomes = getActiveOutcomes(db, now);
  const outcomesByMint = new Map<string, typeof activeOutcomes>();
  for (const o of activeOutcomes) {
    const arr = outcomesByMint.get(o.tokenMint) ?? [];
    arr.push(o);
    outcomesByMint.set(o.tokenMint, arr);
  }

  for (const t of getTrackedTokens(db)) {
    if (now - t.baselineTs > maxAgeMs) {
      untrackToken(db, t.tokenMint);
      continue;
    }
    let info: DexData;
    try {
      info = await deps.tokenInfo(t.tokenMint);
    } catch {
      continue;
    }

    // Signal-outcomes update for this mint (peak / rug / due markers) — no alerting.
    const outcomes = outcomesByMint.get(t.tokenMint) ?? [];
    for (const o of outcomes) {
      const currentMc = info.found ? info.marketCapUsd ?? 0 : 0;
      const currentLiq = info.found ? info.liquidityUsd ?? 0 : 0;
      if (currentMc > (o.peakMcUsd ?? 0)) updateOutcomePeak(db, o.signalKey, currentMc, now);

      // Rug heuristic: not found, OR liquidity down >80% from baseline, OR MC down >90%.
      const baseLiq = o.baselineLiqUsd ?? 0;
      const liqDrop = baseLiq > 0 ? 1 - currentLiq / baseLiq : 0;
      const mcDrop = o.baselineMcUsd > 0 ? 1 - currentMc / o.baselineMcUsd : 0;
      if (!o.ruggedAt && (!info.found || liqDrop >= 0.8 || mcDrop >= 0.9)) {
        markRugged(db, o.signalKey, now);
      }

      // Fill any due marker.
      const elapsed = now - o.signalTs;
      for (const m of MARKERS) {
        if (o[`fetched${m.key}`] === 1) continue;
        if (elapsed < m.offsetMs) continue;
        if (!info.found) continue;
        const mult = o.baselineMcUsd > 0 ? currentMc / o.baselineMcUsd : 0;
        recordMarker(db, o.signalKey, m.key, currentMc, currentLiq, mult);
      }
    }

    // Multiplier alerts.
    if (!info.found || !info.marketCapUsd) continue;
    const mult = info.marketCapUsd / t.baselineMcUsd;
    const peakMult = Math.max(t.peakMult, mult);
    const hit = detectMultiplierMilestone(info.marketCapUsd, t.baselineMcUsd, t.lastMilestone, deps.milestones);

    if (hit !== null) {
      await dispatchMultiplier(deps.tg, t.tokenMint, hit, t.baselineMcUsd, info);
      updateTrackProgress(db, t.tokenMint, hit, peakMult);
      fired.push(`${t.tokenMint}#x${hit}`);
    } else if (peakMult > t.peakMult) {
      updateTrackProgress(db, t.tokenMint, t.lastMilestone, peakMult);
    }
  }
  return fired;
}
