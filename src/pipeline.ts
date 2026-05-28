import type { DB } from "./storage/db.js";
import type { BuyEvent, SafetyResult, Tier } from "./types.js";
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
import { dispatchBuy, dispatchSignal, dispatchMultiplier, type KolView } from "./alert/alertDispatcher.js";
import type { TelegramClient } from "./alert/telegram.js";
import type { DexData } from "./safety/dexscreener.js";
import { logger } from "./logger.js";

export interface PipelineDeps {
  signalLevels: SignalLevel[];
  individualBuyTiers: Set<Tier>; // tiers that notify on every buy ("" = ladder-only)
  checkToken: (mint: string) => Promise<SafetyResult>;
  tokenInfo: (mint: string) => Promise<DexData>;
  tg: TelegramClient;
}

export interface PipelineResult {
  buysSeen: number; // distinct new buys recorded (regardless of notification)
  buysSent: number; // individual-buy messages actually sent
  signalsSent: string[]; // "mint#level" keys that fired
}

const TIER_ORDER: Record<Tier, number> = { S: 3, A: 2, B: 1 };

function kolView(db: DB, buy: BuyEvent): KolView {
  const k = getKol(db, buy.kolWallet);
  if (k) return { name: k.name, rank: k.rank, tier: k.tier, winRate: k.winRate, pnl: k.pnl, appearances: k.appearances };
  return { name: buy.kolWallet.slice(0, 6), rank: 0, tier: buy.tier, winRate: 0, pnl: 0, appearances: 0 };
}

// Distinct KOL wallets that bought this token within the last `windowMin` minutes.
function distinctKolsWithin(db: DB, mint: string, windowMin: number): number {
  const since = Date.now() - windowMin * 60_000;
  return distinctCount(countDistinctByTier(getBuysForTokenSince(db, mint, since)));
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

  // 1) Record every new buy. Optionally notify on the FIRST time a KOL buys a given token,
  //    but only for the tiers configured in `individualBuyTiers` (blank = ladder-only).
  for (const b of buys) {
    if (!recordBuy(db, b)) continue; // dedup by signature
    candidates.add(b.tokenMint);
    buysSeen++;
    if (!deps.individualBuyTiers.has(b.tier)) continue;
    if (countBuysByWalletToken(db, b.kolWallet, b.tokenMint) > 1) continue;
    const info = await deps.tokenInfo(b.tokenMint);
    await dispatchBuy(deps.tg, b.tokenMint, kolView(db, b), info);
    buysSent++;
  }

  // 2) Evaluate the signal ladder for each touched token; fire the strongest new level.
  for (const mint of candidates) {
    const level = detectSignalLevel(deps.signalLevels, (w) => distinctKolsWithin(db, mint, w));
    if (!level) continue;
    if (alreadyAlerted(db, `${mint}#${level.level}`)) continue;

    const safety = await deps.checkToken(mint);
    if (!safety.pass) {
      logger.info(`${level.label} candidate ${mint} failed safety: ${safety.failedGates.join(",")}`);
      continue;
    }

    // Distinct KOLs within the level's window, sorted strongest first.
    const windowBuys = getBuysForTokenSince(db, mint, Date.now() - level.windowMin * 60_000);
    const best = new Map<string, BuyEvent>();
    for (const b of windowBuys) {
      const cur = best.get(b.kolWallet);
      if (!cur || TIER_ORDER[b.tier] > TIER_ORDER[cur.tier]) best.set(b.kolWallet, b);
    }
    const kols = [...best.values()]
      .map((b) => kolView(db, b))
      .sort((a, c) => TIER_ORDER[c.tier] - TIER_ORDER[a.tier] || a.rank - c.rank);

    const info = await deps.tokenInfo(mint);
    const sent = await dispatchSignal(db, deps.tg, mint, kols, level, safety, info);
    if (sent) {
      signalsSent.push(`${mint}#${level.level}`);
      // Start tracking this coin for x2/x5/x10... performance alerts (baseline = MC now).
      trackToken(db, {
        tokenMint: mint,
        symbol: info.symbol,
        name: info.name,
        baselineMcUsd: safety.stats.marketCapUsd || info.marketCapUsd || 0,
        ts: Date.now(),
      });
    }
  }

  return { buysSeen, buysSent, signalsSent };
}

export interface MultiplierDeps {
  tokenInfo: (mint: string) => Promise<DexData>;
  tg: TelegramClient;
  milestones: number[];
  trackDays: number;
}

// Checks every tracked coin's current market cap against its flag-time baseline and pings
// when it crosses a new x-milestone. Prunes coins older than `trackDays`. Returns fired keys.
export async function checkMultipliers(db: DB, deps: MultiplierDeps): Promise<string[]> {
  const fired: string[] = [];
  const maxAgeMs = deps.trackDays * 86_400_000;
  const now = Date.now();

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
