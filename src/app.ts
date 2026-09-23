import { Hono } from "hono";
import { createBot, createWebhookHandler } from "./bot";
import { readWebhookConfig } from "./env";

export type WorkerEnv = {
	BOT_INFO_JSON: string;
	BOT_TOKEN: string;
	DB: D1Database;
	FORWARD_GROUP_ID?: string;
	TELEGRAM_WEBHOOK_SECRET: string;
	TGUARD_API_URL?: string;
	TGUARD_API_KEY?: string;
};

export function createApp() {
	const app = new Hono<{ Bindings: WorkerEnv }>();

	app.get("/health", (context) => context.json({ ok: true }));

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
