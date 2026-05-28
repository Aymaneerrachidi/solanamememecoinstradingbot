# KOL Memecoin Signal Bot

Watches top Solana KOL wallets (kolscan.io), detects tier-weighted buy confluence on fresh
tokens, runs strict anti-rug / anti-dead-coin safety gates, and sends Telegram alerts.
**Alert-only — it does not trade.**

## How it works

1. **Scrape + consistency** — pulls the kolscan leaderboard daily and stores a snapshot.
   The tracked KOL list is rebuilt from accumulated history (`KOL_HISTORY_DAYS`): KOLs are
   ranked by a recency-weighted consistency score (showing up across days/weeks/months beats
   a one-day fluke), capped to the strongest `MAX_KOLS`, then split into **S / A / B** tiers.
   (kolscan's own weekly/monthly leaderboards are behind an auth-only API, so consistency is
   derived from our own daily history.)
2. **Monitor** — polls each tracked wallet via Helius (standard RPC) for token buys.
3. **Signal ladder** — fires the strongest level a coin qualifies for, based on how many
   distinct KOLs buy it within a window (default: 🟢 2/5min, 🔵 4/15min, 🟠 4/5min,
   🔴 6/15min). A coin re-alerts as it climbs to a higher level.
4. **Safety (lean)** — a signal must pass: market cap ≥ `MIN_MARKET_CAP_USD` (and ≤
   `MAX_MARKET_CAP_USD` if set) **and** the three anti-rug checks (LP locked/burned, mint
   authority revoked, freeze authority revoked). Fail-closed: missing data ⇒ reject.
5. **Alert** — Telegram message with token symbol/name, market cap, the KOLs (+ranks), the
   safety snapshot, and a tap-to-copy contract address.
   Individual per-buy pings are opt-in via `INDIVIDUAL_BUY_TIERS` (default off).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `HELIUS_API_KEY` + `SOLANA_RPC_URL` (free at dev.helius.xyz)
   - `TELEGRAM_BOT_TOKEN` (from @BotFather) + `TELEGRAM_CHAT_ID` (from @userinfobot)
   - Optionally `KOL_MANUAL_LIST_PATH` pointing to a JSON list like `kols.example.json`
3. Tune the tier / confluence / safety thresholds in `.env`.

## Run

- `npm start` — start the bot (loads `.env` automatically)
- `npm test` — run the test suite

## Notes

- The kolscan endpoint in `src/scraper/kolScraper.ts` is a best-effort guess — verify it
  against the live site in browser devtools, or use a manual KOL list (`KOL_MANUAL_LIST_PATH`).
- Safety is **fail-closed**: if data can't be fetched, the token is rejected.
- Copy-trading KOLs is inherently risky — KOLs get rugged, can be paid to shill, and may
  dump on followers. This bot improves your odds and speed; it is not a guaranteed-profit
  machine. Tune thresholds against real outcomes.
