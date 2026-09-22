import { Bot, webhookCallback } from "grammy";
import type { Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createDb } from "./db";
import { claimUpdate, completeUpdate, failUpdate } from "./updates";
import type { WorkerEnv } from "./app";

export const ALLOWED_UPDATES = ["message", "edited_message", "message_reaction", "callback_query"] as const;
export const MAX_CONNECTIONS = 40;

type Logger = Pick<Console, "debug" | "info" | "warn" | "error">;
export type BotContext = Context & {
	env: WorkerEnv;
	db: ReturnType<typeof createDb>;
	requestId: string;
	logger: Logger;
};

export function webhookSetupOptions(secret: string) {
	return {
		secret_token: secret,
		allowed_updates: [...ALLOWED_UPDATES],
		max_connections: MAX_CONNECTIONS,
	} as const;
}

export function createBot(token: string, botInfo: UserFromGetMe, env: WorkerEnv, requestId = crypto.randomUUID()) {
	const bot = new Bot<BotContext>(token, { botInfo });
	bot.use(async (ctx, next) => {
		const logger = console;
		Object.assign(ctx, { env, db: createDb(env.DB), requestId, logger });
		const updateId = ctx.update.update_id;
		if (!(await claimUpdate(env.DB, updateId, requestId))) return;
		try {
			await next();
			await completeUpdate(env.DB, updateId);
		} catch (error) {
			await failUpdate(env.DB, updateId, error);
			logger.error(JSON.stringify({ event: "telegram_update_failed", request_id: requestId, update_id: updateId }));
			throw error;
		}
	});
	bot.on("message:text", () => undefined);
	return bot;
}

export function createWebhookHandler(bot: Bot<BotContext>) {
	return webhookCallback(bot, "cloudflare-mod");
}
