import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { openDb } from "./storage/db.js";
import { getAllKols, replaceKols } from "./storage/kolStore.js";
import { manualFetcher, kolscanFetcher } from "./scraper/kolScraper.js";
import {
  recordSnapshot,
  getSnapshotsSince,
  pruneSnapshots,
  epochDay,
} from "./storage/snapshotStore.js";
import { scoreConsistency, buildKolList } from "./engine/consistency.js";
import { createRpcMonitor, type WatchedWallet } from "./monitor/walletMonitor.js";
import { createTelegramClient } from "./alert/telegram.js";
import { fetchDexData } from "./safety/dexscreener.js";
import { fetchRugData } from "./safety/rugcheck.js";
import { fetchOnchainData } from "./safety/onchain.js";
import { checkToken } from "./safety/safetyChecker.js";
import { processBuys, processSells, checkMultipliers } from "./pipeline.js";

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

  // Pulls today's kolscan leaderboard, stores it as a daily snapshot, then rebuilds the
  // tracked list from accumulated history (weekly + monthly consistency, recent-weighted).
  async function refreshKols() {
    const now = Date.now();
    const today = epochDay(now);
    let raw;
    try {
      raw = await fetchRaw();
    } catch (err) {
      logger.warn("KOL scrape failed; keeping current list", err);
      return;
    }
    if (raw.length === 0) {
      logger.warn("KOL scrape returned 0; keeping current list");
      return;
    }

    recordSnapshot(db, raw, today);
    pruneSnapshots(db, today - config.kolHistoryDays);

    const snaps = getSnapshotsSince(db, today - config.kolHistoryDays);
    const scored = scoreConsistency(snaps, today, raw.length);
    const kols = buildKolList(scored, config.tiers, now, config.maxKols);
    replaceKols(db, kols);

    const days = new Set(snaps.map((s) => s.day)).size;
    logger.info(
      `KOLs refreshed: tracking ${kols.length} (from ${scored.length} seen over ${days} day(s) of history)`
    );
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
      const buys = polled.buys.filter((b) => b.ts >= cutoff);
      const sells = polled.sells.filter((s) => s.ts >= cutoff);

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

      if (sells.length > 0) {
        const res = await processSells(db, sells, {
          tokenInfo: (m) => fetchDexData(m),
          tg,
          exitSellerThreshold: config.exitSellerThreshold,
        });
        for (const key of res.exitsSent) logger.info(`🔻 EXIT ALERT SENT: ${key}`);
      }

      // Performance tracking: ping when flagged coins hit x2/x5/x10...
      const mult = await checkMultipliers(db, {
        tokenInfo: (m) => fetchDexData(m),
        tg,
        milestones: config.multiplierMilestones,
        trackDays: config.multiplierTrackDays,
      });
      for (const key of mult) logger.info(`📈 MULTIPLIER HIT: ${key}`);
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
