import { Connection } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { openDb } from "./storage/db.js";
import { getAllKols, replaceKols } from "./storage/kolStore.js";
import { manualFetcher, fetchKolscanBoards } from "./scraper/kolScraper.js";
import {
  recordSnapshot,
  getSnapshotsSince,
  getLatestSnapshotsByTimeframe,
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
import { alertKolScrape, noteBuysCycle, runHealthChecks } from "./health/health.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOCK_FILE = ".bot.lock";

// Singleton guard: refuses to start if another instance is already running. Prevents the
// "multiple bots hammering the same Helius key → 429 storm" gremlin.
function acquireLock(): void {
  if (existsSync(LOCK_FILE)) {
    const prevPid = Number(readFileSync(LOCK_FILE, "utf8").trim());
    if (prevPid > 0) {
      try {
        process.kill(prevPid, 0); // throws if the PID isn't alive
        logger.error(
          `Another bot instance (PID ${prevPid}) is already running. Stop it first ` +
            `(Ctrl+C in its terminal, or kill it), then retry. Delete ${LOCK_FILE} if you're sure.`
        );
        process.exit(1);
      } catch {
        // Stale lock — previous process is gone. Take it over.
        logger.warn(`Found stale lock from PID ${prevPid} (no longer running); claiming it.`);
      }
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => {
    try {
      if (existsSync(LOCK_FILE) && readFileSync(LOCK_FILE, "utf8").trim() === String(process.pid)) {
        unlinkSync(LOCK_FILE);
      }
    } catch {
      /* best-effort */
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => { release(); process.exit(0); });
  process.on("SIGTERM", () => { release(); process.exit(0); });
}

async function main() {
  acquireLock();

  if (!config.heliusApiKey || !config.telegramBotToken || !config.telegramChatId) {
    logger.error("Missing required env: HELIUS_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  const db = openDb("signals.db");
  const conn = new Connection(config.rpcUrl, "confirmed");
  const tg = createTelegramClient(config.telegramBotToken, config.telegramChatId);

  const manualOnly = config.kolManualListPath ? manualFetcher(config.kolManualListPath) : null;

  // Pulls today's leaderboards (daily, weekly, monthly) from kolscan, snapshots each, then
  // rebuilds the tracked list with a quality score blending all three timeframes.
  async function refreshKols() {
    const now = Date.now();
    const today = epochDay(now);

    // Source the three boards (or fall back to a manual daily-only list).
    let daily: Awaited<ReturnType<typeof fetchKolscanBoards>>["daily"] = [];
    let weekly: typeof daily = [];
    let monthly: typeof daily = [];
    try {
      if (manualOnly) {
        daily = await manualOnly();
      } else {
        const boards = await fetchKolscanBoards();
        daily = boards.daily;
        weekly = boards.weekly;
        monthly = boards.monthly;
      }
    } catch (err) {
      logger.warn("KOL scrape failed; keeping current list", err);
      await alertKolScrape(tg, config.health.muteMin, "failed", err);
      return;
    }
    if (daily.length === 0 && weekly.length === 0 && monthly.length === 0) {
      logger.warn("KOL scrape returned 0 across all timeframes; keeping current list");
      await alertKolScrape(tg, config.health.muteMin, "empty");
      return;
    }

    if (daily.length > 0) recordSnapshot(db, daily, today, "daily");
    if (weekly.length > 0) recordSnapshot(db, weekly, today, "weekly");
    if (monthly.length > 0) recordSnapshot(db, monthly, today, "monthly");
    pruneSnapshots(db, today - config.kolHistoryDays);

    const sinceDay = today - config.kolHistoryDays;
    const scored = scoreConsistency({
      dailySnapshots: getSnapshotsSince(db, sinceDay, "daily"),
      latestDaily: getLatestSnapshotsByTimeframe(db, "daily", sinceDay),
      latestWeekly: getLatestSnapshotsByTimeframe(db, "weekly", sinceDay),
      latestMonthly: getLatestSnapshotsByTimeframe(db, "monthly", sinceDay),
    });
    const kols = buildKolList(scored, config.tiers, now, config.maxKols);
    replaceKols(db, kols);

    logger.info(
      `KOLs refreshed: tracking ${kols.length} (D:${daily.length} W:${weekly.length} M:${monthly.length})`
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

      noteBuysCycle(buyCount);
      await runHealthChecks(tg, config.health);
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
