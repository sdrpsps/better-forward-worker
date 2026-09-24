import { Bot, webhookCallback } from "grammy";
import type { Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { claimUpdate, completeUpdate, failUpdate } from "./updates";
import type { WorkerEnv } from "./app";
import { editEditedMessage, forwardMessage, handleAdminCommand, handleUserCommand, syncReaction } from "./forwarding";
import { handleAdminCallback, handleAdminInput, showAdminMenu } from "./admin-flow";
import { handleAdminPolicyCallback, handleAdminPolicyInput } from "./admin-policy";
import { handleCaptchaCallback, handleIncomingPolicy } from "./policy";

export type BotContext = Context & {
	env: WorkerEnv;
};

export function createBot(token: string, botInfo: UserFromGetMe, env: WorkerEnv, requestId = crypto.randomUUID()) {
	const bot = new Bot<BotContext>(token, { botInfo });
	bot.use(async (ctx, next) => {
		ctx.env = env;
		const updateId = ctx.update.update_id;
		if (!(await claimUpdate(env.DB, updateId, requestId))) return;
		try {
			await next();
			await completeUpdate(env.DB, updateId);
		} catch (error) {
			await failUpdate(env.DB, updateId, error);
			console.error(JSON.stringify({ event: "telegram_update_failed", request_id: requestId, update_id: updateId }));
			throw error;
		}
	});
	bot.on("message", async (ctx, next) => {
		if (await handleAdminInput(ctx as never)) return;
		if (await handleAdminPolicyInput(ctx as never)) return;
		if (await handleIncomingPolicy(ctx as never)) return;
		if (await handleAdminCommand(ctx as never)) return;
		if (await handleUserCommand(ctx)) return;
		await forwardMessage(ctx);
		await next();
	});
	bot.command(["admin", "setup", "start", "help"], showAdminMenu);
	bot.callbackQuery(/^admin:(?:set:(?:default_message|captcha)|cancel)$/, handleAdminCallback);
	bot.callbackQuery(/^admin:(?:auto|spam):/, handleAdminPolicyCallback);
	bot.callbackQuery(/^captcha:/, handleCaptchaCallback);
	bot.on("edited_message", editEditedMessage);
	bot.on("message_reaction", syncReaction);
	return bot;
}

export function createWebhookHandler(bot: Bot<BotContext>) {
	return webhookCallback(bot, "cloudflare-mod");
}
