import { applyD1Migrations, env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import initialSchemaMigrationSql from "../migrations/0000_initial_schema.sql?raw";
import { cancelAdminSession, loadAdminSession, saveAdminSession } from "../src/admin-sessions";
import { handleAdminCallback, handleAdminInput, showAdminMenu } from "../src/admin-flow";
import { handleAdminPolicyCallback, handleAdminPolicyInput } from "../src/admin-policy";
import { claimUpdate, completeUpdate, failUpdate } from "../src/updates";
import { forwardMessage, handleAdminCommand, handleUserCommand } from "../src/forwarding";
import { missingTranslationKeys } from "../src/i18n";
import { messagePermissions } from "../src/permissions";
import { answerCaptcha, handleCaptchaCallback, handleIncomingPolicy, isWithinTimeWindow, matchesTrigger, validateRegex } from "../src/policy";
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
const forwardEnv = { ...testEnv };

async function configureForwardGroup(groupId = "-100123") {
	await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind("forward_group_id", groupId, Date.now()).run();
}

const migrations = [{ name: "0000_initial_schema.sql", queries: initialSchemaMigrationSql.split(";").filter(Boolean) }];

beforeAll(async () => {
	await applyD1Migrations(env.DB, migrations);
});

afterEach(async () => {
	await env.DB.exec("DELETE FROM admin_sessions");
	await env.DB.exec("DELETE FROM processed_updates");
	await env.DB.exec("DELETE FROM messages");
	await env.DB.exec("DELETE FROM topics");
	await env.DB.exec("DELETE FROM settings");
	await env.DB.exec("DELETE FROM auto_responses");
	await env.DB.exec("DELETE FROM blocked_users");
	await env.DB.exec("DELETE FROM verified_users");
	await env.DB.exec("DELETE FROM user_permission_overrides");
	await env.DB.exec("DELETE FROM captcha_challenges");
	await env.DB.exec("DELETE FROM spam_keywords");
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

	it("does not expose internal routes", async () => {
		const response = await worker.fetch(new Request("https://example.com/internal/metrics"), testEnv, createExecutionContext());
		expect(response.status).toBe(404);
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
		await configureForwardGroup();
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

	it("recreates a deleted forum topic and retries once", async () => {
		await configureForwardGroup();
		await env.DB.prepare("INSERT INTO topics (user_id, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?)").bind("42", "99", 1, 1).run();
		const calls: unknown[][] = [];
		let copies = 0;
		const api = {
			createForumTopic: async (...args: unknown[]) => { calls.push(["createForumTopic", ...args]); return { message_thread_id: 100, name: "Test", icon_color: 0 }; },
			copyMessage: async (...args: unknown[]) => {
				calls.push(["copyMessage", ...args]);
				copies += 1;
				if (copies === 1) throw new Error("Bad Request: message thread not found");
				return 20;
			},
		};
		await forwardMessage({
			env: forwardEnv,
			api,
			message: { message_id: 10, date: 0, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false, first_name: "Test" }, text: "hello" },
		} as never);
		expect(calls.filter(([name]) => name === "createForumTopic")).toHaveLength(1);
		expect(calls.filter(([name]) => name === "copyMessage")).toHaveLength(2);
		expect(await env.DB.prepare("SELECT thread_id FROM topics WHERE user_id = '42'").first()).toEqual({ thread_id: "100" });
	});
});

describe("admin topic commands", () => {
	it("applies verified admin commands to the current topic", async () => {
		await configureForwardGroup();
		await env.DB.prepare("INSERT INTO topics (user_id, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?)").bind("42", "99", 1, 1).run();
		const calls: unknown[][] = [];
		const api = {
			getChatMember: async (...args: unknown[]) => { calls.push(["getChatMember", ...args]); return { status: "administrator" }; },
			closeForumTopic: async (...args: unknown[]) => { calls.push(["closeForumTopic", ...args]); },
		};
		const replied: string[] = [];
		const handled = await handleAdminCommand({
			env: forwardEnv,
			api,
			from: { id: 7 },
			message: { message_id: 30, date: 0, chat: { id: -100123, type: "supergroup" }, message_thread_id: 99, text: "/ban" },
			reply: async (text: string) => { replied.push(text); },
		} as never);
		expect(handled).toBe(true);
		expect(await env.DB.prepare("SELECT user_id FROM blocked_users WHERE user_id = '42'").first()).toEqual({ user_id: "42" });
		expect(calls).toContainEqual(["closeForumTopic", "-100123", 99]);
		expect(replied).toEqual(["User blocked."]);
	});

	it("reads a saved topic note instead of silently overwriting it", async () => {
		await configureForwardGroup();
		await env.DB.prepare("INSERT INTO topics (user_id, thread_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("42", "99", "Needs follow-up", 1, 1).run();
		const replies: string[] = [];
		expect(await handleAdminCommand({ env: forwardEnv, api: { getChatMember: async () => ({ status: "administrator" }) }, from: { id: 7 }, message: { chat: { id: -100123, type: "supergroup" }, message_thread_id: 99, text: "/note" }, reply: async (text: string) => { replies.push(text); } } as never)).toBe(true);
		expect(replies).toEqual(["Note: Needs follow-up"]);
	});
});

describe("forward group initialization", () => {
	it("initializes a forum group from its main chat, then forwards private messages", async () => {
		const calls: unknown[][] = [];
		const replies: string[] = [];
		const api = {
			getChat: async (...args: unknown[]) => { calls.push(["getChat", ...args]); return { is_forum: true }; },
			getChatMember: async (...args: unknown[]) => { calls.push(["getChatMember", ...args]); return { status: "administrator", can_manage_topics: true }; },
			createForumTopic: async (...args: unknown[]) => { calls.push(["createForumTopic", ...args]); return { message_thread_id: 99 }; },
			copyMessage: async (...args: unknown[]) => { calls.push(["copyMessage", ...args]); return 20; },
		};
		await showAdminMenu({
			env: testEnv,
			api,
			from: { id: 7 },
			me: { id: 123456 },
			chat: { id: -100123, type: "supergroup" },
			message: { chat: { id: -100123, type: "supergroup" } },
			reply: async (text: string) => { replies.push(text); },
		} as never);
		expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'forward_group_id'").first()).toEqual({ value: "-100123" });
		expect(replies).toEqual(["Forwarding group initialized.", "Admin settings"]);
		await forwardMessage({
			env: forwardEnv,
			api,
			message: { message_id: 10, date: 0, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false, first_name: "Test" }, text: "hello" },
		} as never);
		expect(calls).toContainEqual(["copyMessage", "-100123", "42", 10, { message_thread_id: 99 }]);
	});

	it("rejects a bot without Manage Topics permission", async () => {
		const replies: string[] = [];
		await showAdminMenu({
			env: testEnv,
			api: {
				getChat: async () => ({ is_forum: true }),
				getChatMember: async (_groupId: string, userId: number) => ({ status: "administrator", can_manage_topics: userId !== 123456 }),
			},
			from: { id: 7 },
			me: { id: 123456 },
			chat: { id: -100123, type: "supergroup" },
			message: { chat: { id: -100123, type: "supergroup" } },
			reply: async (text: string) => { replies.push(text); },
		} as never);
		expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'forward_group_id'").first()).toBeNull();
		expect(replies).toEqual(["Make the bot an administrator with Manage Topics permission, then run /admin again."]);
	});
});

describe("policy helpers", () => {
	it("bounds regexes, handles overnight windows, and expires captcha answers", async () => {
		expect(validateRegex("(a+)+")).toBe(false);
		expect(matchesTrigger("hello world", "world", false)).toBe(true);
		expect(isWithinTimeWindow(new Date("2026-09-22T23:30:00Z"), "22:00", "02:00", "UTC")).toBe(true);
		await env.DB.prepare("INSERT INTO captcha_challenges (user_id, left_operand, right_operand, expires_at) VALUES (?, ?, ?, ?)").bind("42", 2, 3, 10).run();
		expect(await answerCaptcha(env.DB, "42", 5, 11)).toBe(false);
		await env.DB.prepare("INSERT OR REPLACE INTO captcha_challenges (user_id, left_operand, right_operand, expires_at) VALUES (?, ?, ?, ?)").bind("42", 2, 3, 100).run();
		expect(await answerCaptcha(env.DB, "42", 5, 11)).toBe(true);
		expect(await env.DB.prepare("SELECT user_id FROM verified_users WHERE user_id = '42'").first()).toEqual({ user_id: "42" });
	});

	it("blocks configured spam and sends media responses", async () => {
		await env.DB.prepare("INSERT INTO spam_keywords (keyword, created_at) VALUES (?, ?)").bind("scam", 1).run();
		const replies: string[] = [];
		const blocked = await handleIncomingPolicy({ env: testEnv, message: { chat: { type: "private" }, from: { id: 42 }, text: "This is SCAM" }, reply: async (text: string) => { replies.push(text); } } as never);
		expect(blocked).toBe(true);
		expect(replies).toEqual(["You cannot send messages."]);
		await env.DB.prepare("INSERT INTO auto_responses (trigger, response, response_type, is_regex, time_zone, enabled) VALUES (?, ?, ?, ?, ?, ?)").bind("photo", "photo:file-1", "media", 0, "UTC", 1).run();
		const mediaCalls: unknown[][] = [];
		await handleIncomingPolicy({ env: testEnv, chat: { id: 42 }, api: { sendPhoto: async (...args: unknown[]) => { mediaCalls.push(args); } }, message: { chat: { type: "private" }, from: { id: 43 }, text: "photo" }, reply: async () => {} } as never);
		expect(mediaCalls).toEqual([[42, "file-1"]]);
	});

	it("uses the configured default welcome message", async () => {
		await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind("default_message", "Welcome back", 1).run();
		const replies: string[] = [];
		expect(await handleUserCommand({ env: testEnv, message: { chat: { id: 42, type: "private" }, text: "/start" }, reply: async (text: string) => { replies.push(text); } } as never)).toBe(true);
		expect(replies).toEqual(["Welcome back"]);
	});

	it("passes group setup commands to the administrator menu", async () => {
		for (const text of ["/start", "/setup"]) {
			expect(await handleUserCommand({ env: testEnv, message: { chat: { id: -100123, type: "supergroup" }, text }, reply: async () => {} } as never)).toBe(false);
		}
	});

	it("verifies a button captcha against the persisted challenge", async () => {
		await env.DB.prepare("INSERT INTO captcha_challenges (user_id, left_operand, right_operand, expires_at) VALUES (?, ?, ?, ?)").bind("42", 2, 3, Date.now() + 60_000).run();
		const callbacks: unknown[] = [];
		const edits: string[] = [];
		expect(await handleCaptchaCallback({ env: testEnv, from: { id: 42 }, callbackQuery: { data: "captcha:42:5" }, answerCallbackQuery: async (options: unknown) => { callbacks.push(options); }, editMessageText: async (text: string) => { edits.push(text); } } as never)).toBe(true);
		expect(await env.DB.prepare("SELECT user_id FROM verified_users WHERE user_id = '42'").first()).toEqual({ user_id: "42" });
		expect(callbacks).toEqual([{ text: "Saved." }]);
		expect(edits).toEqual(["Saved."]);
	});

	it("enforces every configured message permission and honors a user override", async () => {
		await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind("permission:photo", "deny", 1).run();
		const replies: string[] = [];
		expect(await handleIncomingPolicy({ env: testEnv, from: { language_code: "ja" }, message: { chat: { type: "private" }, from: { id: 42 }, photo: [{ file_id: "photo" }] }, reply: async (text: string) => { replies.push(text); } } as never)).toBe(true);
		expect(replies).toEqual(["写真メッセージは送信できません。"]);
		await env.DB.prepare("INSERT INTO user_permission_overrides (user_id, permission_key, override, updated_at) VALUES (?, ?, ?, ?)").bind("42", "photo", "allow", 2).run();
		expect(await handleIncomingPolicy({ env: testEnv, message: { chat: { type: "private" }, from: { id: 42 }, photo: [{ file_id: "photo" }] }, reply: async () => {} } as never)).toBe(false);
		const otherReplies: string[] = [];
		expect(await handleIncomingPolicy({ env: testEnv, message: { chat: { type: "private" }, from: { id: 43 }, photo: [{ file_id: "photo" }] }, reply: async (text: string) => { otherReplies.push(text); } } as never)).toBe(true);
		expect(otherReplies).toEqual(["You cannot send photo messages."]);
	});

	it("classifies every legacy permission key and saves a validated all-key command", async () => {
		expect(messagePermissions({ photo: [{}], animation: {}, video: {}, voice: {}, document: {}, text: "https://example.com @name" } as never).sort()).toEqual(["file", "link", "photo", "sticker", "username", "video", "voice"]);
		await configureForwardGroup();
		const replies: string[] = [];
		expect(await handleAdminCommand({ env: forwardEnv, api: { getChatMember: async () => ({ status: "administrator" }) }, from: { id: 7 }, message: { chat: { id: -100123, type: "supergroup" }, text: "/permission all deny" }, reply: async (text: string) => { replies.push(text); } } as never)).toBe(true);
		expect(await env.DB.prepare("SELECT key FROM settings WHERE key LIKE 'permission:%' ORDER BY key").all()).toMatchObject({ results: [{ key: "permission:file" }, { key: "permission:link" }, { key: "permission:photo" }, { key: "permission:sticker" }, { key: "permission:username" }, { key: "permission:video" }, { key: "permission:voice" }] });
		expect(replies).toEqual(["Global permission saved."]);
	});

	it("creates and polls a TGuard verification session", async () => {
		await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").bind("captcha", "tguard", 1).run();
		const fetch = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(JSON.stringify({ token: "tg-token", verification_url: "https://tguard.example/verify?token=tg-token", expires_at: new Date(Date.now() + 60_000).toISOString() }), { headers: { "content-type": "application/json" } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ completed: true, expired: false }), { headers: { "content-type": "application/json" } }));
		const replies: string[] = [];
		const tguardEnv = { ...testEnv, TGUARD_API_URL: "https://tguard.example", TGUARD_API_KEY: "test-key" };
		expect(await handleIncomingPolicy({ env: tguardEnv, message: { chat: { type: "private" }, from: { id: 42 }, text: "hello" }, reply: async (text: string) => { replies.push(text); } } as never)).toBe(true);
		expect(replies).toEqual(["Open verification: https://tguard.example/verify?token=tg-token"]);
		expect(await handleIncomingPolicy({ env: tguardEnv, message: { chat: { type: "private" }, from: { id: 42 }, text: "hello again" }, reply: async (text: string) => { replies.push(text); } } as never)).toBe(false);
		expect(await env.DB.prepare("SELECT user_id FROM verified_users WHERE user_id = '42'").first()).toEqual({ user_id: "42" });
		fetch.mockRestore();
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

	it("persists menu settings through the D1 session flow", async () => {
		await configureForwardGroup("1");
		const api = { getChatMember: async () => ({ status: "administrator" }) };
		await handleAdminCallback({ env: testEnv, api, from: { id: 7 }, callbackQuery: { data: "admin:set:captcha", message: { chat: { id: 1 } } }, answerCallbackQuery: async () => {}, editMessageText: async () => {} } as never);
		await handleAdminInput({ env: testEnv, api, from: { id: 7 }, message: { chat: { id: 1, type: "supergroup" }, text: "button" }, reply: async () => {} } as never);
		expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'captcha'").first()).toEqual({ value: "button" });
	});
});

describe("administrator policy management", () => {
	const api = { getChatMember: async () => ({ status: "administrator" }) };
	const base = { env: testEnv, api, from: { id: 7 }, chat: { id: 1, type: "supergroup" } };

	it("persists, lists, and deletes a complete auto reply through the D1 session flow", async () => {
		await configureForwardGroup("1");
		const replies: string[] = [];
		const callback = async (data: string) => handleAdminPolicyCallback({ ...base, message: { chat: { id: 1 }, message_thread_id: undefined }, callbackQuery: { data, message: { chat: { id: 1 } } }, answerCallbackQuery: async () => {}, editMessageText: async () => {} } as never);
		const input = async (message: Record<string, unknown>) => handleAdminPolicyInput({ ...base, message: { chat: { id: 1, type: "supergroup" }, message_id: 1, date: 0, ...message }, reply: async (text: string) => { replies.push(text); } } as never);
		await callback("admin:auto:add");
		await input({ text: "hello" });
		await callback("admin:auto:literal");
		await input({ photo: [{ file_id: "photo-1" }] });
		await callback("admin:auto:window");
		await input({ text: "09:00" });
		await input({ text: "18:00" });
		await input({ text: "Asia/Shanghai" });
		expect(await env.DB.prepare("SELECT trigger, response, response_type, is_regex, start_time, end_time, time_zone FROM auto_responses").first()).toEqual({ trigger: "hello", response: "photo:photo-1", response_type: "media", is_regex: 0, start_time: "09:00", end_time: "18:00", time_zone: "Asia/Shanghai" });
		expect(replies.at(-1)).toBe("Auto reply saved.");
		const edits: string[] = [];
		await handleAdminPolicyCallback({ ...base, message: { chat: { id: 1 } }, callbackQuery: { data: "admin:auto:list:1", message: { chat: { id: 1 } } }, answerCallbackQuery: async () => {}, editMessageText: async (text: string) => { edits.push(text); } } as never);
		const rule = await env.DB.prepare("SELECT id FROM auto_responses").first<{ id: number }>();
		expect(edits[0]).toContain(`#${rule!.id} hello → photo:photo-1 (09:00-18:00 Asia/Shanghai)`);
		await callback(`admin:auto:toggle:${rule!.id}`);
		expect(await env.DB.prepare("SELECT enabled FROM auto_responses WHERE id = ?").bind(rule!.id).first()).toEqual({ enabled: 0 });
		await callback(`admin:auto:delete:${rule!.id}`);
		expect(await env.DB.prepare("SELECT id FROM auto_responses").first()).toBeNull();
	});

	it("persists, lists, and deletes spam keywords through the D1 session flow", async () => {
		await configureForwardGroup("1");
		const callback = async (data: string) => handleAdminPolicyCallback({ ...base, message: { chat: { id: 1 } }, callbackQuery: { data, message: { chat: { id: 1 } } }, answerCallbackQuery: async () => {}, editMessageText: async () => {} } as never);
		await callback("admin:spam:add");
		await handleAdminPolicyInput({ ...base, message: { message_id: 1, date: 0, chat: { id: 1, type: "supergroup" }, text: "scam" }, reply: async () => {} } as never);
		expect(await env.DB.prepare("SELECT keyword FROM spam_keywords").first()).toEqual({ keyword: "scam" });
		await callback("admin:spam:delete:scam");
		expect(await env.DB.prepare("SELECT keyword FROM spam_keywords").first()).toBeNull();
	});
});

describe("translations and generated schema migration", () => {
	it("has a translation for every key and removes unused columns", async () => {
		expect(missingTranslationKeys()).toEqual([]);
		const replies: string[] = [];
		await handleUserCommand({ env: testEnv, from: { language_code: "zh-CN" }, message: { chat: { id: 42, type: "private" }, text: "/start" }, reply: async (text: string) => { replies.push(text); } } as never);
		expect(replies).toEqual(["请告诉我你想转发什么。"]);
		const columns = await env.DB.prepare("PRAGMA table_info(captcha_challenges)").all<{ name: string }>();
		expect(columns.results.map(({ name }) => name)).not.toContain("attempts");
		const blockedColumns = await env.DB.prepare("PRAGMA table_info(blocked_users)").all<{ name: string }>();
		expect(blockedColumns.results.map(({ name }) => name)).toEqual(["user_id", "blocked_at"]);
	});
});
