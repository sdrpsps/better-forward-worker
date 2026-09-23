#!/usr/bin/env node

import webhookConfig from "./webhook-config.json" with { type: "json" };

const { BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, WEBHOOK_URL: webhookUrl } = process.env;

if (!token || !secret || !webhookUrl) {
	console.error("BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and WEBHOOK_URL are required");
	process.exit(2);
}

let url;
try {
	url = new URL(webhookUrl);
} catch {
	console.error("WEBHOOK_URL must be a valid HTTPS URL");
	process.exit(2);
}
if (url.protocol !== "https:" || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
	console.error("WEBHOOK_URL must be HTTPS and TELEGRAM_WEBHOOK_SECRET must use 1-256 letters, digits, underscores, or hyphens");
	process.exit(2);
}

try {
	const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url: url.href, secret_token: secret, allowed_updates: webhookConfig.allowedUpdates, max_connections: webhookConfig.maxConnections, drop_pending_updates: false }),
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok || !payload?.ok) throw new Error(`Telegram setWebhook failed (${response.status})`);
	console.log("Telegram webhook configured.");
} catch (error) {
	console.error(error instanceof Error ? error.message : "Telegram setWebhook failed");
	process.exitCode = 1;
}
