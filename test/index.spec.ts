import { applyD1Migrations, env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import phase0MigrationSql from "../migrations/0001_phase_0.sql?raw";
import phase1MigrationSql from "../migrations/0002_phase_1.sql?raw";
import { cancelAdminSession, loadAdminSession, saveAdminSession } from "../src/admin-sessions";
import { claimUpdate, completeUpdate, failUpdate } from "../src/updates";
import { forwardMessage } from "../src/forwarding";
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
const forwardEnv = { ...testEnv, FORWARD_GROUP_ID: "-100123" };

const migrations = [
	{ name: "0001_phase_0.sql", queries: phase0MigrationSql.split(";").filter(Boolean) },
	{ name: "0002_phase_1.sql", queries: phase1MigrationSql.split(";").filter(Boolean) },
];

beforeAll(async () => {
	await applyD1Migrations(env.DB, migrations);
});

afterEach(async () => {
	await env.DB.exec("DELETE FROM admin_sessions");
	await env.DB.exec("DELETE FROM processed_updates");
	await env.DB.exec("DELETE FROM messages");
	await env.DB.exec("DELETE FROM topics");
	await env.DB.exec("DELETE FROM settings");
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
		expect(await env.DB.prepare("SELECT status, attempts FROM processed_updates WHERE update_id = 1").first()).toEqual({ status: "complete", attempts: 1 });

		const duplicate = await worker.fetch(
			new Request("https://example.com/telegram/webhook", {
				method: "POST",
				headers: { "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret" },
				body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false, first_name: "Test" }, text: "hi" } }),
			}),
			testEnv,
			createExecutionContext(),
		);
		expect(duplicate.status).toBe(200);
		expect(await env.DB.prepare("SELECT attempts FROM processed_updates WHERE update_id = 1").first()).toEqual({ attempts: 1 });
	});

	it("serves health checks", async () => {
		const response = await SELF.fetch("https://example.com/health");
		expect(await response.json()).toEqual({ ok: true });
	});
});

describe("update claims", () => {
	it("reclaims failed work but not fresh or completed work", async () => {
		expect(await claimUpdate(env.DB, 7001, "req-1", 1_000)).toBe(true);
		expect(await claimUpdate(env.DB, 7001, "req-2", 1_001)).toBe(false);
		await failUpdate(env.DB, 7001, new Error("temporary"), 1_002);
		expect(await claimUpdate(env.DB, 7001, "req-3", 1_003)).toBe(true);
		await completeUpdate(env.DB, 7001, 1_004);
		expect(await claimUpdate(env.DB, 7001, "req-4", 1_005)).toBe(false);
	});
});

describe("bidirectional forwarding", () => {
	it("creates one topic, copies both directions, and preserves replies", async () => {
		const calls: unknown[][] = [];
		let nextMessageId = 20;
		const api = {
			createForumTopic: async (...args: unknown[]) => {
				calls.push(["createForumTopic", ...args]);
				return { message_thread_id: 99, name: "Test", icon_color: 0 };
			},
			copyMessage: async (...args: unknown[]) => {
				calls.push(["copyMessage", ...args]);
				return nextMessageId++;
			},
		};
		await forwardMessage({
			env: forwardEnv,
			api,
			message: { message_id: 10, date: 0, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false, first_name: "Test" }, text: "hello" },
		} as never);
		await forwardMessage({
			env: forwardEnv,
			api,
			message: { message_id: 30, date: 0, chat: { id: -100123, type: "supergroup" }, message_thread_id: 99, from: { id: 7, is_bot: false, first_name: "Admin" }, text: "reply", reply_to_message: { message_id: 20 } },
		} as never);

		expect(await env.DB.prepare("SELECT user_id, thread_id FROM topics").all()).toMatchObject({ results: [{ user_id: "42", thread_id: "99" }] });
		expect(await env.DB.prepare("SELECT received_id, forwarded_id, in_group FROM messages ORDER BY id").all()).toMatchObject({ results: [{ received_id: "10", forwarded_id: "20", in_group: 0 }, { received_id: "30", forwarded_id: "21", in_group: 1 }] });
		expect(calls[1]).toEqual(["copyMessage", "-100123", "42", 10, { message_thread_id: 99 }]);
		expect(calls[2]).toEqual(["copyMessage", "42", "-100123", 30, { reply_parameters: { message_id: 10 } }]);
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
