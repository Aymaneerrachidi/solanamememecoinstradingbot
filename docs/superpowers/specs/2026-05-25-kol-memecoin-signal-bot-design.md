# KOL Memecoin Signal Bot — Design

**Date:** 2026-05-25
**Status:** Approved (design phase)

## Summary

A long-running local Node.js/TypeScript service that watches the wallets of top-ranked
Solana KOLs (sourced from kolscan.io), detects when enough high-tier KOLs buy the *same
fresh token* within a configurable time window, runs that token through strict
anti-rug / anti-dead-coin safety gates, and sends a Telegram alert if it passes.

**Alert-only.** The bot never executes trades. The user trades manually off the alerts.

## Goals

- Surface early memecoin opportunities that multiple proven KOLs are entering, before the
  broader crowd.
- Aggressively filter out rugs and dead coins via on-chain + market-data safety gates.
- Be fully tunable (thresholds in config) so the user can dial the profit/safety tradeoff
  against real outcomes.

## Non-Goals

- No automated trade execution (explicitly out of scope for v1).
- No website / dashboard (alerts go to Telegram only).
- No multi-chain support — Solana only.
- No guarantee of profit. Copy-trading KOLs is inherently risky; this bot improves odds and
  speed, it does not remove risk.

## Realistic-Expectations Note

Even with strict filters, copy-trading KOLs carries real risk: KOLs get rugged too, can be
paid to shill, and may dump on followers. This system improves the user's odds and reaction
speed but is not a guaranteed-profit machine. "Maximize profit" comes from the user tuning
thresholds against observed results over time.

## Architecture

Seven components, each with a single responsibility and a well-defined interface.

### 1. `KolScraper`
- Fetches the kolscan.io leaderboard (wallet addresses + PnL / win-rate).
- Classifies KOLs into tiers **S / A / B** by rank (cutoffs in config).
- Refreshes periodically (default: daily).
- On scrape failure, keeps the last-known KOL list (fail-safe, never empties the watch set).
- Output: persisted `kols` table `{ wallet, name, pnl, winRate, tier, updatedAt }`.

### 2. `WalletMonitor`
- Polls each tracked wallet's recent transactions via Helius enhanced-transactions API on a
  short interval (default: every few seconds).
- Parses transactions for *buy* swaps (the wallet received an SPL token).
- Emits `BuyEvent { kolWallet, tier, tokenMint, ts, amount }`.
- Defined behind a `WalletMonitor` interface so the polling implementation can later be
  swapped for Helius webhooks or a Geyser/websocket stream without touching the rest.

### 3. `ConfluenceEngine`
- Maintains a rolling time window of buys per token (from `Storage`).
- Applies the tier rule (defaults, all configurable):
  **1 S-tier OR 2 A-tier OR 3 B-tier** buys of the same token within the window
  → token becomes a *candidate*.
- Pure logic — no I/O — so it is straightforward to unit test.

### 4. `SafetyChecker`
- Runs all safety gates on a candidate token; returns `{ pass, stats, failedGates[] }`.
- **Fail-closed:** if required data is unavailable, the token fails.
- Gates (a candidate must pass ALL):
  - **Liquidity + LP locked/burned** — minimum LP size (default ~$10k) AND LP burned or
    locked. Source: RugCheck + DexScreener.
  - **Mint & freeze authority revoked** — on-chain check on the mint account; reject if the
    dev can still mint supply or freeze wallets. Source: RPC `getAccountInfo`.
  - **Holder concentration** — reject if top-10 holders exceed a max % (default 30%).
    Source: RPC `getTokenLargestAccounts` + supply.
  - **Min volume / age / holders** — baseline 24h volume, a minimum token age, an upper age
    bound (dead-coin filter), and a minimum holder count. Source: DexScreener + RPC.

### 5. `AlertDispatcher`
- Formats and sends the Telegram message: token name/mint, which KOLs (+ tiers) are in,
  safety stats, and links (DexScreener chart, buy link).
- Records each alert in `Storage` so the same token never alerts twice.

### 6. `Storage`
- Local **SQLite** file (e.g. `better-sqlite3`). No external DB service.
- Tables: `kols`, `buys`, `tokens`, `alerts`.
- Powers rolling-window queries, dedup, KOL tier persistence, and alert history.

### 7. `main` orchestrator + `config`
- Wires components together and runs the scrape loop + monitor loop.
- Centralizes all tunables in `.env` + a typed `config` module.

## Data Flow

```
KolScraper  ──(tiered KOLs)──>  Storage
                                   │
WalletMonitor ──(BuyEvent)──> Storage + ConfluenceEngine
                                   │
                    token qualifies & not already alerted
                                   │
                                   v
                            SafetyChecker  ──(all gates pass)──>  AlertDispatcher ──> Telegram
                                                                        │
                                                                        └─> records alert (dedup)
```

## External Dependencies (all have free tiers)

- **Helius** — RPC + enhanced-transactions API for wallet monitoring and on-chain reads.
  Requires an API key (free tier sufficient to start).
- **DexScreener** — free, no key. Liquidity, volume, age, price.
- **RugCheck** — free public API. LP lock/burn status + risk summary.
- **Telegram bot** — created via BotFather; bot token + chat ID supplied in `.env`.

## Error Handling

- Every external call wrapped with retry + backoff; failures are logged and never crash the
  loop.
- Safety-data failures → token fails (fail-closed).
- kolscan scrape failure → keep last-known KOL list.
- All alerts deduped via `Storage`.
- Rate-limit aware (batch / throttle Helius polling across many wallets).

## Testing

- **Unit:**
  - `ConfluenceEngine` — tier rules, window expiry, dedup (pure logic).
  - `SafetyChecker` — threshold logic with mocked API responses (pass/fail per gate).
  - KOL tier classification.
- **Integration:**
  - Mocked buy transaction → full pipeline → mocked Telegram send.

## Configurable Tunables

Tier cutoffs (S/A/B rank boundaries), confluence counts per tier, time window length, poll
interval, scrape refresh interval, min liquidity, max top-10 holder %, min 24h volume,
min/max token age, min holder count, Helius API key/RPC URL, Telegram bot token + chat ID.

## Tech Stack

- **Language/runtime:** TypeScript / Node.js (best Solana ecosystem + Telegram support).
- **Monitoring mechanism:** Helius polling (free tier) behind a swappable interface.
- **Safety data:** DexScreener + on-chain RPC + RugCheck.
- **Storage:** SQLite (local file).

## Open Questions / Future Work

- Upgrade `WalletMonitor` from polling to Helius webhooks / Geyser for lower latency.
- Track post-alert token performance to measure which signals actually made money.
- Optional auto-execution module (Jupiter) once signals are trusted.
