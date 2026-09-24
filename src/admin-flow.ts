import { InlineKeyboard } from "grammy";
import { cancelAdminSession, loadAdminSession, saveAdminSession } from "./admin-sessions";
import { createDb } from "./db";
import { settings } from "./db/schema";
import type { BotContext } from "./bot";
import { initializeForwardGroup, readForwardGroupId } from "./forward-group";
import { t } from "./i18n";

const SCOPE = "admin-menu";
const SESSION_TTL_MS = 10 * 60_000;

const isAdmin = (member: { status: string }) => member.status === "administrator" || member.status === "creator";
const canManageTopics = (member: { status: string; can_manage_topics?: boolean }) => isAdmin(member) && member.can_manage_topics !== false;

export async function isGroupAdmin(ctx: BotContext, userId: number, groupId: string) {
	const member = await ctx.api.getChatMember(groupId, userId);
	return isAdmin(member);
}

async function initializeFromCurrentGroup(ctx: BotContext) {
	if (!ctx.from || !ctx.chat || ctx.chat.type !== "supergroup" || ctx.message?.message_thread_id != null) {
		await ctx.reply(t(ctx, "runAdminMain"));
		return null;
	}
	const groupId = String(ctx.chat.id);
	const chat = await ctx.api.getChat(groupId);
	const isForum = "is_forum" in chat && chat.is_forum === true;
	if (!isForum) {
		await ctx.reply(t(ctx, "topicsRequired"));
		return null;
	}
	if (!(await isGroupAdmin(ctx, ctx.from.id, groupId))) return null;
	if (!canManageTopics(await ctx.api.getChatMember(groupId, ctx.me.id))) {
		await ctx.reply(t(ctx, "botTopicsRequired"));
		return null;
	}
	if (await initializeForwardGroup(ctx.env.DB, groupId)) return groupId;
	await ctx.reply(t(ctx, "groupConfigured"));
	return null;
}

export async function showAdminMenu(ctx: BotContext) {
	let groupId = await readForwardGroupId(ctx.env.DB);
	const initialized = !groupId;
	if (!groupId) groupId = await initializeFromCurrentGroup(ctx);
	if (!groupId || !ctx.from || ctx.chat?.id.toString() !== groupId || ctx.message?.message_thread_id != null || !(await isGroupAdmin(ctx, ctx.from.id, groupId))) return;
	if (initialized) await ctx.reply(t(ctx, "groupInitialized"));
	await ctx.reply(t(ctx, "adminSettings"), {
		reply_markup: new InlineKeyboard().text(t(ctx, "welcomeMessage"), "admin:set:default_message").text(t(ctx, "captchaSetting"), "admin:set:captcha").row().text(t(ctx, "autoReplies"), "admin:auto:menu").text(t(ctx, "spamKeywords"), "admin:spam:menu").row().text(t(ctx, "cancel"), "admin:cancel"),
	});
}

export async function handleAdminCallback(ctx: BotContext & { callbackQuery: { data?: string; message?: { chat: { id: number | string } } } }) {
	const action = ctx.callbackQuery.data;
	const groupId = await readForwardGroupId(ctx.env.DB);
	if (!ctx.from || !action || !groupId || ctx.callbackQuery.message?.chat.id.toString() !== groupId || !(await isGroupAdmin(ctx, ctx.from.id, groupId))) return;
	await ctx.answerCallbackQuery();
	if (action === "admin:cancel") {
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.editMessageText(t(ctx, "cancelled"));
		return;
	}
	if (action.startsWith("admin:set:")) {
		const key = action.slice("admin:set:".length);
		if (key !== "default_message" && key !== "captcha") return;
		await saveAdminSession(ctx.env.DB, { adminId: String(ctx.from.id), scope: SCOPE, state: "awaiting-value", payload: { key }, expiresAt: Date.now() + SESSION_TTL_MS });
		await ctx.editMessageText(t(ctx, "sendValue"));
		return;
	}
}

export async function handleAdminInput(ctx: BotContext & { message: { text?: string; chat: { id: number | string; type: string }; message_thread_id?: number } }) {
	const groupId = await readForwardGroupId(ctx.env.DB);
	if (!ctx.from || !groupId || ctx.message.chat.id.toString() !== groupId || ctx.message.message_thread_id != null || !(await isGroupAdmin(ctx, ctx.from.id, groupId))) return false;
	if (ctx.message.text === "/cancel") {
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.reply(t(ctx, "cancelled"));
		return true;
	}
	const session = await loadAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
	if (!session) return false;
	if (session.state === "awaiting-value" && ctx.message.text) {
		const key = typeof session.payload.key === "string" ? session.payload.key : null;
		if (key) await createDb(ctx.env.DB).insert(settings).values({ key, value: ctx.message.text, updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { value: ctx.message.text, updatedAt: Date.now() } });
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.reply(t(ctx, "saved"));
		return true;
	}
	return false;
}
