#!/usr/bin/env node

import { prompt } from "./prompt.mjs";

let token;
try {
	token = await prompt("Bot token: ");
} catch (error) {
	console.error(error instanceof Error ? error.message : "Unable to read bot token");
	process.exit(2);
}
if (!token) {
	console.error("Bot token is required");
	process.exit(2);
}

try {
	const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
	const payload = await response.json().catch(() => null);
	if (!response.ok || !payload?.ok || !payload.result) throw new Error(`Telegram getMe failed (${response.status})`);
	process.stdout.write(`${JSON.stringify(payload.result)}\n`);
} catch (error) {
	console.error(error instanceof Error ? error.message : "Telegram getMe failed");
	process.exitCode = 1;
}
