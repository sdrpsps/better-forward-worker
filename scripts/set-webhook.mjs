#!/usr/bin/env node

import webhookConfig from "./webhook-config.json" with { type: "json" };
import { prompt } from "./prompt.mjs";

let token;
let secret;
let webhookUrl;
try {
	token = await prompt("Bot token: ");
	secret = await prompt("Webhook secret: ");
	webhookUrl = await prompt("Webhook URL: ");
} catch (error) {
	console.error(error instanceof Error ? error.message : "Unable to read webhook settings");
	process.exit(2);
}

if (!token || !secret || !webhookUrl) {
	console.error("Bot token, webhook secret, and webhook URL are required");
	process.exit(2);
}

let url;
try {
	url = new URL(webhookUrl);
} catch {
	console.error("Webhook URL must be a valid HTTPS URL");
	process.exit(2);
}
if (url.protocol !== "https:" || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
	console.error("Webhook URL must be HTTPS and the webhook secret must use 1-256 letters, digits, underscores, or hyphens");
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
