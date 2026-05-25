# KOL Memecoin Signal Bot

Watches top Solana KOL wallets (kolscan.io), detects tier-weighted buy confluence on fresh
tokens, runs strict anti-rug / anti-dead-coin safety gates, and sends Telegram alerts.
**Alert-only — it does not trade.**

## How it works

1. **Scrape** — pulls the kolscan leaderboard (or a manual list), classifies KOLs into
   tiers **S / A / B** by PnL rank.
2. **Monitor** — polls each tracked wallet via Helius for SWAP buys of SPL tokens.
3. **Confluence** — fires a *candidate* when enough distinct KOLs buy the same token within
   the window (default: 1 S-tier, OR 2 A-tier, OR 3 B-tier; tiers are cumulative).
4. **Safety gates** — a candidate must pass ALL of: minimum liquidity + LP locked/burned,
   mint & freeze authority revoked, holder concentration under a cap, and minimum
   volume / age / holders (also rejects stale "dead" coins). Fail-closed: missing data ⇒ reject.
5. **Alert** — sends a Telegram message with the token, KOLs in, tiers, and safety stats.

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
