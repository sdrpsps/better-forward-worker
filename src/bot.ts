import { Bot, webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";

export function createBot(token: string, botInfo: UserFromGetMe) {
	const bot = new Bot(token, { botInfo });
	bot.on("message:text", () => undefined);
	return webhookCallback(bot, "cloudflare-mod");
}
