import type { TelegramClient } from "../alert/telegram.js";

// Lightweight in-process health tracker: counts recent failures per category and lets us
// fire a throttled Telegram warning when sustained problems show up. Module-level state by
// design — the bot is a single long-running process and this keeps callers simple.

interface State {
  failures: Map<string, number[]>;
  lastAlerted: Map<string, number>;
  zeroBuyStreak: number;
}

const KEEP_WINDOW_MS = 30 * 60_000;

const state: State = {
  failures: new Map(),
  lastAlerted: new Map(),
  zeroBuyStreak: 0,
};

export function recordFailure(category: string, now: number = Date.now()): void {
  const arr = state.failures.get(category) ?? [];
  arr.push(now);
  const cutoff = now - KEEP_WINDOW_MS;
  state.failures.set(
    category,
    arr.filter((t) => t >= cutoff)
  );
}

export function failuresInWindow(category: string, windowMs: number, now: number = Date.now()): number {
  const arr = state.failures.get(category) ?? [];
  const cutoff = now - windowMs;
  return arr.filter((t) => t >= cutoff).length;
}

// Updates the "no buys seen" streak and returns the new value.
export function noteBuysCycle(buyCount: number): number {
  if (buyCount > 0) state.zeroBuyStreak = 0;
  else state.zeroBuyStreak++;
  return state.zeroBuyStreak;
}

export function shouldAlert(category: string, muteMs: number, now: number = Date.now()): boolean {
  const last = state.lastAlerted.get(category) ?? 0;
  return now - last >= muteMs;
}

export function markAlerted(category: string, now: number = Date.now()): void {
  state.lastAlerted.set(category, now);
}

// For tests.
export function _resetHealth(): void {
  state.failures.clear();
  state.lastAlerted.clear();
  state.zeroBuyStreak = 0;
}

export interface HealthThresholds {
  dexscreenerErr: number; // failures in last 5 min that trigger alert
  rugcheckErr: number;
  rpcErr: number;
  noBuysCycles: number; // consecutive cycles with 0 buys
  muteMin: number; // per-category mute minutes
}

const PRETTY: Record<string, string> = {
  dexscreener: "DexScreener",
  rugcheck: "RugCheck",
  rpc: "Solana RPC",
};

// Runs every cycle from main. Sends at most one Telegram message per category per `muteMin`.
export async function runHealthChecks(tg: TelegramClient, t: HealthThresholds): Promise<void> {
  const muteMs = t.muteMin * 60_000;
  const win = 5 * 60_000;

  const rateChecks: { category: string; threshold: number }[] = [
    { category: "dexscreener", threshold: t.dexscreenerErr },
    { category: "rugcheck", threshold: t.rugcheckErr },
    { category: "rpc", threshold: t.rpcErr },
  ];

  for (const c of rateChecks) {
    const count = failuresInWindow(c.category, win);
    if (count >= c.threshold && shouldAlert(c.category, muteMs)) {
      markAlerted(c.category);
      await tg.send(
        `⚠️ <b>Health</b> — ${PRETTY[c.category] ?? c.category}: <b>${count}</b> errors in last 5 min`
      );
    }
  }

  if (state.zeroBuyStreak >= t.noBuysCycles && shouldAlert("no-buys", muteMs)) {
    markAlerted("no-buys");
    await tg.send(
      `⚠️ <b>Health</b> — no KOL buys seen in last <b>${state.zeroBuyStreak}</b> cycles (RPC may be stuck or markets quiet)`
    );
  }
}

export async function alertKolScrape(
  tg: TelegramClient,
  muteMin: number,
  kind: "empty" | "failed",
  detail?: unknown
): Promise<void> {
  const category = `kol-scrape-${kind}`;
  const muteMs = muteMin * 60_000;
  if (!shouldAlert(category, muteMs)) return;
  markAlerted(category);
  const msg =
    kind === "empty"
      ? `⚠️ <b>Health</b> — KOL scrape returned 0 KOLs (kolscan may be down or page changed)`
      : `⚠️ <b>Health</b> — KOL scrape failed: <code>${String(detail).slice(0, 200)}</code>`;
  await tg.send(msg);
}
