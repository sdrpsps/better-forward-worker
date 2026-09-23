import { Bot, webhookCallback } from "grammy";
import type { Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createDb } from "./db";
import { claimUpdate, completeUpdate, failUpdate } from "./updates";
import type { WorkerEnv } from "./app";
import { editEditedMessage, forwardMessage, handleAdminCommand, handleUserCommand, syncReaction } from "./forwarding";
import { handleAdminCallback, handleAdminInput, showAdminMenu } from "./admin-flow";
import { handleCaptchaCallback, handleIncomingPolicy } from "./policy";

type Logger = Pick<Console, "debug" | "info" | "warn" | "error">;
export type BotContext = Context & {
	env: WorkerEnv;
	db: ReturnType<typeof createDb>;
	requestId: string;
	logger: Logger;
};

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
	bot.on("message", async (ctx, next) => {
		if (await handleAdminInput(ctx as never)) return;
		if (await handleIncomingPolicy(ctx as never)) return;
		if (await handleAdminCommand(ctx as never)) return;
		if (await handleUserCommand(ctx)) return;
		await forwardMessage(ctx);
		await next();
	});
	bot.command(["admin", "start", "help"], showAdminMenu);
	bot.callbackQuery(/^admin:/, handleAdminCallback);
	bot.callbackQuery(/^captcha:/, handleCaptchaCallback);
	bot.on("edited_message", editEditedMessage);
	bot.on("message_reaction", syncReaction);
	return bot;
}

export function createWebhookHandler(bot: Bot<BotContext>) {
	return webhookCallback(bot, "cloudflare-mod");
}
