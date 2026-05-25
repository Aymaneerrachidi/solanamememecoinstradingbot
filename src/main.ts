import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { openDb } from "./storage/db.js";
import { getAllKols, replaceKols } from "./storage/kolStore.js";
import { loadKols, manualFetcher, kolscanFetcher } from "./scraper/kolScraper.js";
import { createHeliusMonitor, type WatchedWallet } from "./monitor/walletMonitor.js";
import { createTelegramClient } from "./alert/telegram.js";
import { fetchDexData } from "./safety/dexscreener.js";
import { fetchRugData } from "./safety/rugcheck.js";
import { fetchOnchainData } from "./safety/onchain.js";
import { checkToken } from "./safety/safetyChecker.js";
import { processBuys } from "./pipeline.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!config.heliusApiKey || !config.telegramBotToken || !config.telegramChatId) {
    logger.error("Missing required env: HELIUS_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  const db = openDb("signals.db");
  const conn = new Connection(config.rpcUrl, "confirmed");
  const tg = createTelegramClient(config.telegramBotToken, config.telegramChatId);

  const fetchRaw = config.kolManualListPath
    ? manualFetcher(config.kolManualListPath)
    : kolscanFetcher();

  async function refreshKols() {
    const previous = getAllKols(db);
    const kols = await loadKols({ fetchRaw, cutoffs: config.tiers, now: Date.now(), previous });
    if (kols.length > 0) {
      replaceKols(db, kols);
      logger.info(`loaded ${kols.length} KOLs`);
    } else {
      logger.warn("no KOLs available");
    }
  }

  await refreshKols();
  setInterval(refreshKols, config.scrapeIntervalHours * 3_600_000);

  const getWallets = (): WatchedWallet[] =>
    getAllKols(db).map((k) => ({ wallet: k.wallet, tier: k.tier }));
  const monitor = createHeliusMonitor(config.heliusApiKey, getWallets);

  const checkTokenBound = (mint: string) =>
    checkToken(mint, config.safety, {
      dex: (m) => fetchDexData(m),
      rug: (m) => fetchRugData(m),
      chain: (m) => fetchOnchainData(conn, m),
    });

  logger.info("monitor loop started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const buys = await monitor.poll();
      if (buys.length > 0) {
        const alerted = await processBuys(db, buys, {
          thresholds: config.safety,
          confluence: config.confluence,
          checkToken: checkTokenBound,
          tg,
        });
        for (const mint of alerted) logger.info(`ALERTED ${mint}`);
      }
    } catch (err) {
      logger.error("monitor loop error", err);
    }
    await sleep(config.monitorIntervalSec * 1000);
  }
}

main().catch((err) => {
  logger.error("fatal", err);
  process.exit(1);
});
