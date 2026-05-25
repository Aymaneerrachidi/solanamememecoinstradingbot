import type { DB } from "./storage/db.js";
import type { BuyEvent, SafetyResult, Tier } from "./types.js";
import type { SafetyThresholds } from "./safety/evaluate.js";
import { countDistinctByTier, distinctCount } from "./engine/confluenceEngine.js";
import { detectSignalLevel, type SignalLevel } from "./engine/signalLevels.js";
import { recordBuy, getBuysForTokenSince, countBuysByWalletToken } from "./storage/buyStore.js";
import { alreadyAlerted } from "./storage/alertStore.js";
import { getKol } from "./storage/kolStore.js";
import { dispatchBuy, dispatchSignal, type KolView } from "./alert/alertDispatcher.js";
import type { TelegramClient } from "./alert/telegram.js";
import type { DexData } from "./safety/dexscreener.js";
import { logger } from "./logger.js";

export interface PipelineDeps {
  thresholds: SafetyThresholds;
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
  if (k) return { name: k.name, rank: k.rank, tier: k.tier };
  return { name: buy.kolWallet.slice(0, 6), rank: 0, tier: buy.tier };
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
    if (sent) signalsSent.push(`${mint}#${level.level}`);
  }

  return { buysSeen, buysSent, signalsSent };
}
