import { retry } from "../util/retry.js";

export interface TelegramClient {
  send(text: string): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serializes sends and enforces a minimum gap between them so we stay under Telegram's
// per-chat rate limit (~1 message/sec).
export function createTelegramClient(
  botToken: string,
  chatId: string,
  minGapMs = 1100
): TelegramClient {
  let chain: Promise<void> = Promise.resolve();
  let last = 0;
  return {
    send(text: string): Promise<void> {
      chain = chain.then(async () => {
        const wait = minGapMs - (Date.now() - last);
        if (wait > 0) await sleep(wait);
        last = Date.now();
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await retry(
          () =>
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
                disable_web_page_preview: true,
              }),
            }),
          { attempts: 3, baseDelayMs: 500 }
        );
      });
      return chain;
    },
  };
}
