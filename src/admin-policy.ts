import { asc, eq } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { cancelAdminSession, loadAdminSession, saveAdminSession } from "./admin-sessions";
import { isGroupAdmin } from "./admin-flow";
import type { BotContext } from "./bot";
import { createDb } from "./db";
import { autoResponses, spamKeywords } from "./db/schema";
import { readForwardGroupId } from "./forward-group";
import { t } from "./i18n";
import { validateRegex } from "./policy";

const SCOPE = "admin-policy";
const TTL = 10 * 60_000;
const PAGE_SIZE = 5;
type AdminMessageContext = BotContext & { message: Message };

async function isAdminInMainGroup(ctx: BotContext) {
	const groupId = await readForwardGroupId(ctx.env.DB);
	return Boolean(groupId && ctx.from && ctx.chat?.id.toString() === groupId && ctx.message?.message_thread_id == null && await isGroupAdmin(ctx, ctx.from.id, groupId));
}

function save(ctx: BotContext, state: string, payload: Record<string, unknown>) {
	return saveAdminSession(ctx.env.DB, { adminId: String(ctx.from!.id), scope: SCOPE, state, payload, expiresAt: Date.now() + TTL });
}

function menu(ctx: BotContext, kind: "auto" | "spam") {
	return new InlineKeyboard().text(t(ctx, "add"), `admin:${kind}:add`).text(t(ctx, "list"), `admin:${kind}:list:1`).row().text(t(ctx, "cancel"), `admin:${kind}:cancel`);
}

function page(value: string | undefined) {
	const result = Number(value);
	return Number.isInteger(result) && result > 0 ? result : 1;
}

const summary = (value: string) => value.length > 160 ? `${value.slice(0, 159)}…` : value;

async function listAutoReplies(ctx: BotContext, current: number) {
	const rules = await createDb(ctx.env.DB).select().from(autoResponses).orderBy(asc(autoResponses.id)).limit(PAGE_SIZE + 1).offset((current - 1) * PAGE_SIZE).all();
	const shown = rules.slice(0, PAGE_SIZE);
	if (!shown.length) return ctx.editMessageText(t(ctx, "noAutoReplies"), { reply_markup: menu(ctx, "auto") });
	const keyboard = new InlineKeyboard();
	for (const rule of shown) keyboard.text(`${t(ctx, "toggle")} #${rule.id}`, `admin:auto:toggle:${rule.id}`).text(`${t(ctx, "delete")} #${rule.id}`, `admin:auto:delete:${rule.id}`).row();
	if (current > 1) keyboard.text("←", `admin:auto:list:${current - 1}`);
	if (rules.length > PAGE_SIZE) keyboard.text("→", `admin:auto:list:${current + 1}`);
	return ctx.editMessageText(shown.map((rule) => `${t(ctx, rule.enabled ? "enabled" : "disabled")} #${rule.id} ${rule.isRegex ? "/regex/" : summary(rule.trigger)} → ${summary(rule.response)}${rule.startTime ? ` (${rule.startTime}-${rule.endTime} ${rule.timeZone})` : ""}`).join("\n"), { reply_markup: keyboard });
}

async function listSpamKeywords(ctx: BotContext, current: number) {
	const keywords = await createDb(ctx.env.DB).select().from(spamKeywords).orderBy(asc(spamKeywords.keyword)).limit(PAGE_SIZE + 1).offset((current - 1) * PAGE_SIZE).all();
	const shown = keywords.slice(0, PAGE_SIZE);
	if (!shown.length) return ctx.editMessageText(t(ctx, "noSpamKeywords"), { reply_markup: menu(ctx, "spam") });
	const keyboard = new InlineKeyboard();
	for (const { keyword } of shown) keyboard.text(`${t(ctx, "delete")}: ${keyword}`, `admin:spam:delete:${encodeURIComponent(keyword)}`).row();
	if (current > 1) keyboard.text("←", `admin:spam:list:${current - 1}`);
	if (keywords.length > PAGE_SIZE) keyboard.text("→", `admin:spam:list:${current + 1}`);
	return ctx.editMessageText(shown.map(({ keyword }) => keyword).join("\n"), { reply_markup: keyboard });
}

export async function handleAdminPolicyCallback(ctx: BotContext & { callbackQuery: { data?: string; message?: { chat: { id: number | string } } } }) {
	const action = ctx.callbackQuery.data?.split(":") ?? [];
	if (!ctx.from || ctx.callbackQuery.message?.chat.id !== ctx.chat?.id || !(await isAdminInMainGroup(ctx))) return;
	await ctx.answerCallbackQuery();
	const [namespace, kind, operation, value] = action;
	if (namespace !== "admin" || (kind !== "auto" && kind !== "spam")) return;
	if (operation === "cancel") {
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.editMessageText(t(ctx, "cancelled"));
		return;
	}
	if (operation === "menu") return ctx.editMessageText(kind === "auto" ? t(ctx, "autoReplies") : t(ctx, "spamKeywords"), { reply_markup: menu(ctx, kind) });
	if (operation === "list") return kind === "auto" ? listAutoReplies(ctx, page(value)) : listSpamKeywords(ctx, page(value));
	if (kind === "auto" && operation === "toggle" && value && /^\d+$/.test(value)) {
		const rule = await createDb(ctx.env.DB).select().from(autoResponses).where(eq(autoResponses.id, Number(value))).get();
		if (rule) await createDb(ctx.env.DB).update(autoResponses).set({ enabled: !rule.enabled }).where(eq(autoResponses.id, rule.id));
		await ctx.editMessageText(t(ctx, "saved"), { reply_markup: menu(ctx, "auto") });
		return;
	}
	if (operation === "delete" && value) {
		if (kind === "auto" && /^\d+$/.test(value)) await createDb(ctx.env.DB).delete(autoResponses).where(eq(autoResponses.id, Number(value)));
		if (kind === "spam") {
			try { await createDb(ctx.env.DB).delete(spamKeywords).where(eq(spamKeywords.keyword, decodeURIComponent(value))); } catch { return; }
		}
		await ctx.editMessageText(kind === "auto" ? t(ctx, "autoReplyDeleted") : t(ctx, "spamKeywordDeleted"), { reply_markup: menu(ctx, kind) });
		return;
	}
	if (operation !== "add") {
		if (kind === "auto" && (operation === "literal" || operation === "regex")) {
			const session = await loadAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
			const trigger = session?.state === "auto-kind" && typeof session.payload.trigger === "string" ? session.payload.trigger : null;
			if (!trigger || (operation === "regex" && !validateRegex(trigger))) { await ctx.editMessageText(t(ctx, "invalidRegex")); return; }
			await save(ctx, "auto-response", { trigger, isRegex: operation === "regex" });
			await ctx.editMessageText(t(ctx, "sendResponse"));
		}
		if (kind === "auto" && (operation === "all-day" || operation === "window")) {
			const session = await loadAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
			if (session?.state !== "auto-window") return;
			if (operation === "all-day") return persistAutoReply(ctx, session.payload, null, null, "UTC");
			await save(ctx, "auto-start", session.payload);
			await ctx.editMessageText(t(ctx, "sendStart"));
		}
		return;
	}
	if (kind === "auto") {
		await save(ctx, "auto-trigger", {});
		await ctx.editMessageText(t(ctx, "sendTrigger"));
	} else {
		await save(ctx, "spam-keyword", {});
		await ctx.editMessageText(t(ctx, "sendKeyword"));
	}
}

function response(message: Message) {
	if (message.text && message.text.length <= 4096) return { response: message.text, responseType: "text" as const };
	const media = [["photo", message.photo?.at(-1)?.file_id], ["sticker", message.sticker?.file_id], ["video", message.video?.file_id], ["document", message.document?.file_id], ["audio", message.audio?.file_id], ["voice", message.voice?.file_id], ["animation", message.animation?.file_id]] as const;
	const found = media.find(([, fileId]) => fileId);
	return found ? { response: `${found[0]}:${found[1]}`, responseType: "media" as const } : null;
}

function time(value: string) {
	return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeZone(value: string) {
	try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

async function persistAutoReply(ctx: BotContext, payload: Record<string, unknown>, startTime: string | null, endTime: string | null, timeZoneName: string) {
	if (typeof payload.trigger !== "string" || typeof payload.response !== "string" || typeof payload.isRegex !== "boolean" || (payload.responseType !== "text" && payload.responseType !== "media")) return;
	await createDb(ctx.env.DB).insert(autoResponses).values({ trigger: payload.trigger, response: payload.response, responseType: payload.responseType, isRegex: payload.isRegex, startTime, endTime, timeZone: timeZoneName, enabled: true });
	await cancelAdminSession(ctx.env.DB, String(ctx.from!.id), SCOPE);
	await ctx.reply(t(ctx, "autoReplySaved"));
}

export async function handleAdminPolicyInput(ctx: AdminMessageContext) {
	if (!ctx.from || !(await isAdminInMainGroup(ctx))) return false;
	const session = await loadAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
	if (!session) return false;
	if (ctx.message.text === "/cancel") {
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.reply(t(ctx, "cancelled"));
		return true;
	}
	if (session.state === "auto-trigger") {
		const trigger = ctx.message.text?.trim();
		if (!trigger || trigger.length > 256) { await ctx.reply(t(ctx, "invalidTrigger")); return true; }
		await save(ctx, "auto-kind", { trigger });
		await ctx.reply(t(ctx, "chooseTrigger"), { reply_markup: new InlineKeyboard().text(t(ctx, "literal"), "admin:auto:literal").text(t(ctx, "regex"), "admin:auto:regex") });
		return true;
	}
	if (session.state === "auto-response") {
		const value = response(ctx.message);
		if (!value) { await ctx.reply(t(ctx, "unsupportedResponse")); return true; }
		await save(ctx, "auto-window", { ...session.payload, ...value });
		await ctx.reply(t(ctx, "chooseWindow"), { reply_markup: new InlineKeyboard().text(t(ctx, "allDay"), "admin:auto:all-day").text(t(ctx, "customWindow"), "admin:auto:window") });
		return true;
	}
	if (session.state === "auto-start") {
		if (!ctx.message.text || !time(ctx.message.text)) { await ctx.reply(t(ctx, "invalidTime")); return true; }
		await save(ctx, "auto-end", { ...session.payload, startTime: ctx.message.text });
		await ctx.reply(t(ctx, "sendEnd"));
		return true;
	}
	if (session.state === "auto-end") {
		if (!ctx.message.text || !time(ctx.message.text)) { await ctx.reply(t(ctx, "invalidTime")); return true; }
		await save(ctx, "auto-time-zone", { ...session.payload, endTime: ctx.message.text });
		await ctx.reply(t(ctx, "sendTimeZone"));
		return true;
	}
	if (session.state === "auto-time-zone") {
		if (!ctx.message.text || ctx.message.text.length > 64 || !timeZone(ctx.message.text)) { await ctx.reply(t(ctx, "invalidTimeZone")); return true; }
		await persistAutoReply(ctx, session.payload, session.payload.startTime as string, session.payload.endTime as string, ctx.message.text);
		return true;
	}
	if (session.state === "spam-keyword") {
		const keyword = ctx.message.text?.trim();
		if (!keyword || keyword.length > 128) { await ctx.reply(t(ctx, "invalidKeyword")); return true; }
		await createDb(ctx.env.DB).insert(spamKeywords).values({ keyword, createdAt: Date.now() }).onConflictDoNothing();
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.reply(t(ctx, "spamKeywordSaved"));
		return true;
	}
	return false;
}
