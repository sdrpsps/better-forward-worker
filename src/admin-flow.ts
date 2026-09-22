import { InlineKeyboard, Keyboard } from "grammy";
import { cancelAdminSession, loadAdminSession, saveAdminSession } from "./admin-sessions";
import type { BotContext } from "./bot";
import { readForwardGroupId } from "./env";

const SCOPE = "admin-menu";
const SESSION_TTL_MS = 10 * 60_000;

export async function isGroupAdmin(ctx: BotContext, userId: number, chatId?: string) {
	const groupId = chatId ?? readForwardGroupId(ctx.env);
	if (!groupId) return false;
	const member = await ctx.api.getChatMember(groupId, userId);
	return member.status === "administrator" || member.status === "creator";
}

export async function showAdminMenu(ctx: BotContext) {
	if (!ctx.from || !(await isGroupAdmin(ctx, ctx.from.id, ctx.chat?.id.toString()))) return;
	await ctx.reply("Admin settings", {
		reply_markup: new InlineKeyboard().text("Set value", "admin:set").text("Choose group", "admin:request-chat").row().text("Cancel", "admin:cancel"),
	});
}

export async function handleAdminCallback(ctx: BotContext & { callbackQuery: { data?: string; message?: { chat: { id: number | string } } } }) {
	const action = ctx.callbackQuery.data;
	if (!ctx.from || !action || !(await isGroupAdmin(ctx, ctx.from.id, ctx.callbackQuery.message?.chat.id.toString()))) return;
	await ctx.answerCallbackQuery();
	if (action === "admin:cancel") {
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.editMessageText("Cancelled.");
		return;
	}
	if (action === "admin:set") {
		await saveAdminSession(ctx.env.DB, { adminId: String(ctx.from.id), scope: SCOPE, state: "awaiting-value", payload: {}, expiresAt: Date.now() + SESSION_TTL_MS });
		await ctx.editMessageText("Send the value, or /cancel.");
		return;
	}
	if (action === "admin:request-chat") {
		await ctx.editMessageText("Use the button below to share a group.");
		await ctx.reply("Choose the forwarding group", { reply_markup: new Keyboard().requestChat("Share group", 1, { chat_is_channel: false, chat_is_forum: true }).resized() });
	}
}

export async function handleAdminInput(ctx: BotContext & { message: { text?: string; chat: { type: string }; chat_shared?: { chat_id: number | string } } }) {
	if (!ctx.from || ctx.message.chat.type !== "private") return false;
	if (ctx.message.text === "/cancel") {
		await cancelAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
		await ctx.reply("Cancelled.");
		return true;
	}
	const session = await loadAdminSession(ctx.env.DB, String(ctx.from.id), SCOPE);
	if (!session) return false;
	if (ctx.message.chat_shared) {
		const groupId = String(ctx.message.chat_shared.chat_id);
		await ctx.api.getChat(groupId);
		await ctx.api.getChatMember(groupId, ctx.me.id);
		await saveAdminSession(ctx.env.DB, { ...session, state: "chat-selected", payload: { chatId: groupId }, expiresAt: Date.now() + SESSION_TTL_MS });
		await ctx.reply("Group verified and saved for this setup.");
		return true;
	}
	if (session.state === "awaiting-value" && ctx.message.text) {
		await saveAdminSession(ctx.env.DB, { ...session, state: "completed", payload: { value: ctx.message.text }, expiresAt: Date.now() + SESSION_TTL_MS });
		await ctx.reply("Saved.");
		return true;
	}
	return false;
}
