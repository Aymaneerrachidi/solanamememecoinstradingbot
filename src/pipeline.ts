import type { DB } from "./storage/db.js";
import type { BuyEvent, SafetyResult, Tier } from "./types.js";
import type { SafetyThresholds } from "./safety/evaluate.js";
import {
  evaluateConfluence,
  countDistinctByTier,
  distinctCount,
  summarizeTiers,
  type ConfluenceThresholds,
} from "./engine/confluenceEngine.js";
import { recordBuy, getBuysForTokenSince, countBuysByWalletToken } from "./storage/buyStore.js";
import { alreadyAlerted } from "./storage/alertStore.js";
import { getKol } from "./storage/kolStore.js";
import { dispatchBuy, dispatchStrong, type KolView } from "./alert/alertDispatcher.js";
import type { TelegramClient } from "./alert/telegram.js";
import { logger } from "./logger.js";

export interface PipelineDeps {
  thresholds: SafetyThresholds;
  confluence: ConfluenceThresholds & { windowMin: number };
  checkToken: (mint: string) => Promise<SafetyResult>;
  tg: TelegramClient;
}

export interface PipelineResult {
  buysSent: number;
  strongSent: string[];
}

const TIER_ORDER: Record<Tier, number> = { S: 3, A: 2, B: 1 };

function kolView(db: DB, buy: BuyEvent): KolView {
  const k = getKol(db, buy.kolWallet);
  if (k) return { name: k.name, rank: k.rank, tier: k.tier };
  return { name: buy.kolWallet.slice(0, 6), rank: 0, tier: buy.tier };
}

export async function processBuys(
  db: DB,
  buys: BuyEvent[],
  deps: PipelineDeps
): Promise<PipelineResult> {
  const strongSent: string[] = [];
  let buysSent = 0;
  const candidates = new Set<string>();

  // 1) Record every new buy; notify only the FIRST time a KOL buys a given token
  //    (KOLs often scale in over several txs — we don't want a message for each).
  for (const b of buys) {
    if (!recordBuy(db, b)) continue; // dedup by signature
    candidates.add(b.tokenMint);
    if (countBuysByWalletToken(db, b.kolWallet, b.tokenMint) > 1) continue; // already notified this pair
    await dispatchBuy(deps.tg, b.tokenMint, kolView(db, b));
    buysSent++;
  }

  // 2) Tokens where 2+ distinct KOLs converged → safety-checked strong alert.
  for (const mint of candidates) {
    if (alreadyAlerted(db, mint)) continue;

    const since = Date.now() - deps.confluence.windowMin * 60_000;
    const windowBuys = getBuysForTokenSince(db, mint, since);
    const counts = countDistinctByTier(windowBuys);
    const isStrong = distinctCount(counts) >= 2 && evaluateConfluence(windowBuys, deps.confluence);
    if (!isStrong) continue;

    const safety = await deps.checkToken(mint);
    if (!safety.pass) {
      logger.info(`strong candidate ${mint} failed safety: ${safety.failedGates.join(",")}`);
      continue;
    }

    // Distinct KOLs (highest tier per wallet), sorted strongest first.
    const best = new Map<string, BuyEvent>();
    for (const b of windowBuys) {
      const cur = best.get(b.kolWallet);
      if (!cur || TIER_ORDER[b.tier] > TIER_ORDER[cur.tier]) best.set(b.kolWallet, b);
    }
    const kols = [...best.values()]
      .map((b) => kolView(db, b))
      .sort((a, c) => TIER_ORDER[c.tier] - TIER_ORDER[a.tier] || a.rank - c.rank);

    const sent = await dispatchStrong(db, deps.tg, mint, kols, summarizeTiers(counts), safety);
    if (sent) strongSent.push(mint);
  }

  return { buysSent, strongSent };
}
