import { Hono } from "hono";
import { createBot } from "./bot";
import { readWebhookConfig } from "./env";

export type WorkerEnv = {
	BOT_INFO_JSON: string;
	BOT_TOKEN: string;
	DB: D1Database;
	TELEGRAM_WEBHOOK_SECRET: string;
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
		return createBot(config.token, config.botInfo)(context.req.raw);
	});

	return app;
}
