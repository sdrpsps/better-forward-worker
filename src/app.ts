import { Hono } from "hono";
import { createBot, createWebhookHandler } from "./bot";
import { readInternalApiSecret, readWebhookConfig } from "./env";
import { webhookSetupOptions } from "./bot";
import { resolveInviteLink } from "./chat-id";
import { enqueueBroadcast } from "./broadcast";

export type WorkerEnv = {
	BOT_INFO_JSON: string;
	BOT_TOKEN: string;
	DB: D1Database;
	FORWARD_GROUP_ID?: string;
	BROADCAST_QUEUE?: Queue<import("./broadcast").BroadcastJob>;
	INTERNAL_API_SECRET?: string;
	TELEGRAM_WEBHOOK_SECRET: string;
};

export function createApp() {
	const app = new Hono<{ Bindings: WorkerEnv }>();

	app.get("/health", (context) => context.json({ ok: true }));

	app.post("/internal/chat-id/resolve", async (context) => {
		if (context.req.header("Authorization") !== `Bearer ${readInternalApiSecret(context.env)}`) {
			return context.json({ error: "unauthorized" }, 401);
		}
		const body = await context.req.json<{ invite_link?: string }>().catch(() => ({ invite_link: undefined }));
		if (!body.invite_link) return context.json({ error: "invalid_invite_link" }, 400);
		const result = await resolveInviteLink(context.env.DB, body.invite_link, context.req.header("X-Request-ID") ?? crypto.randomUUID());
		if (result.status !== 200) return context.json({ error: result.error }, result.status);
		return context.json({ chat_id: result.chatId });
	});

	app.post("/internal/broadcast", async (context) => {
		if (context.req.header("Authorization") !== `Bearer ${readInternalApiSecret(context.env)}`) return context.json({ error: "unauthorized" }, 401);
		const body = await context.req.json<{ source_chat_id?: string; source_message_id?: number }>().catch(() => ({ source_chat_id: undefined, source_message_id: undefined }));
		const sourceChatId = body.source_chat_id;
		const sourceMessageId = body.source_message_id;
		if (!sourceChatId || typeof sourceMessageId !== "number" || !Number.isInteger(sourceMessageId) || sourceMessageId < 1) return context.json({ error: "invalid_broadcast" }, 400);
		await enqueueBroadcast(context.env.BROADCAST_QUEUE, { sourceChatId, sourceMessageId });
		return context.json({ accepted: true }, 202);
	});

	app.get("/internal/metrics", async (context) => {
		if (context.req.header("Authorization") !== `Bearer ${readInternalApiSecret(context.env)}`) return context.json({ error: "unauthorized" }, 401);
		const queue = context.env.BROADCAST_QUEUE ? await context.env.BROADCAST_QUEUE.metrics() : null;
		const failedUpdates = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM processed_updates WHERE status = 'failed'").first();
		const failedDeliveries = await context.env.DB.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE status = 'failed'").first();
		return context.json({ queue, failedUpdates, failedDeliveries });
	});

	app.get("/internal/webhook/status", async (context) => {
		if (context.req.header("Authorization") !== `Bearer ${readInternalApiSecret(context.env)}`) {
			return context.json({ error: "unauthorized" }, 401);
		}
		const config = readWebhookConfig(context.env);
		if (!config) return context.json({ error: "webhook_not_configured" }, 500);
		const bot = createBot(config.token, config.botInfo, context.env, context.req.header("X-Request-ID"));
		const info = await bot.api.getWebhookInfo();
		return context.json({
			url: info.url,
			pendingUpdateCount: info.pending_update_count,
			lastErrorDate: info.last_error_date ?? null,
			lastErrorMessage: info.last_error_message ?? null,
		});
	});

	app.post("/internal/webhook/setup", async (context) => {
		if (context.req.header("Authorization") !== `Bearer ${readInternalApiSecret(context.env)}`) {
			return context.json({ error: "unauthorized" }, 401);
		}
		const config = readWebhookConfig(context.env);
		if (!config) return context.json({ error: "webhook_not_configured" }, 500);
		const body = await context.req.json<{ url?: string }>().catch(() => ({ url: undefined }));
		if (!body.url || !URL.canParse(body.url)) return context.json({ error: "invalid_url" }, 400);
		const bot = createBot(config.token, config.botInfo, context.env, context.req.header("X-Request-ID"));
		await bot.api.setWebhook(body.url, webhookSetupOptions(config.secret));
		return context.json({ ok: true, url: body.url, ...webhookSetupOptions(config.secret) });
	});

	app.post("/telegram/webhook", async (context) => {
		const config = readWebhookConfig(context.env);
		if (!config) return context.json({ error: "webhook_not_configured" }, 500);
		if (context.req.header("X-Telegram-Bot-Api-Secret-Token") !== config.secret) {
			return context.json({ error: "unauthorized" }, 401);
		}
		return createWebhookHandler(createBot(config.token, config.botInfo, context.env, context.req.header("X-Request-ID")))(context.req.raw);
	});

	return app;
}
