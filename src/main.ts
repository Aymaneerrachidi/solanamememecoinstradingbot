import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { openDb } from "./storage/db.js";
import { getAllKols, replaceKols } from "./storage/kolStore.js";
import { loadKols, manualFetcher, kolscanFetcher } from "./scraper/kolScraper.js";
import { createRpcMonitor, type WatchedWallet } from "./monitor/walletMonitor.js";
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
  const monitor = createRpcMonitor(
    conn,
    getWallets,
    config.monitorRequestGapMs,
    config.buyLookbackMin * 60_000
  );

  const checkTokenBound = (mint: string) =>
    checkToken(mint, config.safety, {
      dex: (m) => fetchDexData(m),
      rug: (m) => fetchRugData(m),
      chain: (m) => fetchOnchainData(conn, m),
    });

  logger.info(`monitor loop started (notifying buys seen in the last ${config.buyLookbackMin} min)`);
  let cycle = 0;
  let totalBuys = 0;
  let totalSignals = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    cycle++;
    const walletCount = getWallets().length;
    let buyCount = 0;
    let signalCount = 0;
    try {
      const polled = await monitor.poll();
      const cutoff = Date.now() - config.buyLookbackMin * 60_000;
      const buys = polled.filter((b) => b.ts >= cutoff);
      if (buys.length > 0) {
        const res = await processBuys(db, buys, {
          signalLevels: config.signalLevels,
          individualBuyTiers: config.individualBuyTiers,
          checkToken: checkTokenBound,
          tokenInfo: (m) => fetchDexData(m),
          tg,
        });
        buyCount = res.buysSeen;
        totalBuys += buyCount;
        signalCount = res.signalsSent.length;
        totalSignals += signalCount;
        for (const key of res.signalsSent) logger.info(`🚀 SIGNAL SENT: ${key}`);
      }
    } catch (err) {
      logger.error("monitor loop error", err);
    }
    logger.info(
      `cycle ${cycle} | watching ${walletCount} wallets | ` +
        `${buyCount} buys seen (${totalBuys} total) | ` +
        `${signalCount} signals (${totalSignals} total) | next poll in ${config.monitorIntervalSec}s`
    );
    await sleep(config.monitorIntervalSec * 1000);
  }
}

main().catch((err) => {
  logger.error("fatal", err);
  process.exit(1);
});
