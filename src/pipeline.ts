import type { DB } from "./storage/db.js";
import type { BuyEvent, SafetyResult } from "./types.js";
import type { SafetyThresholds } from "./safety/evaluate.js";
import { evaluateConfluence, type ConfluenceThresholds } from "./engine/confluenceEngine.js";
import { recordBuy, getBuysForTokenSince } from "./storage/buyStore.js";
import { alreadyAlerted } from "./storage/alertStore.js";
import { dispatchAlert } from "./alert/alertDispatcher.js";
import type { TelegramClient } from "./alert/telegram.js";
import { logger } from "./logger.js";

export interface PipelineDeps {
  thresholds: SafetyThresholds;
  confluence: ConfluenceThresholds & { windowMin: number };
  checkToken: (mint: string) => Promise<SafetyResult>;
  tg: TelegramClient;
}

// Processes a batch of buys; returns the token mints that produced an alert.
export async function processBuys(db: DB, buys: BuyEvent[], deps: PipelineDeps): Promise<string[]> {
  const alerted: string[] = [];
  const candidates = new Set<string>();

  for (const b of buys) {
    if (recordBuy(db, b)) candidates.add(b.tokenMint);
  }

  for (const mint of candidates) {
    if (alreadyAlerted(db, mint)) continue;

    const since = Date.now() - deps.confluence.windowMin * 60_000;
    const windowBuys = getBuysForTokenSince(db, mint, since);
    if (!evaluateConfluence(windowBuys, deps.confluence)) continue;

    const safety = await deps.checkToken(mint);
    if (!safety.pass) {
      logger.info(`skip ${mint}: failed gates ${safety.failedGates.join(",")}`);
      continue;
    }

    const sent = await dispatchAlert(db, deps.tg, mint, windowBuys, safety);
    if (sent) alerted.push(mint);
  }

  return alerted;
}
