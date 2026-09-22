import { Hono } from "hono";
import { createBot, createWebhookHandler } from "./bot";
import { readInternalApiSecret, readWebhookConfig } from "./env";
import { webhookSetupOptions } from "./bot";

export type WorkerEnv = {
	BOT_INFO_JSON: string;
	BOT_TOKEN: string;
	DB: D1Database;
	FORWARD_GROUP_ID?: string;
	INTERNAL_API_SECRET?: string;
	TELEGRAM_WEBHOOK_SECRET: string;
};

export function createApp() {
	const app = new Hono<{ Bindings: WorkerEnv }>();

	app.get("/health", (context) => context.json({ ok: true }));

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
