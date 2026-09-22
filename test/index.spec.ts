import { applyD1Migrations, env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import migrationSql from "../migrations/0001_phase_0.sql?raw";
import { cancelAdminSession, loadAdminSession, saveAdminSession } from "../src/admin-sessions";
import worker from "../src/index";

const testEnv = {
	...env,
	BOT_INFO_JSON: JSON.stringify({
		id: 123456,
		is_bot: true,
		first_name: "Test",
		username: "test_bot",
		can_join_groups: true,
		can_read_all_group_messages: false,
		supports_inline_queries: false,
	}),
	BOT_TOKEN: "123456:test-token",
	TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
};

const migrations = [
	{ name: "0001_phase_0.sql", queries: migrationSql.split(";").filter(Boolean) },
];

beforeAll(async () => {
	await applyD1Migrations(env.DB, migrations);
});

afterEach(async () => {
	await env.DB.exec("DELETE FROM admin_sessions");
});

describe("Telegram webhook", () => {
	it("rejects an invalid secret", async () => {
		const response = await worker.fetch(
			new Request("https://example.com/telegram/webhook", { method: "POST", body: "{}" }),
			testEnv,
			createExecutionContext(),
		);
		expect(response.status).toBe(401);
	});

	it("passes a valid fixture update to grammY", async () => {
		const context = createExecutionContext();
		const response = await worker.fetch(
			new Request("https://example.com/telegram/webhook", {
				method: "POST",
				headers: { "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret" },
				body: JSON.stringify({
					update_id: 1,
					message: {
						message_id: 1,
						date: 0,
						chat: { id: 1, type: "private" },
						from: { id: 1, is_bot: false, first_name: "Test" },
						text: "hi",
					},
				}),
			}),
			testEnv,
			context,
		);
		await waitOnExecutionContext(context);
		expect(response.status).toBe(200);
	});

	it("serves health checks", async () => {
		const response = await SELF.fetch("https://example.com/health");
		expect(await response.json()).toEqual({ ok: true });
	});
});

describe("D1 admin sessions", () => {
	it("survives a fresh database access, then supports cancellation and expiry", async () => {
		await saveAdminSession(env.DB, {
			adminId: "9007199254740993",
			scope: "auto-response",
			state: "awaiting-text",
			payload: { rule: "welcome" },
			expiresAt: Date.now() + 60_000,
		});
		expect(await loadAdminSession(env.DB, "9007199254740993", "auto-response")).toMatchObject({
			state: "awaiting-text",
			payload: { rule: "welcome" },
		});

		await cancelAdminSession(env.DB, "9007199254740993", "auto-response");
		expect(await loadAdminSession(env.DB, "9007199254740993", "auto-response")).toBeNull();

		await saveAdminSession(env.DB, {
			adminId: "9007199254740993",
			scope: "auto-response",
			state: "awaiting-text",
			payload: {},
			expiresAt: Date.now() - 1,
		});
		expect(await loadAdminSession(env.DB, "9007199254740993", "auto-response")).toBeNull();
	});
});
