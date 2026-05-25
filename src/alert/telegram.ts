import { retry } from "../util/retry.js";

export interface TelegramClient {
  send(text: string): Promise<void>;
}

export function createTelegramClient(botToken: string, chatId: string): TelegramClient {
  return {
    async send(text: string) {
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
    },
  };
}
