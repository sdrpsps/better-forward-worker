#!/usr/bin/env node

const token = process.env.BOT_TOKEN;

if (!token) {
	console.error("BOT_TOKEN is required");
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
