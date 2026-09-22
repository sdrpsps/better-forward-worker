import { Bot, webhookCallback } from "grammy";
import type { Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createDb } from "./db";
import { claimUpdate, completeUpdate, failUpdate } from "./updates";
import type { WorkerEnv } from "./app";
import { editEditedMessage, forwardMessage, handleAdminCommand, handleUserCommand, syncReaction } from "./forwarding";
import { handleAdminCallback, handleAdminInput, showAdminMenu } from "./admin-flow";
import { observeInviteLink } from "./chat-id";
import { handleIncomingPolicy } from "./policy";

export const ALLOWED_UPDATES = ["message", "edited_message", "message_reaction", "callback_query", "chat_join_request"] as const;
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
	bot.on("message", async (ctx, next) => {
		if (await handleAdminInput(ctx as never)) return;
		if (await handleIncomingPolicy(ctx as never)) return;
		if (await handleAdminCommand(ctx as never)) return;
		if (await handleUserCommand(ctx)) return;
		await forwardMessage(ctx);
		await next();
	});
	bot.command("admin", showAdminMenu);
	bot.callbackQuery(/^admin:/, handleAdminCallback);
	bot.on("chat_join_request", async (ctx) => {
		const request = ctx.chatJoinRequest;
		const link = request?.invite_link?.invite_link;
		if (link) await observeInviteLink(ctx.env.DB, link, String(request.chat.id));
	});
	bot.on("edited_message", editEditedMessage);
	bot.on("message_reaction", syncReaction);
	return bot;
}

export function createWebhookHandler(bot: Bot<BotContext>) {
	return webhookCallback(bot, "cloudflare-mod");
}
